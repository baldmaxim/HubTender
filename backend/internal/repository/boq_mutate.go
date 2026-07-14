package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/su10/hubtender/backend/internal/calc"
)

// UpdateBoqItem applies non-nil fields from in, writes an UPDATE audit row,
// all in one transaction. Returns the updated row.
func (r *BoqRepo) UpdateBoqItem(ctx context.Context, id string, in UpdateBoqItemInput) (*BoqItemRow, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("boqRepo.UpdateBoqItem: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if err := skipBoqAuditTrigger(ctx, tx); err != nil {
		return nil, fmt.Errorf("boqRepo.UpdateBoqItem: %w", err)
	}

	// Lock and fetch current row inside the transaction.
	lockQ := "SELECT " + boqScanCols + " FROM public.boq_items WHERE id = $1 FOR UPDATE"
	oldItem, err := scanBoqItemRow(tx.QueryRow(ctx, lockQ, id))
	if err != nil {
		return nil, fmt.Errorf("boqRepo.UpdateBoqItem: lock row: %w", err)
	}

	// 1.3: quote source dates — валидация ДО каких-либо записей.
	if err := validateQuoteDates(in.QuotePriceDate, in.QuoteValidUntil, oldItem); err != nil {
		return nil, err
	}

	// 0-F2 (category A): one revision bump; commercial recalc follows async.
	// 1.3: patch, меняющий ТОЛЬКО source-метаданные (quote_link / даты цены),
	// НЕ является финансовым изменением — ревизия не двигается, approval не
	// снимается, recalc не нужен (метаданные не входят в формулу).
	if !isQuoteMetadataOnlyPatch(&in) {
		if _, err := MarkTenderFinancialInputsChangedTx(ctx, tx, oldItem.TenderID, "boq_update"); err != nil {
			return nil, fmt.Errorf("boqRepo.UpdateBoqItem: %w", err)
		}
	}

	args := []any{}
	argN := 1
	setClauses := ""

	set := func(col string, val any) {
		if setClauses != "" {
			setClauses += ", "
		}
		setClauses += fmt.Sprintf("%s = $%d", col, argN)
		args = append(args, val)
		argN++
	}

	if in.BoqItemType != nil {
		set("boq_item_type", *in.BoqItemType)
	}
	if in.MaterialType != nil {
		set("material_type", *in.MaterialType)
	}
	if in.Description != nil {
		set("description", *in.Description)
	}
	if in.UnitCode != nil {
		set("unit_code", *in.UnitCode)
	}
	if in.Quantity != nil {
		set("quantity", *in.Quantity)
	}
	if in.BaseQuantity != nil {
		set("base_quantity", *in.BaseQuantity)
	}
	if in.ConversionCoefficient != nil {
		set("conversion_coefficient", *in.ConversionCoefficient)
	}
	if in.UnitRate != nil {
		set("unit_rate", *in.UnitRate)
	}
	if in.CurrencyType != nil {
		set("currency_type", *in.CurrencyType)
	}
	if in.DeliveryPriceType != nil {
		set("delivery_price_type", *in.DeliveryPriceType)
	}
	if in.DeliveryAmount != nil {
		set("delivery_amount", *in.DeliveryAmount)
	}
	if in.ConsumptionCoefficient != nil {
		set("consumption_coefficient", *in.ConsumptionCoefficient)
	}
	if in.DetailCostCategoryID != nil {
		set("detail_cost_category_id", *in.DetailCostCategoryID)
	}
	if in.MaterialNameID != nil {
		set("material_name_id", *in.MaterialNameID)
	}
	if in.WorkNameID != nil {
		set("work_name_id", *in.WorkNameID)
	}
	if in.ParentWorkItemID != nil {
		set("parent_work_item_id", *in.ParentWorkItemID)
	}
	if in.SortNumber != nil {
		set("sort_number", *in.SortNumber)
	}
	if in.QuoteLink != nil {
		set("quote_link", *in.QuoteLink)
	}
	if in.QuotePriceDate != nil {
		set("quote_price_date", nullIfEmptyDate(*in.QuotePriceDate))
	}
	if in.QuoteValidUntil != nil {
		set("quote_valid_until", nullIfEmptyDate(*in.QuoteValidUntil))
	}

	var newItem *BoqItemRow
	if setClauses == "" {
		newItem = oldItem
	} else {
		setClauses += ", updated_at = NOW()"
		args = append(args, id)
		updQ := fmt.Sprintf("UPDATE public.boq_items SET %s WHERE id = $%d RETURNING "+boqScanCols,
			setClauses, argN)
		newItem, err = scanBoqItemRow(tx.QueryRow(ctx, updQ, args...))
		if err != nil {
			return nil, fmt.Errorf("boqRepo.UpdateBoqItem: update scan: %w", err)
		}
	}

	// Recompute total_amount on every patch that touched a price input.
	// Skip when no setClauses ran (newItem == oldItem) — total stays correct.
	if setClauses != "" {
		rates, err := loadTenderRates(ctx, tx, newItem.TenderID)
		if err != nil {
			return nil, fmt.Errorf("boqRepo.UpdateBoqItem: %w", err)
		}
		newTotal, err := calc.CalculateBoqItemTotalAmount(boqAmountInputFromRow(newItem), rates)
		if err != nil {
			return nil, fmt.Errorf("boqRepo.UpdateBoqItem: %w", err)
		}
		if newItem.TotalAmount == nil || *newItem.TotalAmount != newTotal {
			const totQ = "UPDATE public.boq_items SET total_amount = $1 WHERE id = $2 RETURNING " + boqScanCols
			newItem, err = scanBoqItemRow(tx.QueryRow(ctx, totQ, newTotal, id))
			if err != nil {
				return nil, fmt.Errorf("boqRepo.UpdateBoqItem: total_amount scan: %w", err)
			}
		}
	}

	oldJSON, _ := boqRowJSON(oldItem)
	newJSON, _ := boqRowJSON(newItem)
	fields := changedFields(oldItem, newItem)

	if err := insertAudit(ctx, tx, id, "UPDATE", in.ChangedBy, fields, oldJSON, newJSON); err != nil {
		return nil, fmt.Errorf("boqRepo.UpdateBoqItem: audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("boqRepo.UpdateBoqItem: commit: %w", err)
	}
	return newItem, nil
}

// DeleteBoqItem deletes a boq_item and writes a DELETE audit row, all in one
// transaction. Returns the deleted row so the caller can include it in the
// response body.
func (r *BoqRepo) DeleteBoqItem(ctx context.Context, id, changedBy string) (*BoqItemRow, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("boqRepo.DeleteBoqItem: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if err := skipBoqAuditTrigger(ctx, tx); err != nil {
		return nil, fmt.Errorf("boqRepo.DeleteBoqItem: %w", err)
	}

	// Lock the row first so we capture a stable snapshot for the audit.
	lockQ := "SELECT " + boqScanCols + " FROM public.boq_items WHERE id = $1 FOR UPDATE"
	item, err := scanBoqItemRow(tx.QueryRow(ctx, lockQ, id))
	if err != nil {
		return nil, fmt.Errorf("boqRepo.DeleteBoqItem: lock row: %w", err)
	}

	// 0-F2 (category A): one revision bump; the sync grand-total refresh below
	// keeps the cached value fresh, but the commercial recalc is async → stale.
	if _, err := MarkTenderFinancialInputsChangedTx(ctx, tx, item.TenderID, "boq_delete"); err != nil {
		return nil, fmt.Errorf("boqRepo.DeleteBoqItem: %w", err)
	}

	if _, err := tx.Exec(ctx, "DELETE FROM public.boq_items WHERE id = $1", id); err != nil {
		return nil, fmt.Errorf("boqRepo.DeleteBoqItem: delete: %w", err)
	}

	// Категория A (0.1.2.4a): удаление строки с materialized commercial values
	// немедленно меняет состав cached_grand_total — пересчёт в ЭТОЙ транзакции
	// (per-row SQL-триггеров больше нет).
	if _, err := RecalculateTenderGrandTotalTx(ctx, tx, item.TenderID); err != nil {
		return nil, fmt.Errorf("boqRepo.DeleteBoqItem: grand total: %w", err)
	}

	oldJSON, _ := boqRowJSON(item)
	if err := insertAudit(ctx, tx, id, "DELETE", changedBy, nil, oldJSON, nil); err != nil {
		return nil, fmt.Errorf("boqRepo.DeleteBoqItem: audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("boqRepo.DeleteBoqItem: commit: %w", err)
	}
	return item, nil
}

// ─── 1.3: source metadata (quote dates) ──────────────────────────────────────

// InvalidQuoteDatesError — некорректные даты источника (400 на write-path).
type InvalidQuoteDatesError struct {
	Reason string
}

func (e *InvalidQuoteDatesError) Error() string {
	return "INVALID_QUOTE_DATES: " + e.Reason
}

// Code returns the stable machine-readable code.
func (e *InvalidQuoteDatesError) Code() string { return "INVALID_QUOTE_DATES" }

// isQuoteMetadataOnlyPatch — true, если patch затрагивает ТОЛЬКО справочные
// source-поля (quote_link, даты цены): такие правки не финансовые (§3 этапа
// 1.3) — ревизия/approval/recalc не трогаются.
func isQuoteMetadataOnlyPatch(in *UpdateBoqItemInput) bool {
	touchesMetadata := in.QuoteLink != nil || in.QuotePriceDate != nil || in.QuoteValidUntil != nil
	touchesFinancial := in.BoqItemType != nil || in.MaterialType != nil || in.Description != nil ||
		in.UnitCode != nil || in.Quantity != nil || in.BaseQuantity != nil ||
		in.ConversionCoefficient != nil || in.UnitRate != nil || in.CurrencyType != nil ||
		in.DeliveryPriceType != nil || in.DeliveryAmount != nil || in.ConsumptionCoefficient != nil ||
		in.DetailCostCategoryID != nil || in.MaterialNameID != nil || in.WorkNameID != nil ||
		in.ParentWorkItemID != nil || in.SortNumber != nil
	return touchesMetadata && !touchesFinancial
}

// nullIfEmptyDate — "" → NULL (очистка), иначе дата как есть (валидация выше).
func nullIfEmptyDate(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return strings.TrimSpace(s)
}

// validateQuoteDates — семантика §3: формат YYYY-MM-DD; price_date не в
// будущем относительно СЕРВЕРНОЙ даты; valid_until >= price_date (учитывая
// уже сохранённые значения при частичном patch'е). Пустые значения разрешены;
// valid_until в прошлом — допустимые исторические данные.
func validateQuoteDates(priceDate, validUntil *string, old *BoqItemRow) error {
	parse := func(field string, p *string, fallback *string) (*time.Time, error) {
		var raw *string
		if p != nil {
			if strings.TrimSpace(*p) == "" {
				return nil, nil // явная очистка
			}
			raw = p
		} else {
			raw = fallback
		}
		if raw == nil || strings.TrimSpace(*raw) == "" {
			return nil, nil
		}
		t, err := time.Parse("2006-01-02", strings.TrimSpace(*raw))
		if err != nil {
			return nil, &InvalidQuoteDatesError{Reason: field + ": ожидается дата в формате ГГГГ-ММ-ДД"}
		}
		return &t, nil
	}
	pd, err := parse("Дата цены", priceDate, old.QuotePriceDate)
	if err != nil {
		return err
	}
	vu, err := parse("Действительно до", validUntil, old.QuoteValidUntil)
	if err != nil {
		return err
	}
	if pd != nil && pd.After(time.Now().UTC().Truncate(24*time.Hour).Add(24*time.Hour-time.Second)) {
		return &InvalidQuoteDatesError{Reason: "дата цены не может быть в будущем"}
	}
	if pd != nil && vu != nil && vu.Before(*pd) {
		return &InvalidQuoteDatesError{Reason: "срок действия не может быть раньше даты цены"}
	}
	return nil
}
