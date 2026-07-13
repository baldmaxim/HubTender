package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/su10/hubtender/backend/internal/calc"
)

// ─── Parent integrity for copy / transfer ───────────────────────────────────

// BoqParentReason mirrors the template-insert reasons (same vocabulary, general
// BOQ wording) — see InvalidTemplateParentError for the template flavour.
type BoqParentReason string

const (
	// BoqParentNotCopied — the source row declares a parent that is not part of
	// the copied set, so the target row's parent could not be remapped.
	BoqParentNotCopied BoqParentReason = "PARENT_NOT_COPIED"
	// BoqParentNotWorkItem — the referenced parent is not a work item.
	BoqParentNotWorkItem BoqParentReason = "PARENT_NOT_WORK_ITEM"
	// BoqSelfParentReference — the row references itself as its own parent.
	BoqSelfParentReference BoqParentReason = "SELF_PARENT_REFERENCE"
)

// InvalidBoqParentError is a blocking domain error: a copied/transferred row
// declares a parent link that cannot be remapped to a real, copied WORK row in
// the target.
//
// It is NEVER downgraded to "standalone" — silently dropping a declared parent
// would change the money (consumption would be applied to a row meant to inherit
// its parent's quantity semantics) and would leave a dangling/cleared link.
type InvalidBoqParentError struct {
	ItemID         string
	ParentItemID   string
	Reason         BoqParentReason
	ParentItemType string
}

func (e *InvalidBoqParentError) Error() string {
	if e.ParentItemType != "" {
		return fmt.Sprintf("INVALID_BOQ_PARENT: %s (item %s → parent %s, тип родителя %q)",
			e.Reason, e.ItemID, e.ParentItemID, e.ParentItemType)
	}
	return fmt.Sprintf("INVALID_BOQ_PARENT: %s (item %s → parent %s)",
		e.Reason, e.ItemID, e.ParentItemID)
}

// Code returns the stable machine-readable error code for API envelopes.
func (e *InvalidBoqParentError) Code() string { return "INVALID_BOQ_PARENT" }

// CopiedParentRef is the minimum a copied row must expose for parent validation.
type CopiedParentRef struct {
	ID       string
	ParentID *string
	ItemType string
}

// ResolveCopiedParents validates every declared parent link against the ACTUAL
// copied set and returns, per row, the index of its effective parent (-1 =
// standalone).
//
// Invariant: a row is a child only when its target parent_work_item_id will
// really point at a copied WORK row. A declared-but-unresolvable / non-work /
// self link is a blocking InvalidBoqParentError — never a silent standalone and
// never a dangling source UUID leaking into the target.
func ResolveCopiedParents(rows []CopiedParentRef) ([]int, error) {
	idx := make(map[string]int, len(rows))
	for i, r := range rows {
		idx[r.ID] = i
	}

	out := make([]int, len(rows))
	for i, r := range rows {
		out[i] = -1
		if r.ParentID == nil {
			continue // standalone
		}
		pid := *r.ParentID

		if pid == r.ID {
			return nil, &InvalidBoqParentError{
				ItemID: r.ID, ParentItemID: pid, Reason: BoqSelfParentReference,
			}
		}
		pIdx, ok := idx[pid]
		if !ok {
			// Parent is outside the copied set (other position / other tender /
			// deleted). We must not clear the link silently.
			return nil, &InvalidBoqParentError{
				ItemID: r.ID, ParentItemID: pid, Reason: BoqParentNotCopied,
			}
		}
		if !calc.IsWorkBoqType(rows[pIdx].ItemType) {
			return nil, &InvalidBoqParentError{
				ItemID: r.ID, ParentItemID: pid, Reason: BoqParentNotWorkItem,
				ParentItemType: rows[pIdx].ItemType,
			}
		}
		out[i] = pIdx
	}
	return out, nil
}

// ─── Authoritative total_amount for freshly written rows ────────────────────

// LoadTenderRatesTx reads a tender's currency rates ONCE, inside the caller's tx.
func LoadTenderRatesTx(ctx context.Context, tx pgx.Tx, tenderID string) (calc.CurrencyRates, error) {
	var usd, eur, cny *float64
	if err := tx.QueryRow(ctx,
		`SELECT usd_rate, eur_rate, cny_rate FROM public.tenders WHERE id = $1::uuid`, tenderID,
	).Scan(&usd, &eur, &cny); err != nil {
		return calc.CurrencyRates{}, fmt.Errorf("loadTenderRatesTx: %w", err)
	}
	return calc.CurrencyRates{USDRate: usd, EURRate: eur, CNYRate: cny}, nil
}

