package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/calc"
)

// RedistributionRecord is one persisted/loaded cost_redistribution_results row
// (transport shape for GET/POST responses). It is NOT a request DTO: since
// stage 0.1.2.3a the client cannot submit financial redistribution values —
// every row is server-generated.
type RedistributionRecord struct {
	BoqItemID        string  `json:"boq_item_id"`
	OriginalWorkCost float64 `json:"original_work_cost"`
	DeductedAmount   float64 `json:"deducted_amount"`
	AddedAmount      float64 `json:"added_amount"`
	FinalWorkCost    float64 `json:"final_work_cost"`
}

// Snapshot status values returned by LoadResults.
const (
	// RedistributionStatusCalculated — server-authoritative snapshot
	// (schema_version >= 2, calculation_source = "server"); results usable.
	RedistributionStatusCalculated = "calculated"
	// RedistributionStatusRequiresRecalculation — legacy client-calculated
	// snapshot; results must NOT be used as authoritative (Commerce/FI/exports).
	RedistributionStatusRequiresRecalculation = "requires_recalculation"
	// RedistributionStatusNotConfigured — no snapshot stored yet.
	RedistributionStatusNotConfigured = "not_configured"
)

// ErrRedistributionTenderNotFound — the save targets a tender that does not exist.
var ErrRedistributionTenderNotFound = errors.New("тендер не найден")

// RedistributionRepo owns cost_redistribution_results.
type RedistributionRepo struct {
	pool *pgxpool.Pool
}

// NewRedistributionRepo creates a RedistributionRepo.
func NewRedistributionRepo(pool *pgxpool.Pool) *RedistributionRepo {
	return &RedistributionRepo{pool: pool}
}

// RedistributionSaveOutput is the server-calculated snapshot the save returns.
// Server-generated redistribution calculation result.
// Must never be populated from an HTTP request.
type RedistributionSaveOutput struct {
	SavedCount     int
	Results        []RedistributionRecord
	TotalDeducted  float64
	TotalAdded     float64
	IsBalanced     bool
	CanonicalRules json.RawMessage
	// PositionDeltas — server-validated cumulative position deltas (diagnostic).
	PositionDeltas map[string]float64
	// Prepared — the full server-generated prepared projection (stage 0.1.2.3b):
	// position adjustments + insurance + rounding + final rows + summary, built
	// by the SAME calc boundary the GET uses.
	Prepared *calc.PreparedRedistribution
	TenderID string
}

