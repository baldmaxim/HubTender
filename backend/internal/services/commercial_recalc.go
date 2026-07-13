package services

import (
	"context"
	"encoding/json"
	"fmt"
	"math"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/calc"
	"github.com/su10/hubtender/backend/internal/repository"
)

// recalcEpsilon — values closer than this are treated as unchanged. The
// commercial cost columns are unbounded numeric, so a fresh recompute of an
// unchanged input round-trips to the same float; the epsilon only guards against
// negligible representation drift and keeps the diff-before-write robust.
const recalcEpsilon = 1e-6

// CommercialRecalcService recomputes and materializes every BOQ item's
// commercial material/work cost (and commercial_markup) for a tender, then lets
// the bulk repo refresh tenders.cached_grand_total in the same transaction. It
// is the server-side, authoritative replacement for the frontend «Пересчитать»
// button (applyTacticToTender → bulkUpdateCommercial). The math is the Go port
// of src/services/markupTactic/calculation.ts (calc.CalculateBoqItemCost).
type CommercialRecalcService struct {
	fi     *repository.FIRepo
	markup *repository.MarkupRepo
	bulk   calculatedCommercialWriter
	cache  *cache.InMem
}

// calculatedCommercialWriter is the ONLY way commercial costs reach the DB.
// It is deliberately narrow and tender-scoped: a caller must name the tender it
// calculated, and the writer refuses to touch any other tender's rows.
// *repository.BulkBoqRepo satisfies it. No client-facing handler can reach it.
type calculatedCommercialWriter interface {
	PersistCalculatedCommercialCosts(
		ctx context.Context,
		tenderID string,
		rows []repository.CalculatedCommercialCostRow,
	) (int, error)
}

// NewCommercialRecalcService wires the repos the recalc reads/writes through.
func NewCommercialRecalcService(fi *repository.FIRepo, markup *repository.MarkupRepo, bulk *repository.BulkBoqRepo, c *cache.InMem) *CommercialRecalcService {
	return &CommercialRecalcService{fi: fi, markup: markup, bulk: bulk, cache: c}
}

// RecalcTender loads every commercial-cost input for the tender, recomputes each
// item's split, and writes only the rows that actually changed. A tender with no
// markup tactic is left untouched (matching applyTacticToTender, which refuses to
// run without a tactic and never zeroes stored values).
func (s *CommercialRecalcService) RecalcTender(ctx context.Context, tenderID string) error {
	tender, err := s.fi.GetTenderByID(ctx, tenderID)
	if err != nil {
		return fmt.Errorf("commercialRecalc: load tender: %w", err)
	}
	if tender == nil || tender.MarkupTacticID == nil || *tender.MarkupTacticID == "" {
		return nil
	}

	tactic, err := s.markup.GetTactic(ctx, *tender.MarkupTacticID)
	if err != nil {
		return fmt.Errorf("commercialRecalc: load tactic: %w", err)
	}
	if tactic == nil {
		return nil
	}

	sequences := map[string][]calc.SequenceStep{}
	if len(tactic.Sequences) > 0 {
		if err := json.Unmarshal(tactic.Sequences, &sequences); err != nil {
			return fmt.Errorf("commercialRecalc: parse sequences: %w", err)
		}
	}
	if len(sequences) == 0 {
		return nil
	}

	// base_costs (MarkupConstructor preview) is intentionally NOT read here (P0):
	// it must never enter the production coefficient. calc.CalculateBoqItemCost
	// ignores the arg; we pass nil to make that explicit.

	pctRows, err := s.markup.ListTenderMarkupPercentages(ctx, tenderID)
	if err != nil {
		return fmt.Errorf("commercialRecalc: load percentages: %w", err)
	}
	params := buildMarkupParamsMap(pctRows)

	distRow, err := s.markup.GetPricingDistribution(ctx, tenderID)
	if err != nil {
		return fmt.Errorf("commercialRecalc: load pricing distribution: %w", err)
	}
	dist := toCalcPricingDistribution(distRow)

	exclRows, err := s.markup.ListSubcontractExclusions(ctx, tenderID)
	if err != nil {
		return fmt.Errorf("commercialRecalc: load exclusions: %w", err)
	}
	excl := toCalcExclusions(exclRows)

	items, err := s.fi.ListAllBoqItemsForTender(ctx, tenderID)
	if err != nil {
		return fmt.Errorf("commercialRecalc: load boq items: %w", err)
	}

	// coeffCache is per-recalc (mirrors resetTypeCoefficientsCache at the start of
	// applyTacticToTender) — never shared between concurrent tender recalcs.
	coeffCache := map[string]float64{}
	// Server-generated calculation results — produced ONLY here, from calc.
	var changed []repository.CalculatedCommercialCostRow

	for _, it := range items {
		base := recalcF(it.TotalAmount) // applyTacticToTender uses the stored total_amount
		res, ok := calc.CalculateBoqItemCost(calc.BoqItemForCost{
			BoqItemType:          it.BoqItemType,
			MaterialType:         recalcStr(it.MaterialType),
			DetailCostCategoryID: recalcStr(it.DetailCostCategoryID),
			TotalAmount:          base,
		}, sequences, nil, params, dist, excl, coeffCache)
		if !ok {
			// No sequence for this item type → applyTacticToTender skips it.
			continue
		}

		if math.Abs(res.MaterialCost-recalcF(it.TotalCommercialMaterialCost)) < recalcEpsilon &&
			math.Abs(res.WorkCost-recalcF(it.TotalCommercialWorkCost)) < recalcEpsilon {
			continue // unchanged → no write (keeps WS/cache churn down, breaks any echo)
		}

		changed = append(changed, repository.CalculatedCommercialCostRow{
			ID:                          it.ID,
			CommercialMarkup:            res.MarkupCoefficient,
			TotalCommercialMaterialCost: res.MaterialCost,
			TotalCommercialWorkCost:     res.WorkCost,
		})
	}

	return s.persistCalculated(ctx, tenderID, changed)
}

