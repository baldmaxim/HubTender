package services

import (
	"context"
	"fmt"

	ea "github.com/su10/hubtender/backend/internal/analytics/estimatearchive"
	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Границы поиска по архиву.
const (
	DefaultArchiveSearchLimit = 20
	MaxArchiveSearchLimit     = 200
	MaxSuggestQueries         = 100
	DefaultSuggestPerQuery    = 5
	// prefilterTokensPerQuery — сколько токенов названия уходит в SQL-префильтр.
	prefilterTokensPerQuery = 4
)

// archiveRepoer — граница репозитория для ArchiveService.
type archiveRepoer interface {
	LoadCandidates(ctx context.Context, tokens []string, f repository.ArchiveSearchFilter) ([]repository.ArchivePositionRow, error)
	GetArchivePosition(ctx context.Context, positionID string) (*repository.ArchivePositionDetail, error)
	Compose(ctx context.Context, in repository.ComposeInput) (*repository.ComposeResult, error)
}

// ArchiveService — поиск по архиву смет и сборка новых позиций из старых.
type ArchiveService struct {
	repo  archiveRepoer
	cache *cache.InMem
}

// NewArchiveService creates an ArchiveService.
func NewArchiveService(repo *repository.ArchiveRepo, c *cache.InMem) *ArchiveService {
	return &ArchiveService{repo: repo, cache: c}
}

// ArchiveSearchHit — найденная историческая позиция вместе с оценкой похожести.
type ArchiveSearchHit struct {
	repository.ArchivePositionRow
	Score                    float64      `json:"score"`
	ScoreBreakdown           ea.Breakdown `json:"score_breakdown"`
	MatchedTokens            []string     `json:"matched_tokens,omitempty"`
	UnmatchedSignificant     []string     `json:"unmatched_significant_tokens,omitempty"`
	UnitCompatibility        string       `json:"unit_compatibility"`
	SignificantTokenConflict bool         `json:"significant_token_conflict,omitempty"`
}

// ArchiveSearchRequest — один поисковый запрос.
type ArchiveSearchRequest struct {
	Query    ea.Query
	Filter   repository.ArchiveSearchFilter
	MinScore float64
	Limit    int
}

// SuggestRequest — батч подбора аналогов.
type SuggestRequest struct {
	Queries      []ea.Query
	Filter       repository.ArchiveSearchFilter
	MinScore     float64
	LimitPerItem int
}

// SuggestResult — результат по одному запросу батча.
type SuggestResult struct {
	Ref     string             `json:"ref"`
	Matches []ArchiveSearchHit `json:"matches"`
}

// Search ищет похожие исторические позиции: грубый SQL-префильтр + точная
// оценка в Go.
func (s *ArchiveService) Search(ctx context.Context, req ArchiveSearchRequest) ([]ArchiveSearchHit, error) {
	limit := normalizeLimit(req.Limit, DefaultArchiveSearchLimit, MaxArchiveSearchLimit)
	tokens := ea.PrefilterTokens(req.Query.WorkName, prefilterTokensPerQuery)

	rows, err := s.repo.LoadCandidates(ctx, tokens, req.Filter)
	if err != nil {
		return nil, fmt.Errorf("archiveService.Search: %w", err)
	}

	byID, candidates := indexCandidates(rows)
	hits := ea.Rank(ea.Prepare(req.Query), candidates, req.MinScore, limit)
	return buildHits(hits, byID), nil
}

// Suggest — батч-подбор: кандидаты грузятся ОДНИМ запросом на весь батч,
// объединением токенов, и переиспользуются для каждого запроса.
func (s *ArchiveService) Suggest(ctx context.Context, req SuggestRequest) ([]SuggestResult, error) {
	if len(req.Queries) == 0 {
		return []SuggestResult{}, nil
	}
	limit := normalizeLimit(req.LimitPerItem, DefaultSuggestPerQuery, MaxArchiveSearchLimit)

	seen := map[string]bool{}
	tokens := make([]string, 0, len(req.Queries)*prefilterTokensPerQuery)
	for _, q := range req.Queries {
		for _, t := range ea.PrefilterTokens(q.WorkName, prefilterTokensPerQuery) {
			if !seen[t] {
				seen[t] = true
				tokens = append(tokens, t)
			}
		}
	}

	filter := req.Filter
	if filter.CandidateLimit <= 0 {
		// Батч смотрит шире одиночного поиска: кандидаты делятся между запросами.
		filter.CandidateLimit = repository.MaxCandidateLimit
	}
	// Единица измерения у запросов батча разная — фильтровать по ней на уровне
	// SQL нельзя, эту работу делает скоринг.
	filter.UnitCode = ""

	rows, err := s.repo.LoadCandidates(ctx, tokens, filter)
	if err != nil {
		return nil, fmt.Errorf("archiveService.Suggest: %w", err)
	}
	byID, candidates := indexCandidates(rows)

	out := make([]SuggestResult, 0, len(req.Queries))
	for _, q := range req.Queries {
		hits := ea.Rank(ea.Prepare(q), candidates, req.MinScore, limit)
		out = append(out, SuggestResult{Ref: q.Ref, Matches: buildHits(hits, byID)})
	}
	return out, nil
}

// GetPosition отдаёт историческую позицию целиком (позиция + тендер + BOQ).
func (s *ArchiveService) GetPosition(ctx context.Context, positionID string) (*repository.ArchivePositionDetail, error) {
	d, err := s.repo.GetArchivePosition(ctx, positionID)
	if err != nil {
		return nil, err
	}
	return d, nil
}

// Compose собирает позиции целевого тендера из исторических.
//
// Кэш инвалидируется ТОЛЬКО после успешного коммита и только для одного
// изменённого тендера. При dry_run не инвалидируется ничего: транзакция
// откачена, состояние не менялось. Очередь пересчёта не трогаем — авторитетный
// пересчёт уже прошёл внутри той же транзакции.
func (s *ArchiveService) Compose(ctx context.Context, in repository.ComposeInput) (*repository.ComposeResult, error) {
	res, err := s.repo.Compose(ctx, in)
	if err != nil {
		return nil, err
	}
	if !in.DryRun && res.TargetTenderID != "" {
		s.cache.Delete("tender:overview:" + res.TargetTenderID)
		s.cache.Delete("positions:with_costs:" + res.TargetTenderID)
		s.cache.DeleteByPrefix(tenderListKeyPrefix)
	}
	return res, nil
}

func indexCandidates(rows []repository.ArchivePositionRow) (map[string]repository.ArchivePositionRow, []ea.Candidate) {
	byID := make(map[string]repository.ArchivePositionRow, len(rows))
	candidates := make([]ea.Candidate, 0, len(rows))
	for _, r := range rows {
		byID[r.PositionID] = r
		itemNo := ""
		if r.ItemNo != nil {
			itemNo = *r.ItemNo
		}
		unit := ""
		if r.UnitCode != nil {
			unit = *r.UnitCode
		}
		volume := r.ManualVolume
		if volume == nil {
			volume = r.Volume
		}
		candidates = append(candidates, ea.Candidate{
			PositionID: r.PositionID,
			WorkName:   r.WorkName,
			UnitCode:   unit,
			ItemNo:     itemNo,
			Volume:     volume,
		})
	}
	return byID, candidates
}

func buildHits(scored []ea.Scored, byID map[string]repository.ArchivePositionRow) []ArchiveSearchHit {
	out := make([]ArchiveSearchHit, 0, len(scored))
	for _, s := range scored {
		row, ok := byID[s.Candidate.PositionID]
		if !ok {
			continue
		}
		out = append(out, ArchiveSearchHit{
			ArchivePositionRow:       row,
			Score:                    s.Score,
			ScoreBreakdown:           s.Breakdown,
			MatchedTokens:            s.MatchedTokens,
			UnmatchedSignificant:     s.UnmatchedSignificant,
			UnitCompatibility:        s.UnitCompatibility,
			SignificantTokenConflict: s.SignificantTokenConflict,
		})
	}
	return out
}

func normalizeLimit(v, def, max int) int {
	if v <= 0 {
		return def
	}
	if v > max {
		return max
	}
	return v
}
