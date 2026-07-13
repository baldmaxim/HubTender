package repository

import (
	"context"
	"fmt"
	"math"

	"github.com/jackc/pgx/v5"
)

// CalculatedCommercialCostRow is ONE row of a server-side commercial recalculation.
//
// Server-generated calculation result.
// Must never be populated from an HTTP request.
//
// It deliberately carries NO json tags and NO validator tags: it is not, and must
// never become, a client DTO. The only legitimate producer is
// CommercialRecalcService after calc.CalculateBoqItemCost (the authoritative
// kernel). The public write path that used to accept these three columns from a
// client (PATCH /api/v1/items/bulk-commercial) is retired — it now returns 410.
type CalculatedCommercialCostRow struct {
	ID                          string
	CommercialMarkup            float64
	TotalCommercialMaterialCost float64
	TotalCommercialWorkCost     float64
}

// InvalidCommercialCalculationResultError is a server-side invariant violation:
// the recalculation produced a row that is not persistable (empty id, duplicate
// id, NaN/Inf, or a negative money value). It signals a BUG in the calculation
// path, never bad client input — the client cannot reach this writer at all.
type InvalidCommercialCalculationResultError struct {
	ItemID string
	Field  string
	Reason string
}

func (e *InvalidCommercialCalculationResultError) Error() string {
	return fmt.Sprintf("INVALID_COMMERCIAL_CALCULATION_RESULT: item %q field %q: %s",
		e.ItemID, e.Field, e.Reason)
}

// Code returns the stable machine-readable code (for logs/metrics).
func (e *InvalidCommercialCalculationResultError) Code() string {
	return "INVALID_COMMERCIAL_CALCULATION_RESULT"
}

// CommercialResultSetMismatchError means the UPDATE did not touch exactly the set
// of rows we calculated: an unknown id, a row deleted concurrently, or a row that
// belongs to a different tender. The whole transaction is rolled back — a partial
// commercial set is never persisted.
type CommercialResultSetMismatchError struct {
	TenderID string
	Expected int
	Updated  int
}

func (e *CommercialResultSetMismatchError) Error() string {
	return fmt.Sprintf("COMMERCIAL_RESULT_SET_MISMATCH: tender %s expected %d updated rows, got %d",
		e.TenderID, e.Expected, e.Updated)
}

// Code returns the stable machine-readable code (for logs/metrics).
func (e *CommercialResultSetMismatchError) Code() string { return "COMMERCIAL_RESULT_SET_MISMATCH" }

// validateCalculatedCommercialRows enforces the persistable-result invariants
// BEFORE any DB mutation. Pure and unit-testable.
//
// No arbitrary upper bound is imposed on cost or markup — only finiteness and
// non-negativity, plus id integrity (non-empty, unique).
func validateCalculatedCommercialRows(rows []CalculatedCommercialCostRow) error {
	seen := make(map[string]struct{}, len(rows))

	checkMoney := func(id, field string, v float64) error {
		if math.IsNaN(v) {
			return &InvalidCommercialCalculationResultError{ItemID: id, Field: field, Reason: "NaN"}
		}
		if math.IsInf(v, 0) {
			return &InvalidCommercialCalculationResultError{ItemID: id, Field: field, Reason: "не является конечным числом (Inf)"}
		}
		if v < 0 {
			return &InvalidCommercialCalculationResultError{ItemID: id, Field: field, Reason: "отрицательное значение"}
		}
		return nil
	}

	for _, r := range rows {
		if r.ID == "" {
			return &InvalidCommercialCalculationResultError{Field: "id", Reason: "пустой идентификатор"}
		}
		if _, dup := seen[r.ID]; dup {
			return &InvalidCommercialCalculationResultError{ItemID: r.ID, Field: "id", Reason: "дублирующийся идентификатор"}
		}
		seen[r.ID] = struct{}{}

		if err := checkMoney(r.ID, "commercial_markup", r.CommercialMarkup); err != nil {
			return err
		}
		if err := checkMoney(r.ID, "total_commercial_material_cost", r.TotalCommercialMaterialCost); err != nil {
			return err
		}
		if err := checkMoney(r.ID, "total_commercial_work_cost", r.TotalCommercialWorkCost); err != nil {
			return err
		}
	}
	return nil
}