// RecomputeBoqTotalAmountsTx recomputes total_amount for the given boq_items from
// their PERSISTED inputs and the TARGET tender's currency rates, using the
// authoritative kernel calc.CalculateBoqItemTotalAmount, and applies the results
// in ONE bulk UPDATE.
//
// Why it reads the rows back instead of computing before the INSERT: at this
// point parent_work_item_id has already been restored, so calc sees exactly the
// effective parent state the row will keep — "calc's view == the persisted row"
// holds by construction, with no marker plumbing.
//
// Fail-closed: a missing/zero FX rate for a foreign-currency row returns a
// blocking calc.MissingFXRateError (%w-wrapped) and the caller's transaction
// rolls the whole operation back. There is no FX fallback to 1.0 and no 0.
//
// No N+1: one rates query, one SELECT for all rows, one bulk UPDATE.
func RecomputeBoqTotalAmountsTx(
	ctx context.Context,
	tx pgx.Tx,
	tenderID string,
	itemIDs []string,
) error {
	if len(itemIDs) == 0 {
		return nil
	}

	rates, err := LoadTenderRatesTx(ctx, tx, tenderID)
	if err != nil {
		return err
	}

	// Read the persisted inputs of exactly these rows, scoped to the tender.
	rows, err := tx.Query(ctx, `
		SELECT id::text, boq_item_type::text, quantity, unit_rate, currency_type::text,
		       delivery_price_type::text, delivery_amount, consumption_coefficient,
		       parent_work_item_id::text, total_amount
		FROM public.boq_items
		WHERE tender_id = $1::uuid AND id = ANY($2::uuid[])
	`, tenderID, itemIDs)
	if err != nil {
		return fmt.Errorf("recomputeBoqTotalAmountsTx: select: %w", err)
	}

	ids := make([]string, 0, len(itemIDs))
	totals := make([]float64, 0, len(itemIDs))
	var scanErr error
	func() {
		defer rows.Close()
		for rows.Next() {
			var (
				id, itemType                             string
				currency, deliveryType, parentWorkItemID *string
				quantity, unitRate, deliveryAmount       *float64
				consumption, storedTotal                 *float64
			)
			if scanErr = rows.Scan(&id, &itemType, &quantity, &unitRate, &currency,
				&deliveryType, &deliveryAmount, &consumption, &parentWorkItemID, &storedTotal); scanErr != nil {
				return
			}

			in := calc.BoqItemAmountInput{
				BoqItemType:            itemType,
				Quantity:               quantity,
				UnitRate:               unitRate,
				CurrencyType:           derefS(currency),
				DeliveryPriceType:      derefS(deliveryType),
				DeliveryAmount:         deliveryAmount,
				ConsumptionCoefficient: consumption,
				ParentWorkItemID:       parentWorkItemID, // the REAL persisted parent
				TotalAmount:            storedTotal,      // fallback only for unknown item types
			}
			total, calcErr := calc.CalculateBoqItemTotalAmount(in, rates)
			if calcErr != nil {
				// Fail-closed — e.g. MissingFXRateError. %w keeps errors.As working
				// all the way up to the handler (RFC 7807 400).
				scanErr = fmt.Errorf("recomputeBoqTotalAmountsTx: item %s: %w", id, calcErr)
				return
			}
			ids = append(ids, id)
			totals = append(totals, total)
		}
		scanErr = rows.Err()
	}()
	if scanErr != nil {
		return scanErr
	}

	if len(ids) != len(itemIDs) {
		return fmt.Errorf("recomputeBoqTotalAmountsTx: expected %d rows for tender %s, found %d",
			len(itemIDs), tenderID, len(ids))
	}

	// ONE bulk UPDATE, tender-scoped.
	tag, err := tx.Exec(ctx, `
		UPDATE public.boq_items bi
		SET total_amount = u.total
		FROM UNNEST($1::uuid[], $2::numeric[]) AS u(id, total)
		WHERE bi.id = u.id AND bi.tender_id = $3::uuid
	`, ids, totals, tenderID)
	if err != nil {
		return fmt.Errorf("recomputeBoqTotalAmountsTx: update: %w", err)
	}
	if int(tag.RowsAffected()) != len(ids) {
		return fmt.Errorf("recomputeBoqTotalAmountsTx: expected %d updated rows, got %d",
			len(ids), tag.RowsAffected())
	}
	return nil
}

// MaterializeCommercialForTenderTx computes the authoritative commercial costs for
// the tender inside the caller's transaction and writes them through the internal
// writer. It is the in-transaction twin of CommercialRecalcService.RecalcTender —
// same calc, same writer, no duplicated formula.
//
// Called by copy / transfer AFTER total_amount has been recomputed, so the
// commercial split is derived from authoritative base amounts.
func MaterializeCommercialForTenderTx(ctx context.Context, tx pgx.Tx, tenderID string) error {
	computed, err := ComputeCommercialRows(ctx, tx, tenderID)
	if err != nil {
		return fmt.Errorf("materializeCommercialForTenderTx: %w", err)
	}
	// Target rows are brand new (or just recomputed) — write every computed row,
	// not just the "changed" ones.
	rows := AllCommercialRows(computed)
	if len(rows) == 0 {
		return nil // tender has no markup tactic → nothing to materialize
	}
	if _, err := PersistCalculatedCommercialCostsTx(ctx, tx, tenderID, rows); err != nil {
		return fmt.Errorf("materializeCommercialForTenderTx: %w", err)
	}
	return nil
}