// persistCalculated writes the calculated result set for ONE tender and, only on
// success, evicts that tender's cache.
//
// Invariants (unit-tested):
//   - exactly ONE writer call per batch (never per row);
//   - the writer is always told which tender was calculated;
//   - an empty result set is a no-op (no write, no cache churn);
//   - on ANY writer error (e.g. exact-set mismatch) nothing was persisted, so the
//     cache is deliberately NOT invalidated and no success is reported.
func (s *CommercialRecalcService) persistCalculated(
	ctx context.Context,
	tenderID string,
	changed []repository.CalculatedCommercialCostRow,
) error {
	if len(changed) == 0 {
		return nil
	}

	// ONE writer call for the whole batch, explicitly scoped to THIS tender. The
	// writer validates the result set, refuses to touch other tenders' rows, and
	// rolls back atomically if the updated set != the calculated set (grand total
	// included — it is recomputed once inside that same tx).
	if _, err := s.bulk.PersistCalculatedCommercialCosts(ctx, tenderID, changed); err != nil {
		return fmt.Errorf("commercialRecalc: persist calculated commercial costs: %w", err)
	}

	// Only AFTER a successful commit: evict THIS tender's derived caches.
	s.cache.Delete("tender:overview:" + tenderID)
	s.cache.Delete("positions:with_costs:" + tenderID)

	return nil
}

func recalcStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func recalcF(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

func toCalcExclusions(rows []repository.SubcontractExclusionRow) *calc.SubcontractExclusions {
	ex := &calc.SubcontractExclusions{Works: map[string]bool{}, Materials: map[string]bool{}}
	for _, r := range rows {
		switch r.ExclusionType {
		case "works":
			ex.Works[r.DetailCostCategoryID] = true
		case "materials":
			ex.Materials[r.DetailCostCategoryID] = true
		}
	}
	return ex
}

func toCalcPricingDistribution(r *repository.PricingDistributionRow) *calc.PricingDistribution {
	if r == nil {
		return nil
	}
	d := func(s string) calc.DistTarget { return calc.DistTarget(s) }
	return &calc.PricingDistribution{
		BasicMaterialBaseTarget:                  d(r.BasicMaterialBaseTarget),
		BasicMaterialMarkupTarget:                d(r.BasicMaterialMarkupTarget),
		AuxiliaryMaterialBaseTarget:              d(r.AuxiliaryMaterialBaseTarget),
		AuxiliaryMaterialMarkupTarget:            d(r.AuxiliaryMaterialMarkupTarget),
		ComponentMaterialBaseTarget:              d(r.ComponentMaterialBaseTarget),
		ComponentMaterialMarkupTarget:            d(r.ComponentMaterialMarkupTarget),
		SubcontractBasicMaterialBaseTarget:       d(r.SubcontractBasicMaterialBaseTarget),
		SubcontractBasicMaterialMarkupTarget:     d(r.SubcontractBasicMaterialMarkupTarget),
		SubcontractAuxiliaryMaterialBaseTarget:   d(r.SubcontractAuxiliaryMaterialBaseTarget),
		SubcontractAuxiliaryMaterialMarkupTarget: d(r.SubcontractAuxiliaryMaterialMarkupTarget),
		WorkBaseTarget:                           d(r.WorkBaseTarget),
		WorkMarkupTarget:                         d(r.WorkMarkupTarget),
		ComponentWorkBaseTarget:                  d(r.ComponentWorkBaseTarget),
		ComponentWorkMarkupTarget:                d(r.ComponentWorkMarkupTarget),
	}
}

// buildMarkupParamsMap mirrors loadMarkupParameters in
// src/services/markupTactic/parameters.ts: key → value, falling back to the
// hardcoded defaults when the tender has no percentage rows.
func buildMarkupParamsMap(rows []repository.TenderMarkupPctRow) map[string]float64 {
	m := make(map[string]float64, len(rows))
	for _, r := range rows {
		if r.MarkupParameter != nil && r.MarkupParameter.Key != "" {
			m[r.MarkupParameter.Key] = r.Value
		}
	}
	if len(m) == 0 {
		return fallbackMarkupParams()
	}
	return m
}

// fallbackMarkupParams is a 1:1 port of getFallbackParameters().
func fallbackMarkupParams() map[string]float64 {
	return map[string]float64{
		"mechanization_service":             5,
		"mbp_gsm":                           5,
		"warranty_period":                   5,
		"works_16_markup":                   60,
		"works_cost_growth":                 10,
		"material_cost_growth":              10,
		"subcontract_works_cost_growth":     10,
		"subcontract_materials_cost_growth": 10,
		"contingency_costs":                 3,
		"overhead_own_forces":               10,
		"overhead_subcontract":              10,
		"general_costs_without_subcontract": 20,
		"profit_own_forces":                 10,
		"profit_subcontract":                16,
	}
}
