package repository

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/su10/hubtender/backend/internal/calc"
	"github.com/su10/hubtender/backend/internal/pricing"
)

var (
	ErrDraftNotEditable  = errors.New("pricing draft is not editable")
	ErrDraftStale        = errors.New("pricing draft is stale")
	ErrDraftHashMismatch = errors.New("pricing draft validation hash mismatch")
)

type TargetPosition struct {
	ID           string
	TenderID     string
	WorkName     string
	UnitCode     *string
	Volume       *float64
	ManualVolume *float64
	MaxSort      int
}

func (r *PricingRepo) CreateDraft(ctx context.Context, tenderID, userID string) (*pricing.Draft, error) {
	var d pricing.Draft
	err := r.pool.QueryRow(ctx, `
		INSERT INTO public.pricing_drafts (tender_id,created_by,base_revision)
		SELECT id,$2,COALESCE(updated_at,created_at,now()) FROM public.tenders WHERE id=$1
		RETURNING id::text,tender_id::text,created_by::text,status,base_revision,
		 validation_hash,summary,validated_at,expires_at,applied_at,cancelled_at,created_at,updated_at`, tenderID, userID).Scan(
		&d.ID, &d.TenderID, &d.CreatedBy, &d.Status, &d.BaseRevision, &d.ValidationHash,
		&d.Summary, &d.ValidatedAt, &d.ExpiresAt, &d.AppliedAt, &d.CancelledAt, &d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	_ = r.InsertDraftEvent(ctx, d.ID, userID, "created", map[string]any{"tender_id": tenderID})
	return &d, nil
}

func (r *PricingRepo) GetDraft(ctx context.Context, id string) (*pricing.Draft, error) {
	var d pricing.Draft
	err := r.pool.QueryRow(ctx, `
		SELECT id::text,tender_id::text,created_by::text,status,base_revision,
		 validation_hash,summary,validated_at,expires_at,applied_at,cancelled_at,created_at,updated_at
		FROM public.pricing_drafts WHERE id=$1`, id).Scan(
		&d.ID, &d.TenderID, &d.CreatedBy, &d.Status, &d.BaseRevision, &d.ValidationHash,
		&d.Summary, &d.ValidatedAt, &d.ExpiresAt, &d.AppliedAt, &d.CancelledAt, &d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	operations, err := r.ListDraftOperations(ctx, id)
	if err != nil {
		return nil, err
	}
	d.Operations = operations
	events, err := r.ListDraftEvents(ctx, id)
	if err != nil {
		return nil, err
	}
	d.Events = events
	return &d, nil
}

func (r *PricingRepo) ListDrafts(ctx context.Context, tenderID, userID string, limit, offset int) ([]pricing.Draft, int, error) {
	rows, err := r.pool.Query(ctx, `SELECT id::text,tender_id::text,created_by::text,status,base_revision,
		validation_hash,summary,validated_at,expires_at,applied_at,cancelled_at,created_at,updated_at,count(*) OVER()
		FROM public.pricing_drafts WHERE tender_id=$1 AND created_by=$2
		ORDER BY created_at DESC LIMIT $3 OFFSET $4`, tenderID, userID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []pricing.Draft{}
	total := 0
	for rows.Next() {
		var d pricing.Draft
		if err := rows.Scan(&d.ID, &d.TenderID, &d.CreatedBy, &d.Status, &d.BaseRevision, &d.ValidationHash, &d.Summary, &d.ValidatedAt, &d.ExpiresAt, &d.AppliedAt, &d.CancelledAt, &d.CreatedAt, &d.UpdatedAt, &total); err != nil {
			return nil, 0, err
		}
		out = append(out, d)
	}
	return out, total, rows.Err()
}

func (r *PricingRepo) ListDraftOperations(ctx context.Context, draftID string) ([]pricing.DraftOperation, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text,draft_id::text,action,target_position_id::text,target_item_id::text,
		       parent_operation_id::text,expected_etag,proposed_payload,source_kind,source_ref,
		       match_level,confidence::float8,rationale,warnings,position_order,created_at
		FROM public.pricing_draft_operations WHERE draft_id=$1
		ORDER BY position_order,created_at,id`, draftID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []pricing.DraftOperation{}
	for rows.Next() {
		var op pricing.DraftOperation
		var payload, source, warnings []byte
		if err := rows.Scan(&op.ID, &op.DraftID, &op.Action, &op.TargetPositionID, &op.TargetItemID,
			&op.ParentOperationID, &op.ExpectedETag, &payload, &op.SourceKind, &source,
			&op.MatchLevel, &op.Confidence, &op.Rationale, &warnings, &op.PositionOrder, &op.CreatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(payload, &op.ProposedPayload); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(source, &op.SourceRef); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(warnings, &op.Warnings)
		op.RawPayload = payload
		out = append(out, op)
	}
	return out, rows.Err()
}

func (r *PricingRepo) ListDraftEvents(ctx context.Context, draftID string) ([]pricing.DraftEvent, error) {
	rows, err := r.pool.Query(ctx, `SELECT event_type,actor_id::text,details,created_at
		FROM public.pricing_draft_events WHERE draft_id=$1 ORDER BY created_at,id`, draftID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []pricing.DraftEvent{}
	for rows.Next() {
		var e pricing.DraftEvent
		if err := rows.Scan(&e.EventType, &e.ActorID, &e.Details, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *PricingRepo) InsertDraftOperation(ctx context.Context, op *pricing.DraftOperation) error {
	payload, _ := json.Marshal(op.ProposedPayload)
	source, _ := json.Marshal(op.SourceRef)
	warnings, _ := json.Marshal(op.Warnings)
	return r.pool.QueryRow(ctx, `
		INSERT INTO public.pricing_draft_operations
		 (draft_id,action,target_position_id,target_item_id,parent_operation_id,expected_etag,
		  proposed_payload,source_kind,source_ref,match_level,confidence,rationale,warnings,position_order)
		SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
		WHERE EXISTS (SELECT 1 FROM public.pricing_drafts WHERE id=$1 AND status IN ('draft','ready') AND expires_at>now())
		RETURNING id::text,created_at`, op.DraftID, op.Action, op.TargetPositionID, op.TargetItemID,
		op.ParentOperationID, op.ExpectedETag, payload, op.SourceKind, source, op.MatchLevel,
		op.Confidence, op.Rationale, warnings, op.PositionOrder).Scan(&op.ID, &op.CreatedAt)
}

func (r *PricingRepo) ResetDraftValidation(ctx context.Context, draftID string) error {
	cmd, err := r.pool.Exec(ctx, `UPDATE public.pricing_drafts
		SET status='draft',validation_hash=NULL,validated_at=NULL,summary='{}'::jsonb
		WHERE id=$1 AND status IN ('draft','ready')`, draftID)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() != 1 {
		return ErrDraftNotEditable
	}
	return nil
}

func (r *PricingRepo) InsertDraftEvent(ctx context.Context, draftID, actorID, eventType string, details any) error {
	raw, _ := json.Marshal(details)
	_, err := r.pool.Exec(ctx, `INSERT INTO public.pricing_draft_events (draft_id,actor_id,event_type,details)
		VALUES ($1,$2,$3,$4)`, draftID, actorID, eventType, raw)
	return err
}

func (r *PricingRepo) SetDraftValidated(ctx context.Context, draftID, hash string, summary pricing.ValidationSummary, actorID string) error {
	raw, _ := json.Marshal(summary)
	cmd, err := r.pool.Exec(ctx, `UPDATE public.pricing_drafts
		SET status='ready',validation_hash=$2,validated_at=now(),summary=$3
		WHERE id=$1 AND status IN ('draft','ready') AND expires_at>now()`, draftID, hash, raw)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() != 1 {
		return ErrDraftNotEditable
	}
	return r.InsertDraftEvent(ctx, draftID, actorID, "validated", summary)
}

func (r *PricingRepo) CancelDraft(ctx context.Context, draftID, actorID string) error {
	cmd, err := r.pool.Exec(ctx, `UPDATE public.pricing_drafts SET status='cancelled',cancelled_at=now()
		WHERE id=$1 AND status IN ('draft','ready')`, draftID)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() != 1 {
		return ErrDraftNotEditable
	}
	return r.InsertDraftEvent(ctx, draftID, actorID, "cancelled", map[string]any{})
}

func (r *PricingRepo) MarkDraftStale(ctx context.Context, draftID, actorID, reason string) {
	_, _ = r.pool.Exec(ctx, `UPDATE public.pricing_drafts SET status='stale' WHERE id=$1 AND status IN ('draft','ready')`, draftID)
	_ = r.InsertDraftEvent(ctx, draftID, actorID, "stale", map[string]any{"reason": reason})
}

func (r *PricingRepo) GetTargetPosition(ctx context.Context, id string) (*TargetPosition, error) {
	var p TargetPosition
	err := r.pool.QueryRow(ctx, `
		SELECT cp.id::text,cp.tender_id::text,cp.work_name,cp.unit_code,cp.volume,cp.manual_volume,
		       COALESCE(max(bi.sort_number),0)
		FROM public.client_positions cp LEFT JOIN public.boq_items bi ON bi.client_position_id=cp.id
		WHERE cp.id=$1 GROUP BY cp.id`, id).Scan(&p.ID, &p.TenderID, &p.WorkName, &p.UnitCode, &p.Volume, &p.ManualVolume, &p.MaxSort)
	return &p, err
}

func (r *PricingRepo) GetCurrentBoqItem(ctx context.Context, id string) (*BoqItemRow, string, error) {
	item, err := scanBoqItemRow(r.pool.QueryRow(ctx, "SELECT "+boqScanCols+" FROM public.boq_items WHERE id=$1", id))
	if err != nil {
		return nil, "", err
	}
	return item, pricingETag(item.ID, item.UpdatedAt), nil
}

func (r *PricingRepo) TenderDirectTotal(ctx context.Context, tenderID string) (float64, error) {
	var total float64
	err := r.pool.QueryRow(ctx, `SELECT COALESCE(sum(total_amount),0) FROM public.boq_items WHERE tender_id=$1`, tenderID).Scan(&total)
	return total, err
}

func (r *PricingRepo) CountUnresolvedPositions(ctx context.Context, tenderID string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT count(*) FROM public.client_positions cp
		WHERE cp.tender_id=$1 AND NOT EXISTS (
		 SELECT 1 FROM public.boq_items bi WHERE bi.client_position_id=cp.id AND bi.unit_rate IS NOT NULL AND bi.unit_rate>0
		)`, tenderID).Scan(&n)
	return n, err
}

func (r *PricingRepo) ApplyDraft(ctx context.Context, draftID, validationHash, actorID string) (*pricing.ApplyResult, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var status, storedHash, tenderID string
	var baseRevision time.Time
	err = tx.QueryRow(ctx, `SELECT status,COALESCE(validation_hash,''),tender_id::text,base_revision
		FROM public.pricing_drafts WHERE id=$1 FOR UPDATE`, draftID).Scan(&status, &storedHash, &tenderID, &baseRevision)
	if err != nil {
		return nil, err
	}
	if status == "applied" {
		return r.appliedResultTx(ctx, tx, draftID)
	}
	if status != "ready" {
		return nil, ErrDraftNotEditable
	}
	if storedHash == "" || storedHash != validationHash {
		return nil, ErrDraftHashMismatch
	}
	var currentRevision time.Time
	var rates calc.CurrencyRates
	if err := tx.QueryRow(ctx, `SELECT COALESCE(updated_at,created_at,now()),usd_rate,eur_rate,cny_rate
		FROM public.tenders WHERE id=$1 FOR UPDATE`, tenderID).Scan(&currentRevision, &rates.USDRate, &rates.EURRate, &rates.CNYRate); err != nil {
		return nil, err
	}
	if !currentRevision.Equal(baseRevision) {
		return nil, ErrDraftStale
	}
	if err := skipBoqAuditTrigger(ctx, tx); err != nil {
		return nil, err
	}
	ops, err := listDraftOperationsTx(ctx, tx, draftID)
	if err != nil {
		return nil, err
	}
	// Lock and verify every update target before any financial side effect. This
	// keeps stale conflicts fully silent/rollback-free, even in server logs.
	for _, op := range ops {
		if op.Action != "update_item" || op.TargetItemID == nil {
			continue
		}
		var itemID string
		var updatedAt time.Time
		if err := tx.QueryRow(ctx, `SELECT id::text,updated_at FROM public.boq_items WHERE id=$1 FOR UPDATE`, *op.TargetItemID).Scan(&itemID, &updatedAt); err != nil {
			return nil, err
		}
		if op.ExpectedETag == nil || pricingETag(itemID, updatedAt) != *op.ExpectedETag {
			return nil, ErrDraftStale
		}
	}
	// One confirmed draft is one financial-input command. The current portal
	// revision model must be bumped exactly once before BOQ mutations so stale
	// approval is cleared and the normal commercial recalculation can follow.
	if _, err := MarkTenderFinancialInputsChangedTx(ctx, tx, tenderID, "mcp_pricing_draft_apply"); err != nil {
		return nil, err
	}
	createdIDs := map[string]string{}
	affected := map[string]bool{}
	created, updated := 0, 0
	for _, op := range ops {
		if op.Action == "update_item" {
			if op.TargetItemID == nil {
				return nil, errors.New("update operation missing target item")
			}
			old, err := scanBoqItemRow(tx.QueryRow(ctx, "SELECT "+boqScanCols+" FROM public.boq_items WHERE id=$1 FOR UPDATE", *op.TargetItemID))
			if err != nil {
				return nil, err
			}
			if op.ExpectedETag == nil || pricingETag(old.ID, old.UpdatedAt) != *op.ExpectedETag {
				return nil, ErrDraftStale
			}
			payload := op.ProposedPayload
			if err := validateQuoteDates(payload.QuotePriceDate, payload.QuoteValidUntil, old); err != nil {
				return nil, err
			}
			parentID := payloadParent(payload, op.ParentOperationID, createdIDs, old.ParentWorkItemID)
			total, err := calculateProposedTotal(payload, parentID, rates)
			if err != nil {
				return nil, err
			}
			newItem, err := updatePricingItemTx(ctx, tx, old.ID, payload, parentID, total)
			if err != nil {
				return nil, err
			}
			oldJSON, _ := boqRowJSON(old)
			newJSON, _ := boqRowJSON(newItem)
			if err := insertAudit(ctx, tx, old.ID, "UPDATE", actorID, changedFields(old, newItem), oldJSON, newJSON); err != nil {
				return nil, err
			}
			if err := insertPricingSourceTx(ctx, tx, newItem.ID, op, actorID); err != nil {
				return nil, err
			}
			affected[newItem.ClientPositionID] = true
			updated++
			continue
		}
		parentID := payloadParent(op.ProposedPayload, op.ParentOperationID, createdIDs, nil)
		if err := validateQuoteDates(op.ProposedPayload.QuotePriceDate, op.ProposedPayload.QuoteValidUntil, &BoqItemRow{}); err != nil {
			return nil, err
		}
		total, err := calculateProposedTotal(op.ProposedPayload, parentID, rates)
		if err != nil {
			return nil, err
		}
		item, err := insertPricingItemTx(ctx, tx, tenderID, op, parentID, total)
		if err != nil {
			return nil, err
		}
		newJSON, _ := boqRowJSON(item)
		if err := insertAudit(ctx, tx, item.ID, "INSERT", actorID, nil, nil, newJSON); err != nil {
			return nil, err
		}
		if err := insertPricingSourceTx(ctx, tx, item.ID, op, actorID); err != nil {
			return nil, err
		}
		createdIDs[op.ID] = item.ID
		affected[item.ClientPositionID] = true
		created++
	}
	positions := make([]string, 0, len(affected))
	for id := range affected {
		if err := recomputePositionTotalsTx(ctx, tx, id); err != nil {
			return nil, err
		}
		positions = append(positions, id)
	}
	sort.Strings(positions)
	result := &pricing.ApplyResult{DraftID: draftID, Status: "applied", CreatedItems: created, UpdatedItems: updated, AffectedPositions: positions, AppliedAt: time.Now().UTC()}
	resultJSON, _ := json.Marshal(result)
	if _, err := tx.Exec(ctx, `UPDATE public.pricing_drafts SET status='applied',applied_at=now(),summary=jsonb_set(summary,'{apply_result}',$2::jsonb,true) WHERE id=$1`, draftID, resultJSON); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO public.pricing_draft_events (draft_id,actor_id,event_type,details) VALUES ($1,$2,'applied',$3)`, draftID, actorID, resultJSON); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return result, nil
}

func listDraftOperationsTx(ctx context.Context, tx pgx.Tx, draftID string) ([]pricing.DraftOperation, error) {
	rows, err := tx.Query(ctx, `SELECT id::text,draft_id::text,action,target_position_id::text,target_item_id::text,parent_operation_id::text,expected_etag,proposed_payload,source_kind,source_ref,match_level,confidence::float8,rationale,warnings,position_order,created_at
		FROM public.pricing_draft_operations WHERE draft_id=$1 ORDER BY position_order,created_at,id FOR UPDATE`, draftID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []pricing.DraftOperation{}
	for rows.Next() {
		var op pricing.DraftOperation
		var payload, source, warnings []byte
		if err := rows.Scan(&op.ID, &op.DraftID, &op.Action, &op.TargetPositionID, &op.TargetItemID, &op.ParentOperationID, &op.ExpectedETag, &payload, &op.SourceKind, &source, &op.MatchLevel, &op.Confidence, &op.Rationale, &warnings, &op.PositionOrder, &op.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(payload, &op.ProposedPayload)
		_ = json.Unmarshal(source, &op.SourceRef)
		_ = json.Unmarshal(warnings, &op.Warnings)
		out = append(out, op)
	}
	return out, rows.Err()
}

func calculateProposedTotal(p pricing.ProposedItem, parentID *string, rates calc.CurrencyRates) (float64, error) {
	currency, delivery := "", ""
	if p.CurrencyType != nil {
		currency = *p.CurrencyType
	}
	if p.DeliveryPriceType != nil {
		delivery = *p.DeliveryPriceType
	}
	return calc.CalculateBoqItemTotalAmount(calc.BoqItemAmountInput{
		BoqItemType: p.BoqItemType, Quantity: p.Quantity, UnitRate: p.UnitRate,
		CurrencyType: currency, DeliveryPriceType: delivery, DeliveryAmount: p.DeliveryAmount,
		ConsumptionCoefficient: p.ConsumptionCoefficient, ParentWorkItemID: parentID,
	}, rates)
}

func payloadParent(_ pricing.ProposedItem, parentOperationID *string, created map[string]string, existing *string) *string {
	if parentOperationID == nil {
		return existing
	}
	if id := created[*parentOperationID]; id != "" {
		return &id
	}
	return existing
}

func insertPricingItemTx(ctx context.Context, tx pgx.Tx, tenderID string, op pricing.DraftOperation, parentID *string, total float64) (*BoqItemRow, error) {
	p := op.ProposedPayload
	sortNum := op.PositionOrder
	if p.SortNumber != nil {
		sortNum = *p.SortNumber
	}
	q := `INSERT INTO public.boq_items
	 (client_position_id,tender_id,boq_item_type,material_type,description,unit_code,quantity,base_quantity,
	  conversion_coefficient,unit_rate,currency_type,delivery_price_type,delivery_amount,consumption_coefficient,
	  total_amount,detail_cost_category_id,material_name_id,work_name_id,parent_work_item_id,sort_number,quote_link,
	  quote_price_date,quote_valid_until)
	 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::date,$23::date)
	 RETURNING ` + boqScanCols
	return scanBoqItemRow(tx.QueryRow(ctx, q, op.TargetPositionID, tenderID, p.BoqItemType, p.MaterialType,
		p.Description, p.UnitCode, p.Quantity, p.BaseQuantity, p.ConversionCoefficient, p.UnitRate,
		p.CurrencyType, p.DeliveryPriceType, p.DeliveryAmount, p.ConsumptionCoefficient, total,
		p.DetailCostCategoryID, p.MaterialNameID, p.WorkNameID, parentID, sortNum, p.QuoteLink,
		p.QuotePriceDate, p.QuoteValidUntil))
}

func updatePricingItemTx(ctx context.Context, tx pgx.Tx, id string, p pricing.ProposedItem, parentID *string, total float64) (*BoqItemRow, error) {
	q := `UPDATE public.boq_items SET boq_item_type=$2,material_type=$3,description=$4,unit_code=$5,
	 quantity=$6,base_quantity=$7,conversion_coefficient=$8,unit_rate=$9,currency_type=$10,
	 delivery_price_type=$11,delivery_amount=$12,consumption_coefficient=$13,total_amount=$14,
	 detail_cost_category_id=$15,material_name_id=$16,work_name_id=$17,parent_work_item_id=$18,
	 sort_number=COALESCE($19,sort_number),quote_link=$20,quote_price_date=$21::date,
	 quote_valid_until=$22::date,updated_at=now() WHERE id=$1 RETURNING ` + boqScanCols
	return scanBoqItemRow(tx.QueryRow(ctx, q, id, p.BoqItemType, p.MaterialType, p.Description, p.UnitCode,
		p.Quantity, p.BaseQuantity, p.ConversionCoefficient, p.UnitRate, p.CurrencyType,
		p.DeliveryPriceType, p.DeliveryAmount, p.ConsumptionCoefficient, total, p.DetailCostCategoryID,
		p.MaterialNameID, p.WorkNameID, parentID, p.SortNumber, p.QuoteLink, p.QuotePriceDate, p.QuoteValidUntil))
}

func insertPricingSourceTx(ctx context.Context, tx pgx.Tx, itemID string, op pricing.DraftOperation, actorID string) error {
	_, err := tx.Exec(ctx, `INSERT INTO public.boq_item_pricing_sources
	 (boq_item_id,draft_operation_id,source_kind,source_tender_id,source_item_id,source_template_id,
	  source_rate,source_currency,source_date,applied_by)
	 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, itemID, op.ID, op.SourceKind,
		op.SourceRef.TenderID, op.SourceRef.ItemID, op.SourceRef.TemplateID,
		op.SourceRef.Rate, op.SourceRef.Currency, op.SourceRef.Date, actorID)
	return err
}

