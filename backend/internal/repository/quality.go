package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/quality"
)

// Finding — одна находка правила по конкретному тендеру.
type Finding struct {
	RuleCode       string   `json:"rule_code"`
	RuleTitle      string   `json:"rule_title"`
	Severity       string   `json:"severity"`
	Summary        string   `json:"summary"`
	TenderID       string   `json:"tender_id"`
	PositionNumber *float64 `json:"position_number"`
	ItemNo         *string  `json:"item_no"`
	EntityID       string   `json:"entity_id"`
	Fingerprint    string   `json:"fingerprint"`
	Detail         string   `json:"detail"`
	MoneyDelta     *float64 `json:"money_delta"`

	// Вердикт инженера, если он есть И отпечаток совпадает. Разошёлся отпечаток —
	// данные изменились, вердикт больше не действует и находка снова активна.
	Verdict *string `json:"verdict"`
	Note    *string `json:"note"`
}

// RuleError — правило не отработало. Одно упавшее правило не должно ронять всю
// проверку: остальные находки инженеру всё ещё полезны.
type RuleError struct {
	RuleCode string `json:"rule_code"`
	Message  string `json:"message"`
}

// QualityReport — результат прогона каталога по тендеру.
type QualityReport struct {
	TenderID    string      `json:"tender_id"`
	GeneratedAt time.Time   `json:"generated_at"`
	Findings    []Finding   `json:"findings"`
	Errors      []RuleError `json:"errors"`
}

type QualityRepo struct {
	pool *pgxpool.Pool
}

func NewQualityRepo(pool *pgxpool.Pool) *QualityRepo {
	return &QualityRepo{pool: pool}
}

type ackRow struct {
	fingerprint string
	verdict     string
	note        *string
}

// Run выполняет все активные правила каталога по одному тендеру и накладывает
// вердикты инженера.
func (r *QualityRepo) Run(ctx context.Context, tenderID string) (*QualityReport, error) {
	acks, err := r.loadAcks(ctx, tenderID)
	if err != nil {
		return nil, fmt.Errorf("qualityRepo.Run: вердикты: %w", err)
	}

	report := &QualityReport{
		TenderID:    tenderID,
		GeneratedAt: time.Now().UTC(),
		Findings:    make([]Finding, 0, 64),
		Errors:      make([]RuleError, 0),
	}

	for _, rule := range quality.Active() {
		found, runErr := r.runRule(ctx, rule, tenderID)
		if runErr != nil {
			report.Errors = append(report.Errors, RuleError{
				RuleCode: rule.Code,
				Message:  runErr.Error(),
			})
			continue
		}
		for i := range found {
			if ack, ok := acks[ackKey(rule.Code, found[i].EntityID)]; ok &&
				ack.fingerprint == found[i].Fingerprint {
				v := ack.verdict
				found[i].Verdict = &v
				found[i].Note = ack.note
			}
		}
		report.Findings = append(report.Findings, found...)
	}

	return report, nil
}

func (r *QualityRepo) runRule(ctx context.Context, rule quality.Rule, tenderID string) ([]Finding, error) {
	rows, err := r.pool.Query(ctx, rule.SQL, tenderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Finding, 0, 16)
	for rows.Next() {
		f := Finding{
			RuleCode:  rule.Code,
			RuleTitle: rule.Title,
			Severity:  rule.Severity,
			Summary:   rule.Summary,
		}
		if scanErr := rows.Scan(
			&f.TenderID, &f.PositionNumber, &f.ItemNo,
			&f.EntityID, &f.Fingerprint, &f.Detail, &f.MoneyDelta,
		); scanErr != nil {
			return nil, fmt.Errorf("несовпадение контракта колонок: %w", scanErr)
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (r *QualityRepo) loadAcks(ctx context.Context, tenderID string) (map[string]ackRow, error) {
	const q = `
		SELECT rule_code, entity_id::text, fingerprint, verdict, note
		FROM public.quality_acknowledgements
		WHERE tender_id = $1`

	rows, err := r.pool.Query(ctx, q, tenderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]ackRow, 32)
	for rows.Next() {
		var code, entityID string
		var a ackRow
		if scanErr := rows.Scan(&code, &entityID, &a.fingerprint, &a.verdict, &a.note); scanErr != nil {
			return nil, scanErr
		}
		out[ackKey(code, entityID)] = a
	}
	return out, rows.Err()
}

// SetVerdict сохраняет вердикт инженера. Отпечаток берётся из находки: как только
// данные строки изменятся, он перестанет совпадать и вердикт сам собой утратит силу.
func (r *QualityRepo) SetVerdict(
	ctx context.Context,
	tenderID, ruleCode, entityID, fingerprint, verdict string,
	note *string,
	changedBy *string,
) error {
	if verdict != "accepted" && verdict != "error" {
		return fmt.Errorf("qualityRepo.SetVerdict: verdict %q: допустимы accepted, error", verdict)
	}
	if _, ok := quality.ByCode(ruleCode); !ok {
		return fmt.Errorf("qualityRepo.SetVerdict: неизвестное правило %q", ruleCode)
	}

	const q = `
		INSERT INTO public.quality_acknowledgements
			(tender_id, rule_code, entity_id, fingerprint, verdict, note, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (tender_id, rule_code, entity_id) DO UPDATE
		SET fingerprint = EXCLUDED.fingerprint,
		    verdict     = EXCLUDED.verdict,
		    note        = EXCLUDED.note,
		    created_by  = EXCLUDED.created_by,
		    updated_at  = now()`

	if _, err := r.pool.Exec(ctx, q, tenderID, ruleCode, entityID, fingerprint, verdict, note, changedBy); err != nil {
		return fmt.Errorf("qualityRepo.SetVerdict: %w", err)
	}
	return nil
}

// ExportRow — строка выгрузки вердиктов для наращивания каталога в Cursor.
type ExportRow struct {
	TenderTitle   string    `json:"tender_title"`
	TenderVersion int       `json:"tender_version"`
	RuleCode      string    `json:"rule_code"`
	EntityID      string    `json:"entity_id"`
	Verdict       string    `json:"verdict"`
	Note          *string   `json:"note"`
	CreatedAt     time.Time `json:"created_at"`
}

// Export отдаёт все вердикты по базе — источник для замера точности правил.
func (r *QualityRepo) Export(ctx context.Context) ([]ExportRow, error) {
	const q = `
		SELECT t.title, t.version, a.rule_code, a.entity_id::text,
		       a.verdict, a.note, a.created_at
		FROM public.quality_acknowledgements a
		JOIN public.tenders t ON t.id = a.tender_id
		ORDER BY a.created_at DESC`

	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("qualityRepo.Export: %w", err)
	}
	defer rows.Close()

	out := make([]ExportRow, 0, 128)
	for rows.Next() {
		var e ExportRow
		if scanErr := rows.Scan(&e.TenderTitle, &e.TenderVersion, &e.RuleCode,
			&e.EntityID, &e.Verdict, &e.Note, &e.CreatedAt); scanErr != nil {
			return nil, fmt.Errorf("qualityRepo.Export: %w", scanErr)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func ackKey(ruleCode, entityID string) string { return ruleCode + "\x00" + entityID }