// SaveAuthoritative recalculates and persists the redistribution snapshot for
// (tenderID, tacticID) from the tender's CURRENT authoritative state — in ONE
// transaction:
//
//	verify tender + active tactic → typed rules validation (DB-confirmed
//	category/position references) → materialize current commercial values
//	(calc; fail-closed MissingFXRateError) → load the FULL tender BOQ →
//	calc.CalculateRedistribution → invariants (balance, exact set, row
//	identity) → position-adjustment validation on the server-generated base →
//	canonical rules JSON (schema_version=2, calculation_source="server") →
//	atomic batched replace (DELETE + one UNNEST INSERT, exact-set count) →
//	grand total exactly once → commit.
//
// The client contributes ONLY rules. No client-calculated record can reach
// this function. Fail-closed: on any error the whole tx rolls back — the old
// snapshot, commercial fields and grand total stay untouched.
func (r *RedistributionRepo) SaveAuthoritative(
	ctx context.Context,
	tenderID, tacticID string,
	rules calc.RedistributionRulesInput,
	createdBy string,
) (*RedistributionSaveOutput, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// ── planning: tender + active-tactic policy ──
	var activeTactic *string
	err = tx.QueryRow(ctx,
		`SELECT markup_tactic_id::text FROM public.tenders WHERE id = $1::uuid`, tenderID,
	).Scan(&activeTactic)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRedistributionTenderNotFound
		}
		return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: tender: %w", err)
	}
	active := ""
	if activeTactic != nil {
		active = *activeTactic
	}
	if active != tacticID {
		// Redistribution is built on total_commercial_work_cost, which the server
		// materializes for the tender's ACTIVE tactic — computing over another
		// tactic's values would silently mix configurations.
		return nil, &calc.RedistributionTacticMismatchError{
			TenderID: tenderID, RequestedTacticID: tacticID, ActiveTacticID: active,
		}
	}

	// ── reference data for validation (DB-confirmed, canonical names) ──
	knownCategories, err := loadNameMap(ctx, tx,
		`SELECT id::text, name FROM public.cost_categories`)
	if err != nil {
		return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: categories: %w", err)
	}
	knownDetails := map[string]string{}
	detailToCategory := map[string]string{}
	{
		rows, err := tx.Query(ctx,
			`SELECT id::text, name, cost_category_id::text FROM public.detail_cost_categories`)
		if err != nil {
			return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: details: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var id, name, catID string
			if err := rows.Scan(&id, &name, &catID); err != nil {
				return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: details scan: %w", err)
			}
			knownDetails[id] = name
			detailToCategory[id] = catID
		}
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: details rows: %w", err)
		}
	}
	knownPositions := map[string]bool{}
	{
		rows, err := tx.Query(ctx,
			`SELECT id::text FROM public.client_positions WHERE tender_id = $1::uuid`, tenderID)
		if err != nil {
			return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: positions: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: positions scan: %w", err)
			}
			knownPositions[id] = true
		}
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: positions rows: %w", err)
		}
	}

	// ── authoritative commercial base, in THIS transaction ──
	// The per-row grand-total trigger is suppressed; the grand total is
	// recomputed exactly once below.
	if _, err := tx.Exec(ctx, `SET LOCAL app.skip_grand_total = 'on'`); err != nil {
		return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: set skip_grand_total: %w", err)
	}
	if err := MaterializeCommercialForTenderTx(ctx, tx, tenderID); err != nil {
		// e.g. calc.MissingFXRateError — the whole save rolls back, no partially
		// updated commercial fields survive.
		return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: %w", err)
	}

	// ── the FULL current BOQ set, deterministic order ──
	items, err := loadRedistributionBoq(ctx, tx, tenderID)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, &calc.RedistributionNoBoqItemsError{TenderID: tenderID}
	}

	// ── typed rules validation on effective BOQ scopes ──
	norm, err := calc.ValidateAndNormalizeRedistributionRules(rules, calc.RedistributionValidationContext{
		KnownCategories:  knownCategories,
		KnownDetails:     knownDetails,
		DetailToCategory: detailToCategory,
		BoqItems:         items,
	})
	if err != nil {
		return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: %w", err)
	}

	// ── the authoritative category-level calculation + invariants ──
	out := calc.CalculateRedistribution(items, norm.Sources, norm.Targets, detailToCategory)
	if err := calc.ValidateRedistributionCalculation(items, out); err != nil {
		return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: %w", err)
	}

	// ── position rules on the server-generated base ──
	base := calc.PositionWorksAfterRedistribution(items, out.Results)
	adjIssues, positionDeltas := calc.ValidatePositionAdjustments(norm.PositionAdjustments, base, knownPositions)
	if len(adjIssues) > 0 {
		return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: %w",
			&calc.InvalidRedistributionRulesError{Issues: adjIssues})
	}

	// Stage 0.1.2.3b: the FULL prepared projection (position adjustments +
	// insurance + rounding + final rows + summary) is built and validated by the
	// same calc boundary the GET uses — BEFORE anything is persisted. A prepared
	// failure rolls the whole save back.
	prepared, err := buildPreparedTx(ctx, tx, tenderID, items, out.Results, norm.PositionAdjustments)
	if err != nil {
		return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: prepared: %w", err)
	}

	canonicalJSON, err := json.Marshal(norm.Canonical)
	if err != nil {
		return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: canonical rules: %w", err)
	}

	// ── atomic batched replace of the COMPLETE server-generated set ──
	if _, err := tx.Exec(ctx, `
		DELETE FROM public.cost_redistribution_results
		WHERE tender_id = $1::uuid AND markup_tactic_id = $2::uuid
	`, tenderID, tacticID); err != nil {
		return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: delete old set: %w", err)
	}

	ids := make([]string, len(out.Results))
	originals := make([]float64, len(out.Results))
	deducted := make([]float64, len(out.Results))
	added := make([]float64, len(out.Results))
	finals := make([]float64, len(out.Results))
	for i, res := range out.Results {
		ids[i] = res.BoqItemID
		originals[i] = res.OriginalWorkCost
		deducted[i] = res.DeductedAmount
		added[i] = res.AddedAmount
		finals[i] = res.FinalWorkCost
	}
	// Deterministic holder for the rules JSONB: items are ordered by id ASC, so
	// results[0] is the smallest boq_item_id.
	holderID := ids[0]
	var createdByArg any
	if createdBy != "" {
		createdByArg = createdBy
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO public.cost_redistribution_results (
			tender_id, markup_tactic_id, boq_item_id,
			original_work_cost, deducted_amount, added_amount, final_work_cost,
			redistribution_rules, created_by
		)
		SELECT $1::uuid, $2::uuid, u.id,
		       u.original, u.deducted, u.added, u.final,
		       CASE WHEN u.id = $3::uuid THEN $4::jsonb ELSE NULL END,
		       $5
		FROM UNNEST($6::uuid[], $7::numeric[], $8::numeric[], $9::numeric[], $10::numeric[])
		     AS u(id, original, deducted, added, final)
	`, tenderID, tacticID, holderID, canonicalJSON, createdByArg,
		ids, originals, deducted, added, finals)
	if err != nil {
		return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: insert set: %w", err)
	}
	if int(tag.RowsAffected()) != len(out.Results) {
		return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: %w",
			&calc.InvalidRedistributionCalculationResultError{
				Field:  "persist",
				Reason: fmt.Sprintf("persisted %d rows, calculated %d (exact-set mismatch)", tag.RowsAffected(), len(out.Results)),
			})
	}

	// ── grand total exactly once (commercial values may have changed above) ──
	if err := RecalculateTenderGrandTotal(ctx, tx, tenderID); err != nil {
		return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: grand total: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("redistributionRepo.SaveAuthoritative: commit: %w", err)
	}

	resp := &RedistributionSaveOutput{
		SavedCount:     len(out.Results),
		Results:        make([]RedistributionRecord, len(out.Results)),
		TotalDeducted:  out.TotalDeducted,
		TotalAdded:     out.TotalAdded,
		IsBalanced:     out.IsBalanced,
		CanonicalRules: canonicalJSON,
		PositionDeltas: positionDeltas,
		Prepared:       prepared,
		TenderID:       tenderID,
	}
	for i, res := range out.Results {
		resp.Results[i] = RedistributionRecord{
			BoqItemID:        res.BoqItemID,
			OriginalWorkCost: res.OriginalWorkCost,
			DeductedAmount:   res.DeductedAmount,
			AddedAmount:      res.AddedAmount,
			FinalWorkCost:    res.FinalWorkCost,
		}
	}
	return resp, nil
}

// loadNameMap reads an id→name map.
func loadNameMap(ctx context.Context, tx pgx.Tx, q string) (map[string]string, error) {
	rows, err := tx.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		out[id] = name
	}
	return out, rows.Err()
}

// loadRedistributionBoq loads the tender's full BOQ in deterministic order
// (by id ASC) with the just-materialized commercial costs.
func loadRedistributionBoq(ctx context.Context, tx pgx.Tx, tenderID string) ([]calc.BoqItemWithCosts, error) {
	rows, err := tx.Query(ctx, `
		SELECT id::text, client_position_id::text, detail_cost_category_id::text,
		       boq_item_type::text,
		       COALESCE(total_commercial_work_cost, 0),
		       COALESCE(total_commercial_material_cost, 0)
		FROM public.boq_items
		WHERE tender_id = $1::uuid
		ORDER BY id ASC
	`, tenderID)
	if err != nil {
		return nil, fmt.Errorf("redistributionRepo: load boq: %w", err)
	}
	defer rows.Close()
	items := make([]calc.BoqItemWithCosts, 0)
	for rows.Next() {
		var it calc.BoqItemWithCosts
		if err := rows.Scan(&it.ID, &it.ClientPositionID, &it.DetailCostCategoryID,
			&it.BoqItemType, &it.TotalCommercialWorkCost, &it.TotalCommercialMaterialCost); err != nil {
			return nil, fmt.Errorf("redistributionRepo: boq scan: %w", err)
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

// ─── loader ──────────────────────────────────────────────────────────────────

// RedistributionLoad is the loader payload: all result rows for a
// (tender, tactic), the rules JSONB from the single holder row, the snapshot
// status, and — for a server-authoritative snapshot — the prepared projection
// built by the SAME calc boundary the save uses.
type RedistributionLoad struct {
	Results []RedistributionRecord `json:"results"`
	Rules   json.RawMessage        `json:"redistribution_rules"`
	// Status: calculated | requires_recalculation | not_configured.
	Status string `json:"status"`
	// Prepared — nil unless Status == calculated.
	Prepared *calc.PreparedRedistribution `json:"prepared,omitempty"`
}

// rulesServerMetadata mirrors ONLY the server markers inside the rules JSONB.
type rulesServerMetadata struct {
	SchemaVersion     int    `json:"schema_version"`
	CalculationSource string `json:"calculation_source"`
}

// LoadResults returns every cost_redistribution_results row for the given
// (tender_id, markup_tactic_id), the rules JSONB from the single holder row,
// the snapshot status, and — for a server snapshot — the prepared projection
// rebuilt by the SAME calc boundary the save uses (§9: save/GET parity).
//
// Everything is read in ONE read-only transaction (consistent view; no
// per-position queries). A snapshot without the server markers
// (schema_version >= 2 AND calculation_source == "server") was calculated by a
// pre-0.1.2.3a client — status requires_recalculation, no prepared rows. If a
// server snapshot can no longer produce a valid prepared projection (inputs
// changed since the save — the stale-snapshot risk deferred to 0.1.3), the
// status degrades to requires_recalculation instead of returning a 500.
func (r *RedistributionRepo) LoadResults(
	ctx context.Context,
	tenderID, tacticID string,
) (*RedistributionLoad, error) {
	out := &RedistributionLoad{Results: []RedistributionRecord{}, Status: RedistributionStatusNotConfigured}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("redistributionRepo.LoadResults: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	const rulesQ = `
		SELECT redistribution_rules
		FROM public.cost_redistribution_results
		WHERE tender_id = $1 AND markup_tactic_id = $2
		  AND redistribution_rules IS NOT NULL
		ORDER BY created_at ASC
		LIMIT 1
	`
	var rawRules []byte
	if err := tx.QueryRow(ctx, rulesQ, tenderID, tacticID).Scan(&rawRules); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("redistributionRepo.LoadResults: rules: %w", err)
		}
	}
	if len(rawRules) > 0 {
		out.Rules = json.RawMessage(rawRules)
	}

	const resQ = `
		SELECT boq_item_id::text,
		       COALESCE(original_work_cost, 0),
		       deducted_amount,
		       added_amount,
		       COALESCE(final_work_cost, 0)
		FROM public.cost_redistribution_results
		WHERE tender_id = $1 AND markup_tactic_id = $2
		ORDER BY boq_item_id ASC
	`
	rows, err := tx.Query(ctx, resQ, tenderID, tacticID)
	if err != nil {
		return nil, fmt.Errorf("redistributionRepo.LoadResults: query: %w", err)
	}
	func() {
		defer rows.Close()
		for rows.Next() {
			var rec RedistributionRecord
			if err = rows.Scan(
				&rec.BoqItemID, &rec.OriginalWorkCost, &rec.DeductedAmount,
				&rec.AddedAmount, &rec.FinalWorkCost,
			); err != nil {
				return
			}
			out.Results = append(out.Results, rec)
		}
		err = rows.Err()
	}()
	if err != nil {
		return nil, fmt.Errorf("redistributionRepo.LoadResults: scan: %w", err)
	}

	if len(out.Results) == 0 {
		return out, nil // not_configured
	}

	out.Status = RedistributionStatusRequiresRecalculation
	var rules calc.RedistributionRulesInput
	if len(rawRules) > 0 {
		var meta rulesServerMetadata
		if json.Unmarshal(rawRules, &meta) == nil &&
			meta.SchemaVersion >= calc.RedistributionSchemaVersion &&
			meta.CalculationSource == calc.RedistributionCalculationServer &&
			json.Unmarshal(rawRules, &rules) == nil {
			out.Status = RedistributionStatusCalculated
		}
	}
	if out.Status != RedistributionStatusCalculated {
		return out, nil // legacy snapshot: no authoritative prepared rows
	}

	// Rebuild the prepared projection from the persisted server snapshot +
	// current server-side positions/BOQ/insurance — the same engine as save.
	items, err := loadRedistributionBoq(ctx, tx, tenderID)
	if err != nil {
		return nil, fmt.Errorf("redistributionRepo.LoadResults: %w", err)
	}
	categoryResults := make([]calc.RedistributionResult, len(out.Results))
	for i, rec := range out.Results {
		categoryResults[i] = calc.RedistributionResult{
			BoqItemID:        rec.BoqItemID,
			OriginalWorkCost: rec.OriginalWorkCost,
			DeductedAmount:   rec.DeductedAmount,
			AddedAmount:      rec.AddedAmount,
			FinalWorkCost:    rec.FinalWorkCost,
		}
	}
	adjustments := rules.PositionAdjustments
	if rules.LegacyPositionAdjustment != nil && len(adjustments) == 0 &&
		rules.LegacyPositionAdjustment.Amount > 0 {
		adjustments = []calc.PositionAdjustmentRuleInput{*rules.LegacyPositionAdjustment}
	}
	prepared, err := buildPreparedTx(ctx, tx, tenderID, items, categoryResults, adjustments)
	if err != nil {
		// Inputs diverged from the snapshot since the save (stale snapshot —
		// 0.1.3 risk). Degrade honestly instead of serving broken money.
		out.Status = RedistributionStatusRequiresRecalculation
		return out, nil
	}
	out.Prepared = prepared
	return out, nil
}
