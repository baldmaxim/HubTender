package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Этапы отметки раздела.
const (
	// SectionStagePricing — инженер отметил раздел расценённым.
	SectionStagePricing = "pricing"
	// SectionStageReview — проверяющий отметил раздел проверенным.
	SectionStageReview = "review"
)

// Состояние отметки раздела, вычисляемое при чтении.
const (
	SectionStatusNone    = "none"    // отметки нет
	SectionStatusMarked  = "marked"  // отмечено, раздел не менялся
	SectionStatusChanged = "changed" // раздел изменился после отметки
)

var (
	// ErrSectionNotFound — раздела с таким ключом в тендере нет (заголовок удалён
	// или структура ВОР перестроена).
	ErrSectionNotFound = errors.New("раздел не найден")
	// ErrSectionChanged — раздел изменился с момента, когда его показали
	// пользователю: отметка заверяла бы содержимое, которого он не видел.
	ErrSectionChanged = errors.New("раздел изменился после загрузки")
)

// SectionChanges — правки строк раздела после отметки.
type SectionChanges struct {
	RowEdits     int        `json:"row_edits"`
	LastChangeAt *time.Time `json:"last_change_at"`
	Authors      []string   `json:"authors"`
}

// SectionStageState — отметка одного этапа по разделу.
type SectionStageState struct {
	Status       string          `json:"status"`
	MarkedBy     *string         `json:"marked_by"`
	MarkedByName *string         `json:"marked_by_name"`
	MarkedAt     *time.Time      `json:"marked_at"`
	Note         *string         `json:"note"`
	Changes      *SectionChanges `json:"changes"`
}

// TenderSection — раздел ВОР с готовностью.
type TenderSection struct {
	Key                 string            `json:"key"`
	Title               string            `json:"title"`
	HeaderPositionID    *string           `json:"header_position_id"`
	FirstPositionNumber *float64          `json:"first_position_number"`
	Positions           int               `json:"positions"`
	Priced              int               `json:"priced"`
	UnpricedNoReason    int               `json:"unpriced_no_reason"`
	PricedNoGP          int               `json:"priced_no_gp"`
	TotalAmount         float64           `json:"total_amount"`
	ContentHash         string            `json:"content_hash"`
	OpenErrors          int               `json:"open_errors"`
	OpenWarnings        int               `json:"open_warnings"`
	Pricing             SectionStageState `json:"pricing"`
	Review              SectionStageState `json:"review"`

	positionIDs []string
}

// TenderSections — разделы тендера.
type TenderSections struct {
	TenderID    string          `json:"tender_id"`
	HashVersion int             `json:"hash_version"`
	Sections    []TenderSection `json:"sections"`
	// FindingsAvailable — счётчики находок взяты из сохранённого прогона. false —
	// прогонов ещё не было или история недоступна.
	FindingsAvailable bool `json:"findings_available"`
}

// VerificationSectionsRepo — разделы ВОР и отметки готовности.
type VerificationSectionsRepo struct {
	pool *pgxpool.Pool
}

func NewVerificationSectionsRepo(pool *pgxpool.Pool) *VerificationSectionsRepo {
	return &VerificationSectionsRepo{pool: pool}
}

func loadSectionsTx(ctx context.Context, q rowQuerier, tenderID string) ([]TenderSection, error) {
	rows, err := q.Query(ctx, sectionsSQL, tenderID)
	if err != nil {
		return nil, fmt.Errorf("разделы: %w", err)
	}
	defer rows.Close()

	out := make([]TenderSection, 0, 16)
	for rows.Next() {
		var s TenderSection
		if err := rows.Scan(&s.Key, &s.Title, &s.HeaderPositionID, &s.FirstPositionNumber,
			&s.Positions, &s.Priced, &s.UnpricedNoReason, &s.PricedNoGP, &s.TotalAmount,
			&s.ContentHash, &s.positionIDs); err != nil {
			return nil, fmt.Errorf("разделы scan: %w", err)
		}
		s.Pricing.Status = SectionStatusNone
		s.Review.Status = SectionStatusNone
		out = append(out, s)
	}
	return out, rows.Err()
}