// PersistCalculatedCommercialCosts writes a server-calculated commercial result
// set for ONE tender and refreshes that tender's cached grand total, atomically.
//
// Server-generated calculation result — never reachable from an HTTP request.
//
// Guarantees:
//   - the result set is validated BEFORE any mutation;
//   - the UPDATE is scoped to `tender_id = tenderID`, so a row belonging to any
//     other tender can never be touched, whatever ids are passed;
//   - RowsAffected must equal the number of (unique) calculated rows — otherwise
//     CommercialResultSetMismatchError rolls the whole transaction back, leaving
//     neither a partial commercial set nor a half-updated grand total;
//   - the tender's grand total is recomputed exactly ONCE, inside the same tx.
//
// An empty result set is a no-op (0, nil): the recalc had nothing to change.
func (r *BulkBoqRepo) PersistCalculatedCommercialCosts(
	ctx context.Context,
	tenderID string,
	rows []CalculatedCommercialCostRow,
) (int, error) {
	if tenderID == "" {
		return 0, &InvalidCommercialCalculationResultError{Field: "tender_id", Reason: "пустой идентификатор тендера"}
	}
	if len(rows) == 0 {
		return 0, nil // nothing changed — no tx, no mutation, no grand-total churn
	}

	// 1. Validate the calculated set before touching the DB.
	if err := validateCalculatedCommercialRows(rows); err != nil {
		return 0, fmt.Errorf("bulkBoqRepo.PersistCalculatedCommercialCosts: %w", err)
	}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, fmt.Errorf("bulkBoqRepo.PersistCalculatedCommercialCosts: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	updated, err := PersistCalculatedCommercialCostsTx(ctx, tx, tenderID, rows)
	if err != nil {
		return 0, err
	}

	// Recompute this tender's grand total ONCE, in the same tx.
	if err := RecalculateTenderGrandTotal(ctx, tx, tenderID); err != nil {
		return 0, fmt.Errorf("bulkBoqRepo.PersistCalculatedCommercialCosts: grand total: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("bulkBoqRepo.PersistCalculatedCommercialCosts: commit: %w", err)
	}

	return updated, nil
}

// PersistCalculatedCommercialCostsTx is the transaction-aware core of the
// commercial writer: same validation, same tender-scoping, same exact-set check —
// but it neither opens a transaction nor recomputes the grand total. The owner of
// the transaction (copy / version transfer) does that once, for the tenders it
// actually changed.
//
// Server-generated calculation result — never reachable from an HTTP request.
func PersistCalculatedCommercialCostsTx(
	ctx context.Context,
	tx pgx.Tx,
	tenderID string,
	rows []CalculatedCommercialCostRow,
) (int, error) {
	if tenderID == "" {
		return 0, &InvalidCommercialCalculationResultError{Field: "tender_id", Reason: "пустой идентификатор тендера"}
	}
	if len(rows) == 0 {
		return 0, nil
	}
	if err := validateCalculatedCommercialRows(rows); err != nil {
		return 0, fmt.Errorf("persistCalculatedCommercialCostsTx: %w", err)
	}

	ids := make([]string, len(rows))
	markups := make([]float64, len(rows))
	matCosts := make([]float64, len(rows))
	workCosts := make([]float64, len(rows))
	for i, rr := range rows {
		ids[i] = rr.ID
		markups[i] = rr.CommercialMarkup
		matCosts[i] = rr.TotalCommercialMaterialCost
		workCosts[i] = rr.TotalCommercialWorkCost
	}

	// 2. Update ONLY rows of this tender. The tender_id predicate is what makes a
	// cross-tender write impossible — not a post-hoc check of what got updated.
	const updateQ = `
		UPDATE public.boq_items bi
		SET
		    commercial_markup               = u.markup,
		    total_commercial_material_cost  = u.mat_cost,
		    total_commercial_work_cost      = u.work_cost,
		    updated_at                      = NOW()
		FROM UNNEST(
		    $1::uuid[],
		    $2::numeric[],
		    $3::numeric[],
		    $4::numeric[]
		) AS u(id, markup, mat_cost, work_cost)
		WHERE bi.id = u.id
		  AND bi.tender_id = $5::uuid
	`
	tag, err := tx.Exec(ctx, updateQ, ids, markups, matCosts, workCosts, tenderID)
	if err != nil {
		return 0, fmt.Errorf("bulkBoqRepo.PersistCalculatedCommercialCosts: update: %w", err)
	}
	updated := int(tag.RowsAffected())

	// 3. Exact-set check: every calculated row must have landed. Anything else
	// (unknown id, concurrent delete, foreign tender) aborts the whole batch.
	if updated != len(ids) {
		return 0, fmt.Errorf("persistCalculatedCommercialCostsTx: %w",
			&CommercialResultSetMismatchError{TenderID: tenderID, Expected: len(ids), Updated: updated})
	}

	return updated, nil
}
