package readiness

import (
	"context"
	"fmt"
	"sort"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Этап 2.4 (§11): pre-deploy impact report для миграции
// 2026_07_markup_multiplyformat_backfill.sql (operandNMultiplyFormat → addOne).
//
// Read-only: данные НЕ изменяются; diagnostic delta считается на фиксированном
// диагностическом входе и НЕ является финансовым итогом production-тендера.
// Deployment gate (§11): zero affected rows ЛИБО owner-reviewed список.

// MarkupAffectedSlot — один слот multiply+markup без multiplyFormat.
type MarkupAffectedSlot struct {
	TacticID   string `json:"tactic_id"`
	TacticName string `json:"tactic_name"`
	Category   string `json:"category"` // boq_item_type ключ sequences
	StepIndex  int    `json:"step_index"`
	Operand    int    `json:"operand"`   // 1..5
	OldValue   string `json:"old_value"` // всегда "" (missing)
	Planned    string `json:"planned"`   // всегда "addOne"
	// Диагностическая дельта интерпретации missing-значения на фиксированном
	// входе (base=1000, markup=10%): legacy direct (×0.1) против addOne (×1.1).
	DiagnosticDirect float64 `json:"diagnostic_direct_result"`
	DiagnosticAddOne float64 `json:"diagnostic_add_one_result"`
}

// MarkupAffectedTender — тендер, ссылающийся на затронутую тактику.
type MarkupAffectedTender struct {
	TenderID string `json:"tender_id"`
	Status   string `json:"financial_calculation_status"`
	Approved bool   `json:"financial_approved"`
}

// MarkupImpact — отчёт §11.
type MarkupImpact struct {
	AffectedTactics []string               `json:"affected_tactic_ids"`
	Slots           []MarkupAffectedSlot   `json:"slots"`
	Tenders         []MarkupAffectedTender `json:"related_tenders"`
	Note            string                 `json:"note"`
}

// BuildMarkupImpact — детект тем же критерием, что и сама миграция:
// actionN='multiply' AND operandNType='markup' AND multiplyFormat missing.
func BuildMarkupImpact(ctx context.Context, pool *pgxpool.Pool) (*MarkupImpact, error) {
	out := &MarkupImpact{
		AffectedTactics: []string{}, Slots: []MarkupAffectedSlot{}, Tenders: []MarkupAffectedTender{},
		Note: "Diagnostic delta считается на фиксированном входе base=1000, markup=10% и не является финансовым итогом тендера. Gate: zero affected либо owner-reviewed список.",
	}
	rows, err := pool.Query(ctx, `
		SELECT t.id::text, COALESCE(t.name, ''), cat.key, step.ord - 1, n.n
		FROM public.markup_tactics t,
		     LATERAL jsonb_each(t.sequences) AS cat(key, steps),
		     LATERAL jsonb_array_elements(cat.steps) WITH ORDINALITY AS step(v, ord),
		     LATERAL generate_series(1, 5) AS n(n)
		WHERE jsonb_typeof(cat.steps) = 'array'
		  AND step.v ->> ('action' || n.n) = 'multiply'
		  AND step.v ->> ('operand' || n.n || 'Type') = 'markup'
		  AND COALESCE(step.v ->> ('operand' || n.n || 'MultiplyFormat'), '') = ''
		ORDER BY 1, 3, 4, 5`)
	if err != nil {
		return nil, fmt.Errorf("markup impact: %w", err)
	}
	defer rows.Close()
	affected := map[string]bool{}
	for rows.Next() {
		var s MarkupAffectedSlot
		if err := rows.Scan(&s.TacticID, &s.TacticName, &s.Category, &s.StepIndex, &s.Operand); err != nil {
			return nil, err
		}
		s.OldValue = ""
		s.Planned = "addOne"
		// Фиксированный диагностический вход: base 1000, markup 10%.
		s.DiagnosticDirect = 1000 * (10.0 / 100.0) // legacy-интерпретация missing
		s.DiagnosticAddOne = 1000 * (1 + 10.0/100.0)
		out.Slots = append(out.Slots, s)
		affected[s.TacticID] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for id := range affected {
		out.AffectedTactics = append(out.AffectedTactics, id)
	}
	sort.Strings(out.AffectedTactics)

	if len(out.AffectedTactics) > 0 {
		tr, err := pool.Query(ctx, `
			SELECT id::text, financial_calculation_status, financial_approved
			FROM public.tenders
			WHERE markup_tactic_id::text = ANY($1)
			ORDER BY id`, out.AffectedTactics)
		if err != nil {
			return nil, fmt.Errorf("markup impact tenders: %w", err)
		}
		defer tr.Close()
		for tr.Next() {
			var t MarkupAffectedTender
			if err := tr.Scan(&t.TenderID, &t.Status, &t.Approved); err != nil {
				return nil, err
			}
			out.Tenders = append(out.Tenders, t)
		}
		if err := tr.Err(); err != nil {
			return nil, err
		}
	}
	return out, nil
}