// Load возвращает разделы тендера с отметками и счётчиками находок. Всё — в
// одном снимке данных, чтобы хеш, статистика и состояние отметок сходились.
func (r *VerificationSectionsRepo) Load(ctx context.Context, tenderID string, activeRules []string) (*TenderSections, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("verificationSections.Load: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	sections, err := loadSectionsTx(ctx, tx, tenderID)
	if err != nil {
		return nil, fmt.Errorf("verificationSections.Load: %w", err)
	}
	res := &TenderSections{TenderID: tenderID, HashVersion: SectionHashVersion, Sections: sections}

	byKey := make(map[string]*TenderSection, len(sections))
	byPosition := make(map[string]*TenderSection)
	for i := range sections {
		byKey[sections[i].Key] = &sections[i]
		for _, pid := range sections[i].positionIDs {
			byPosition[pid] = &sections[i]
		}
	}

	if err := applySectionStates(ctx, tx, tenderID, byKey); err != nil {
		return nil, fmt.Errorf("verificationSections.Load: %w", err)
	}

	// Счётчики находок — по возможности: таблица истории могла ещё не появиться.
	sp, err := tx.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("verificationSections.Load: savepoint: %w", err)
	}
	if ferr := applySectionFindings(ctx, sp, tenderID, activeRules, byPosition); ferr == nil {
		res.FindingsAvailable = true
		_ = sp.Commit(ctx)
	} else {
		_ = sp.Rollback(ctx)
	}

	for i := range sections {
		for _, st := range []*SectionStageState{&sections[i].Pricing, &sections[i].Review} {
			if st.Status != SectionStatusChanged || st.MarkedAt == nil {
				continue
			}
			ch, err := loadSectionChanges(ctx, tx, sections[i].positionIDs, *st.MarkedAt)
			if err != nil {
				return nil, fmt.Errorf("verificationSections.Load: %w", err)
			}
			st.Changes = ch
		}
	}
	return res, nil
}

func applySectionStates(ctx context.Context, q rowQuerier, tenderID string, byKey map[string]*TenderSection) error {
	rows, err := q.Query(ctx, sectionStatesSQL, tenderID)
	if err != nil {
		return fmt.Errorf("отметки разделов: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var key, stage, hash string
		var version int
		var st SectionStageState
		var markedAt time.Time
		if err := rows.Scan(&key, &stage, &hash, &version, &st.Note, &st.MarkedBy,
			&st.MarkedByName, &markedAt); err != nil {
			return fmt.Errorf("отметки разделов scan: %w", err)
		}
		sec, ok := byKey[key]
		if !ok {
			continue // раздела больше нет — отметка осиротела
		}
		st.MarkedAt = &markedAt
		st.Status = SectionStatusMarked
		if hash != sec.ContentHash || version != SectionHashVersion {
			st.Status = SectionStatusChanged
		}
		switch stage {
		case SectionStagePricing:
			sec.Pricing = st
		case SectionStageReview:
			sec.Review = st
		}
	}
	return rows.Err()
}

func applySectionFindings(
	ctx context.Context,
	q rowQuerier,
	tenderID string,
	activeRules []string,
	byPosition map[string]*TenderSection,
) error {
	rows, err := q.Query(ctx, sectionFindingsSQL, tenderID, activeRules)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var pid, severity string
		var n int
		if err := rows.Scan(&pid, &severity, &n); err != nil {
			return err
		}
		sec, ok := byPosition[pid]
		if !ok {
			continue
		}
		switch severity {
		case "error":
			sec.OpenErrors += n
		case "warning":
			sec.OpenWarnings += n
		}
	}
	return rows.Err()
}