func recomputePositionTotalsTx(ctx context.Context, tx pgx.Tx, positionID string) error {
	_, err := tx.Exec(ctx, `UPDATE public.client_positions cp SET
	 total_material=COALESCE(s.tm,0),total_works=COALESCE(s.tw,0),updated_at=now()
	 FROM (SELECT sum(total_amount) FILTER (WHERE boq_item_type::text IN ('мат','суб-мат','мат-комп.')) tm,
	              sum(total_amount) FILTER (WHERE boq_item_type::text IN ('раб','суб-раб','раб-комп.')) tw
	       FROM public.boq_items WHERE client_position_id=$1) s WHERE cp.id=$1`, positionID)
	return err
}

func (r *PricingRepo) appliedResultTx(ctx context.Context, tx pgx.Tx, draftID string) (*pricing.ApplyResult, error) {
	var raw []byte
	if err := tx.QueryRow(ctx, `SELECT summary->'apply_result' FROM public.pricing_drafts WHERE id=$1`, draftID).Scan(&raw); err != nil {
		return nil, err
	}
	var result pricing.ApplyResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func pricingETag(id string, updatedAt time.Time) string {
	ts := updatedAt.UTC().Format(time.RFC3339Nano)
	encoded := base64.RawURLEncoding.EncodeToString([]byte(ts))
	sum := sha256.Sum256([]byte(id + "|" + ts))
	return `"` + encoded + ":" + hex.EncodeToString(sum[:4]) + `"`
}
