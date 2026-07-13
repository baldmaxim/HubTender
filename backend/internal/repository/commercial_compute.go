package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"math"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/calc"
)

// commercialEpsilon — values closer than this are treated as unchanged. The
// commercial cost columns are unbounded numeric, so a fresh recompute of an
// unchanged input round-trips to the same float; the epsilon only guards against
// negligible representation drift.
const commercialEpsilon = 1e-6

// CommercialRepo is the pool-based entry point to the authoritative commercial
// calculation. The in-transaction callers (copy / version transfer) call
// ComputeCommercialRows directly with their own pgx.Tx.
type CommercialRepo struct {
	pool *pgxpool.Pool
}

// NewCommercialRepo creates a CommercialRepo.
func NewCommercialRepo(pool *pgxpool.Pool) *CommercialRepo {
	return &CommercialRepo{pool: pool}
}

// ComputeCommercialRowsForTender runs the authoritative calculation on its own
// connection (used by the public CommercialRecalcService).
func (r *CommercialRepo) ComputeCommercialRowsForTender(
	ctx context.Context, tenderID string,
) ([]ComputedCommercialRow, error) {
	return ComputeCommercialRows(ctx, r.pool, tenderID)
}

// ComputedCommercialRow is one item's authoritative commercial result, together
// with whether it differs from what is currently stored.
type ComputedCommercialRow struct {
	Row CalculatedCommercialCostRow
	// Changed is false when the stored values already equal the freshly computed
	// ones (within commercialEpsilon). The public recalc uses this to avoid
	// pointless writes / WS churn; copy & transfer write everything, because
	// their target rows are brand new.
	Changed bool
}

// ComputeCommercialRows is the SINGLE implementation of the commercial-cost
// calculation for a tender. It reads the tender's own configuration (markup
// tactic, percentages, pricing distribution, subcontract exclusions) and every
// BOQ item through the given Querier, then runs the authoritative kernel
// calc.CalculateBoqItemCost on each item.
//
// Passing a pgx.Tx makes it read the rows that transaction has written but not
// yet committed — that is what lets copy / version-transfer compute authoritative
// commercial values BEFORE they commit, instead of relying on an async recalc.
//
// A tender without a markup tactic yields no rows (nothing to materialize).
// The base amount is the item's stored total_amount, which the callers recompute
// authoritatively (calc.CalculateBoqItemTotalAmount) before calling this.
func ComputeCommercialRows(
	ctx context.Context,
	q Querier,
	tenderID string,
) ([]ComputedCommercialRow, error) {
	// Tender → markup tactic.
	var tacticID *string
	if err := q.QueryRow(ctx,
		`SELECT markup_tactic_id::text FROM public.tenders WHERE id = $1::uuid`, tenderID,
	).Scan(&tacticID); err != nil {
		return nil, fmt.Errorf("computeCommercialRows: load tender: %w", err)
	}
	if tacticID == nil || *tacticID == "" {
		return nil, nil // no tactic → nothing to materialize (same as RecalcTender)
	}

	tactic, err := getTacticQ(ctx, q, *tacticID)
	if err != nil {
		return nil, fmt.Errorf("computeCommercialRows: load tactic: %w", err)
	}
	if tactic == nil {
		return nil, nil
	}

	var sequences map[string][]calc.SequenceStep
	if len(tactic.Sequences) > 0 {
		if err := json.Unmarshal([]byte(tactic.Sequences), &sequences); err != nil {
			return nil, fmt.Errorf("computeCommercialRows: parse sequences: %w", err)
		}
	}
	if len(sequences) == 0 {
		return nil, nil
	}

	// base_costs (MarkupConstructor preview) is intentionally NOT read — it must
	// never enter the production coefficient (P0). calc ignores the arg; nil is
	// passed to make that explicit.

	pctRows, err := listTenderMarkupPercentagesQ(ctx, q, tenderID)
	if err != nil {
		return nil, fmt.Errorf("computeCommercialRows: load percentages: %w", err)
	}
	params := BuildMarkupParamsMap(pctRows)

	distRow, err := getPricingDistributionQ(ctx, q, tenderID)
	if err != nil {
		return nil, fmt.Errorf("computeCommercialRows: load pricing distribution: %w", err)
	}
	dist := ToCalcPricingDistribution(distRow)

	exclRows, err := listSubcontractExclusionsQ(ctx, q, tenderID)
	if err != nil {
		return nil, fmt.Errorf("computeCommercialRows: load exclusions: %w", err)
	}
	excl := ToCalcExclusions(exclRows)

	items, err := listAllBoqItemsForTenderQ(ctx, q, tenderID)
	if err != nil {
		return nil, fmt.Errorf("computeCommercialRows: load boq items: %w", err)
	}

	// coeffCache is per-run — never shared between concurrent tender recalcs.
	coeffCache := map[string]float64{}
	out := make([]ComputedCommercialRow, 0, len(items))

	for _, it := range items {
		base := derefF(it.TotalAmount)
		res, ok := calc.CalculateBoqItemCost(calc.BoqItemForCost{
			BoqItemType:          it.BoqItemType,
			MaterialType:         derefS(it.MaterialType),
			DetailCostCategoryID: derefS(it.DetailCostCategoryID),
			TotalAmount:          base,
		}, sequences, nil, params, dist, excl, coeffCache)
		if !ok {
			continue // no sequence for this item type → not materialized
		}

		unchanged := math.Abs(res.MaterialCost-derefF(it.TotalCommercialMaterialCost)) < commercialEpsilon &&
			math.Abs(res.WorkCost-derefF(it.TotalCommercialWorkCost)) < commercialEpsilon

		out = append(out, ComputedCommercialRow{
			Row: CalculatedCommercialCostRow{
				ID:                          it.ID,
				CommercialMarkup:            res.MarkupCoefficient,
				TotalCommercialMaterialCost: res.MaterialCost,
				TotalCommercialWorkCost:     res.WorkCost,
			},
			Changed: !unchanged,
		})
	}

	return out, nil
}

// ChangedCommercialRows keeps only the rows whose values actually differ from
// what is stored (used by the public recalc to avoid pointless writes).
func ChangedCommercialRows(in []ComputedCommercialRow) []CalculatedCommercialCostRow {
	out := make([]CalculatedCommercialCostRow, 0, len(in))
	for _, c := range in {
		if c.Changed {
			out = append(out, c.Row)
		}
	}
	return out
}

// AllCommercialRows returns every computed row regardless of the stored value —
// used by copy / transfer, whose target rows are brand new and must be written
// authoritatively.
func AllCommercialRows(in []ComputedCommercialRow) []CalculatedCommercialCostRow {
	out := make([]CalculatedCommercialCostRow, 0, len(in))
	for _, c := range in {
		out = append(out, c.Row)
	}
	return out
}

func derefS(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func derefF(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}