func loadSectionChanges(ctx context.Context, tx pgx.Tx, positionIDs []string, since time.Time) (*SectionChanges, error) {
	ch := &SectionChanges{}
	if err := tx.QueryRow(ctx, sectionChangesSQL, positionIDs, since).
		Scan(&ch.RowEdits, &ch.LastChangeAt, &ch.Authors); err != nil {
		return nil, fmt.Errorf("правки раздела: %w", err)
	}
	return ch, nil
}

// Mark ставит отметку этапа по разделу.
//
// expectedHash — хеш раздела, который видел пользователь. Хеш пересчитывается
// сервером; расхождение — ErrSectionChanged: иначе отметка заверяла бы
// содержимое, появившееся уже после того, как пользователь посмотрел раздел.
func (r *VerificationSectionsRepo) Mark(
	ctx context.Context,
	tenderID, sectionKey, stage, expectedHash string,
	note, actor *string,
) error {
	if stage != SectionStagePricing && stage != SectionStageReview {
		return fmt.Errorf("verificationSections.Mark: неизвестный этап %q", stage)
	}
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return fmt.Errorf("verificationSections.Mark: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	sections, err := loadSectionsTx(ctx, tx, tenderID)
	if err != nil {
		return fmt.Errorf("verificationSections.Mark: %w", err)
	}
	var current *TenderSection
	for i := range sections {
		if sections[i].Key == sectionKey {
			current = &sections[i]
			break
		}
	}
	if current == nil {
		return ErrSectionNotFound
	}
	if current.ContentHash != expectedHash {
		return ErrSectionChanged
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO public.verification_section_states
			(tender_id, section_key, stage, content_hash, hash_version, note, marked_by, marked_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, now())
		ON CONFLICT (tender_id, section_key, stage) DO UPDATE
		SET content_hash = EXCLUDED.content_hash,
		    hash_version = EXCLUDED.hash_version,
		    note = EXCLUDED.note,
		    marked_by = EXCLUDED.marked_by,
		    marked_at = now()`,
		tenderID, sectionKey, stage, current.ContentHash, SectionHashVersion, note, actor,
	); err != nil {
		return fmt.Errorf("verificationSections.Mark: upsert: %w", err)
	}
	if err := insertSectionEvent(ctx, tx, tenderID, sectionKey, stage, "marked", &current.ContentHash, note, actor); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("verificationSections.Mark: commit: %w", err)
	}
	return nil
}

// Unmark снимает отметку этапа. Отметки не было — не ошибка.
func (r *VerificationSectionsRepo) Unmark(ctx context.Context, tenderID, sectionKey, stage string, actor *string) error {
	if stage != SectionStagePricing && stage != SectionStageReview {
		return fmt.Errorf("verificationSections.Unmark: неизвестный этап %q", stage)
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("verificationSections.Unmark: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var hash string
	switch err := tx.QueryRow(ctx, `
		DELETE FROM public.verification_section_states
		WHERE tender_id = $1 AND section_key = $2 AND stage = $3
		RETURNING content_hash`, tenderID, sectionKey, stage).Scan(&hash); {
	case errors.Is(err, pgx.ErrNoRows):
		return nil
	case err != nil:
		return fmt.Errorf("verificationSections.Unmark: delete: %w", err)
	}
	if err := insertSectionEvent(ctx, tx, tenderID, sectionKey, stage, "unmarked", &hash, nil, actor); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("verificationSections.Unmark: commit: %w", err)
	}
	return nil
}

func insertSectionEvent(
	ctx context.Context,
	tx pgx.Tx,
	tenderID, sectionKey, stage, action string,
	hash, note, actor *string,
) error {
	if _, err := tx.Exec(ctx, `
		INSERT INTO public.verification_section_events
			(tender_id, section_key, stage, action, content_hash, note, actor_user_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		tenderID, sectionKey, stage, action, hash, note, actor,
	); err != nil {
		return fmt.Errorf("verification_section_events insert: %w", err)
	}
	return nil
}
