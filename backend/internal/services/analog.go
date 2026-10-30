package services

import (
	"context"
	"errors"
	"fmt"
	"strings"

	ea "github.com/su10/hubtender/backend/internal/analytics/estimatearchive"
	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Пилот «Расценивание по реальному аналогу»: поиск аналога, источник, предпросмотр,
// применение и отмена решений.

// Границы поиска аналогов.
const (
	DefaultAnalogLimit = 3
	MaxAnalogLimit     = 30
)

// analogRepoer — граница репозитория аналогов.
type analogRepoer interface {
	GetTarget(ctx context.Context, positionID string) (*repository.AnalogTarget, error)
	LoadSourceRows(ctx context.Context, positionID string) ([]repository.AnalogRow, error)
	Preview(ctx context.Context, in repository.AnalogExecuteInput) (*repository.AnalogPreview, error)
	Apply(ctx context.Context, in repository.AnalogExecuteInput) (*repository.AnalogApplyResult, error)
	ListApplications(ctx context.Context, positionID string) ([]repository.AnalogApplication, error)
	Revert(ctx context.Context, applicationID, userID string) (*repository.AnalogRevertResult, error)
	NextUnpriced(ctx context.Context, positionID string) (*repository.AnalogNext, error)
}

// analogArchive — поиск и чтение позиций архива (ArchiveService).
type analogArchive interface {
	Search(ctx context.Context, req ArchiveSearchRequest) ([]ArchiveSearchHit, error)
	GetPosition(ctx context.Context, positionID string) (*repository.ArchivePositionDetail, error)
}

// AnalogService — пилот «аналог»: тонкая обёртка над репозиторием и архивом.
// После успешной записи один раз сбрасывает кэши тендера и ставит пересчёт
// коммерции (как AutopriceBulkService).
type AnalogService struct {
	repo    analogRepoer
	archive analogArchive
	cache   *cache.InMem
	recalc  Enqueuer
}

// NewAnalogService creates an AnalogService.
func NewAnalogService(repo analogRepoer, archive analogArchive, c *cache.InMem) *AnalogService {
	return &AnalogService{repo: repo, archive: archive, cache: c}
}

// WithRecalcQueue подключает очередь пересчёта коммерции.
func (s *AnalogService) WithRecalcQueue(q Enqueuer) *AnalogService {
	s.recalc = q
	return s
}

// AnalogHit — найденный аналог (позиция другого тендера).
type AnalogHit struct {
	PositionID               string   `json:"position_id"`
	TenderID                 string   `json:"tender_id"`
	TenderNumber             *string  `json:"tender_number"`
	TenderVersion            *int     `json:"tender_version"`
	TenderTitle              *string  `json:"tender_title"`
	ObjectName               *string  `json:"object_name"`
	ClientName               *string  `json:"client_name"`
	FinancialApproved        *bool    `json:"financial_approved"`
	TenderCreatedAt          *string  `json:"tender_created_at"`
	ItemNo                   *string  `json:"item_no"`
	WorkName                 string   `json:"work_name"`
	UnitCode                 *string  `json:"unit_code"`
	Volume                   *float64 `json:"volume"`
	ItemsCount               int      `json:"items_count"`
	Score                    float64  `json:"score"`
	UnitCompatibility        string   `json:"unit_compatibility"`
	SignificantTokenConflict bool     `json:"significant_token_conflict"`
}

// AnalogSearchResponse — ответ GET /positions/{id}/analogs.
type AnalogSearchResponse struct {
	Target  *repository.AnalogTarget `json:"target"`
	Query   string                   `json:"query"`
	Hits    []AnalogHit              `json:"hits"`
	HasMore bool                     `json:"has_more"`
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// Search ищет аналоги целевой позиции в других тендерах (последние версии, только
// позиции со строками). Единица и объём цели участвуют только в скоринге —
// в SQL-префильтре единицы нет: аналог в другой единице остаётся в выдаче с
// unit_compatibility=conflict и решает инженер. Номер позиции цели в запрос не
// передаётся: в чужих тендерах нумерация другая, совпадение давало бы ложные баллы.
func (s *AnalogService) Search(ctx context.Context, positionID, query string, limit int) (*AnalogSearchResponse, error) {
	target, err := s.repo.GetTarget(ctx, positionID)
	if err != nil {
		return nil, err
	}
	query = strings.TrimSpace(query)
	if query == "" {
		query = target.WorkName
	}
	limit = normalizeLimit(limit, DefaultAnalogLimit, MaxAnalogLimit)

	unit := ""
	if target.UnitCode != nil {
		unit = *target.UnitCode
	}
	found, err := s.archive.Search(ctx, ArchiveSearchRequest{
		Query: ea.Query{WorkName: query, UnitCode: unit, Volume: target.Volume},
		Filter: repository.ArchiveSearchFilter{
			ExcludeTenderID:   target.TenderID,
			OnlyLatestVersion: true,
			WithBoqOnly:       true,
		},
		MinScore: ea.DefaultMinScore,
		Limit:    limit + 1,
	})
	if err != nil {
		return nil, fmt.Errorf("analogService.Search: %w", err)
	}

	hits := make([]AnalogHit, 0, len(found))
	for _, h := range found {
		if h.PositionID == positionID {
			continue
		}
		hits = append(hits, analogHitFrom(h))
	}
	resp := &AnalogSearchResponse{Target: target, Query: query, Hits: hits}
	if len(hits) > limit {
		resp.HasMore = true
		resp.Hits = hits[:limit]
	}
	return resp, nil
}

func analogHitFrom(h ArchiveSearchHit) AnalogHit {
	volume := h.ManualVolume
	if volume == nil {
		volume = h.Volume
	}
	version := h.TenderVersion
	return AnalogHit{
		PositionID: h.PositionID, TenderID: h.TenderID,
		TenderNumber: strPtr(h.TenderNumber), TenderVersion: &version,
		TenderTitle: strPtr(h.TenderTitle), ClientName: strPtr(h.ClientName),
		FinancialApproved: h.FinancialApproved, TenderCreatedAt: strPtr(h.TenderCreatedAt),
		ItemNo: h.ItemNo, WorkName: h.WorkName, UnitCode: h.UnitCode, Volume: volume,
		ItemsCount: h.ItemsCount, Score: h.Score,
		UnitCompatibility: h.UnitCompatibility, SignificantTokenConflict: h.SignificantTokenConflict,
	}
}

// GetSource отдаёт позицию-источник целиком: позиция и тендер — через архив,
// строки — с датами цен.
func (s *AnalogService) GetSource(ctx context.Context, sourcePositionID string) (*repository.AnalogSource, error) {
	d, err := s.archive.GetPosition(ctx, sourcePositionID)
	if err != nil {
		if errors.Is(err, repository.ErrArchivePositionNotFound) {
			return nil, &repository.AnalogError{
				Code: repository.AnalogCodeSourceNotFound, Message: "Позиция-аналог не найдена.",
			}
		}
		return nil, fmt.Errorf("analogService.GetSource: %w", err)
	}
	rows, err := s.repo.LoadSourceRows(ctx, sourcePositionID)
	if err != nil {
		return nil, err
	}

	volume := d.Position.ManualVolume
	if volume == nil {
		volume = d.Position.Volume
	}
	number := d.Position.PositionNumber
	version := d.Tender.Version
	return &repository.AnalogSource{
		Position: repository.AnalogSourcePosition{
			ID: d.Position.ID, PositionNumber: &number, ItemNo: d.Position.ItemNo,
			WorkName: d.Position.WorkName, PositionName: d.Position.PositionName,
			UnitCode: d.Position.UnitCode, Volume: volume,
			ClientNote: d.Position.ClientNote, ManualNote: d.Position.ManualNote,
		},
		Tender: repository.AnalogSourceTender{
			ID: d.Tender.ID, TenderNumber: strPtr(d.Tender.TenderNumber), Version: &version,
			Title: strPtr(d.Tender.Title), ClientName: strPtr(d.Tender.ClientName),
			CreatedAt: strPtr(d.Tender.CreatedAt), FinancialApproved: d.Tender.FinancialApproved,
		},
		Items: rows,
	}, nil
}

// Preview — предпросмотр без записи.
func (s *AnalogService) Preview(ctx context.Context, in repository.AnalogExecuteInput) (*repository.AnalogPreview, error) {
	return s.repo.Preview(ctx, in)
}

// Apply применяет аналог. Кэши и пересчёт — только после реальной записи
// (повтор по ключу идемпотентности ничего не меняет).
func (s *AnalogService) Apply(ctx context.Context, in repository.AnalogExecuteInput) (*repository.AnalogApplyResult, error) {
	res, err := s.repo.Apply(ctx, in)
	if err != nil {
		return nil, err
	}
	if !res.Replayed {
		s.afterWrite(res.TenderID)
	}
	return res, nil
}

// Revert отменяет решение.
func (s *AnalogService) Revert(ctx context.Context, applicationID, userID string) (*repository.AnalogApplication, error) {
	res, err := s.repo.Revert(ctx, applicationID, userID)
	if err != nil {
		return nil, err
	}
	if res.Changed {
		s.afterWrite(res.Application.TenderID)
	}
	return &res.Application, nil
}

// ListApplications — последние решения по позиции.
func (s *AnalogService) ListApplications(ctx context.Context, positionID string) ([]repository.AnalogApplication, error) {
	return s.repo.ListApplications(ctx, positionID)
}

// Next — следующая нерасценённая позиция тендера.
func (s *AnalogService) Next(ctx context.Context, positionID string) (*repository.AnalogNext, error) {
	return s.repo.NextUnpriced(ctx, positionID)
}

func (s *AnalogService) afterWrite(tenderID string) {
	if s.cache != nil && tenderID != "" {
		s.cache.Delete("tender:overview:" + tenderID)
		s.cache.Delete("positions:with_costs:" + tenderID)
		s.cache.DeleteByPrefix(tenderListKeyPrefix)
	}
	if s.recalc != nil && tenderID != "" {
		s.recalc.Enqueue(tenderID)
	}
}
