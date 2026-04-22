package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ImportBoqItem represents one row of the items array from the request body.
// Nullable UUID and numeric fields use pointer types so that a JSON null or
// omitted key is cleanly represented as nil — matching the NULLIF-empty-string
// pattern in the original PL/pgSQL.
type ImportBoqItem struct {
	// RowIndex is used for error messages only (optional, matches row_index in SQL).
	RowIndex *int `json:"row_index"`

	// Required: the position this item belongs to.
	ClientPositionID string `json:"client_position_id"`

	// TempID is an opaque string the caller uses to link a parent work item
	// to its children within the same batch. If set, the inserted UUID is
	// recorded in the work-ref map.
	TempID *string `json:"temp_id"`

	// ParentWorkTempID references a TempID in a previously processed item
	// within the same batch. Resolved to a real UUID before INSERT.
	ParentWorkTempID *string `json:"parent_work_temp_id"`

	BoqItemType          string   `json:"boq_item_type"`
	WorkNameID           *string  `json:"work_name_id"`
	MaterialNameID       *string  `json:"material_name_id"`
	UnitCode             *string  `json:"unit_code"`
	Quantity             *float64 `json:"quantity"`
	BaseQuantity         *float64 `json:"base_quantity"`
	ConversionCoeff      *float64 `json:"conversion_coefficient"`
	ConsumptionCoeff     *float64 `json:"consumption_coefficient"`
	UnitRate             *float64 `json:"unit_rate"`
	CurrencyType         *string  `json:"currency_type"`
	TotalAmount          *float64 `json:"total_amount"`
	DeliveryPriceType    *string  `json:"delivery_price_type"`
	DeliveryAmount       *float64 `json:"delivery_amount"`
	QuoteLink            *string  `json:"quote_link"`
	DetailCostCategoryID *string  `json:"detail_cost_category_id"`
	MaterialType         *string  `json:"material_type"`
	Description          *string  `json:"description"`
}

// ImportPositionUpdate represents one element of the position_updates array.
//
// Conditional-update semantics (matching PL/pgSQL `v_pos_update ? 'key'`):
// The frontend controls which columns are updated by including or omitting the
// JSON key entirely. We use json.RawMessage to capture the raw bytes of each
// field so we can distinguish "key absent" (nil RawMessage) from "key present
// with value null" (RawMessage(`null`)). The BulkImport method checks
// rawManualVolume != nil / rawManualNote != nil before updating the column.
type ImportPositionUpdate struct {
	PositionID string `json:"position_id"`

	// RawManualVolume and RawManualNote hold the raw JSON value when the key
	// was present in the request object, or nil when the key was absent.
	RawManualVolume json.RawMessage `json:"manual_volume"`
	RawManualNote   json.RawMessage `json:"manual_note"`
}

// ImportInput is the full payload passed from the service layer to the repo.
type ImportInput struct {
	TenderID        string
	FileName        string
	UserID          string // empty string → no import_sessions row
	Items           []ImportBoqItem
	PositionUpdates []ImportPositionUpdate
}

// ImportResult mirrors the JSONB returned by the original RPC.
type ImportResult struct {
	ImportSessionID     *string `json:"import_session_id"`
	InsertedItemsCount  int     `json:"inserted_items_count"`
	UpdatedPositionsCount int   `json:"updated_positions_count"`
}

// ErrBulkImport is a sentinel type for 400-class errors raised inside the
// transaction (missing position, unresolved temp ref). The handler distinguishes
// these from 500-class DB errors.
type ErrBulkImport struct {
	Message string
}

func (e *ErrBulkImport) Error() string { return e.Message }

// ImportRepo handles bulk BOQ import operations in a single pgx.Tx.
type ImportRepo struct {
	pool *pgxpool.Pool
}

// NewImportRepo creates an ImportRepo.
func NewImportRepo(pool *pgxpool.Pool) *ImportRepo {
	return &ImportRepo{pool: pool}
}

// BulkImport replicates the logic of public.bulk_import_client_position_boq
// in Go. Steps 2-5 execute inside a single pgx.Tx — the function either
// commits fully or rolls back on any error.
func (r *ImportRepo) BulkImport(ctx context.Context, in ImportInput) (*ImportResult, error) {
	// ------------------------------------------------------------------
	// Step 1: collect distinct affected position IDs (pre-tx, read-only).
	// ------------------------------------------------------------------
	affectedSet := make(map[string]struct{})
	for _, item := range in.Items {
		if item.ClientPositionID != "" {
			affectedSet[item.ClientPositionID] = struct{}{}
		}
	}
	for _, pu := range in.PositionUpdates {
		if pu.PositionID != "" {
			affectedSet[pu.PositionID] = struct{}{}
		}
	}
	affectedIDs := make([]string, 0, len(affectedSet))
	for id := range affectedSet {
		affectedIDs = append(affectedIDs, id)
	}

	// ------------------------------------------------------------------
	// Begin transaction (covers steps 2-5).
	// ------------------------------------------------------------------
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("importRepo.BulkImport: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	result := &ImportResult{}

	// ------------------------------------------------------------------
	// Step 2: insert import_sessions row if user_id is non-empty.
	// ------------------------------------------------------------------
	var importSessionID *string
	if in.UserID != "" {
		const snapshotQ = `
			SELECT COALESCE(
				jsonb_agg(
					jsonb_build_object(
						'id', cp.id,
						'manual_volume', cp.manual_volume,
						'manual_note', cp.manual_note
					)
				),
				'[]'::jsonb
			)
			FROM public.client_positions cp
			WHERE cp.id = ANY($1::uuid[])
		`
		var snapshotJSON []byte
		if err := tx.QueryRow(ctx, snapshotQ, affectedIDs).Scan(&snapshotJSON); err != nil {
			return nil, fmt.Errorf("importRepo.BulkImport: snapshot query: %w", err)
		}

		const sessionQ = `
			INSERT INTO public.import_sessions (user_id, tender_id, file_name, positions_snapshot)
			VALUES ($1::uuid, $2::uuid, $3, $4::jsonb)
			RETURNING id
		`
		var sessionID string
		if err := tx.QueryRow(ctx, sessionQ,
			in.UserID, in.TenderID, in.FileName, snapshotJSON,
		).Scan(&sessionID); err != nil {
			return nil, fmt.Errorf("importRepo.BulkImport: insert import_sessions: %w", err)
		}
		importSessionID = &sessionID
	}

	// ------------------------------------------------------------------
	// Step 3: sort items by (client_position_id, original index) then loop.
	// ------------------------------------------------------------------
	type indexedItem struct {
		idx  int
		item ImportBoqItem
	}
	indexed := make([]indexedItem, len(in.Items))
	for i, it := range in.Items {
		indexed[i] = indexedItem{idx: i, item: it}
	}
	sort.SliceStable(indexed, func(a, b int) bool {
		if indexed[a].item.ClientPositionID != indexed[b].item.ClientPositionID {
			return indexed[a].item.ClientPositionID < indexed[b].item.ClientPositionID
		}
		return indexed[a].idx < indexed[b].idx
	})

	// work-ref map: temp_id string → real UUID string
	workRefMap := make(map[string]string)

	var currentPositionID string
	var currentMaxSort int
	var positionItemIndex int

	const maxSortQ = `
		SELECT COALESCE(MAX(sort_number), -1)
		FROM public.boq_items
		WHERE client_position_id = $1::uuid
	`

	const insertBoqQ = `
		INSERT INTO public.boq_items (
			tender_id,
			client_position_id,
			sort_number,
			boq_item_type,
			work_name_id,
			material_name_id,
			parent_work_item_id,
			unit_code,
			quantity,
			base_quantity,
			conversion_coefficient,
			consumption_coefficient,
			unit_rate,
			currency_type,
			total_amount,
			delivery_price_type,
			delivery_amount,
			quote_link,
			detail_cost_category_id,
			material_type,
			description,
			import_session_id
		) VALUES (
			$1::uuid,
			$2::uuid,
			$3,
			$4::public.boq_item_type,
			$5::uuid,
			$6::uuid,
			$7::uuid,
			$8,
			$9,
			$10,
			$11,
			$12,
			$13,
			COALESCE($14::public.currency_type, 'RUB'::public.currency_type),
			COALESCE($15, 0),
			$16::public.delivery_price_type,
			$17,
			$18,
			$19::uuid,
			$20::public.material_type,
			$21,
			$22::uuid
		)
		RETURNING id
	`

	for _, ii := range indexed {
		item := ii.item

		// Validate required field.
		if item.ClientPositionID == "" {
			rowLabel := "?"
			if item.RowIndex != nil {
				rowLabel = fmt.Sprintf("%d", *item.RowIndex)
			}
			return nil, &ErrBulkImport{
				Message: fmt.Sprintf("Bulk BOQ import: missing client_position_id for row %s", rowLabel),
			}
		}

		// Reset sort tracking when the position changes.
		if item.ClientPositionID != currentPositionID {
			currentPositionID = item.ClientPositionID
			positionItemIndex = 0

			if err := tx.QueryRow(ctx, maxSortQ, currentPositionID).Scan(&currentMaxSort); err != nil {
				return nil, fmt.Errorf("importRepo.BulkImport: max sort query for position %s: %w",
					currentPositionID, err)
			}
		}

		positionItemIndex++
		sortNumber := currentMaxSort + positionItemIndex

		// Resolve parent_work_temp_id → real UUID.
		var parentWorkItemID *string
		if item.ParentWorkTempID != nil && *item.ParentWorkTempID != "" {
			resolved, ok := workRefMap[*item.ParentWorkTempID]
			if !ok {
				rowLabel := "?"
				if item.RowIndex != nil {
					rowLabel = fmt.Sprintf("%d", *item.RowIndex)
				}
				return nil, &ErrBulkImport{
					Message: fmt.Sprintf(
						"Bulk BOQ import: parent work not resolved for row %s, temp ref %s",
						rowLabel, *item.ParentWorkTempID,
					),
				}
			}
			parentWorkItemID = &resolved
		}

		var insertedID string
		if err := tx.QueryRow(ctx, insertBoqQ,
			in.TenderID,         // $1  tender_id
			currentPositionID,   // $2  client_position_id
			sortNumber,          // $3  sort_number
			item.BoqItemType,    // $4  boq_item_type
			item.WorkNameID,     // $5  work_name_id
			item.MaterialNameID, // $6  material_name_id
			parentWorkItemID,    // $7  parent_work_item_id
			item.UnitCode,       // $8  unit_code
			item.Quantity,       // $9  quantity
			item.BaseQuantity,   // $10 base_quantity
			item.ConversionCoeff,  // $11 conversion_coefficient
			item.ConsumptionCoeff, // $12 consumption_coefficient
			item.UnitRate,         // $13 unit_rate
			item.CurrencyType,     // $14 currency_type (COALESCE → 'RUB')
			item.TotalAmount,      // $15 total_amount  (COALESCE → 0)
			item.DeliveryPriceType, // $16 delivery_price_type
			item.DeliveryAmount,    // $17 delivery_amount
			item.QuoteLink,         // $18 quote_link
			item.DetailCostCategoryID, // $19 detail_cost_category_id
			item.MaterialType,     // $20 material_type
			item.Description,      // $21 description
			importSessionID,       // $22 import_session_id
		).Scan(&insertedID); err != nil {
			return nil, fmt.Errorf("importRepo.BulkImport: insert boq_item (position %s): %w",
				currentPositionID, err)
		}

		result.InsertedItemsCount++

		// Record temp_id → real UUID for parent_work linking.
		if item.TempID != nil && *item.TempID != "" {
			workRefMap[*item.TempID] = insertedID
		}
	}

	// ------------------------------------------------------------------
	// Step 4: conditional UPDATE of client_positions for each update entry.
	// Key-presence check: json.RawMessage is non-nil when the key appeared in
	// the JSON object, regardless of whether the value was null or a number.
	// ------------------------------------------------------------------
	for _, pu := range in.PositionUpdates {
		if pu.PositionID == "" {
			continue
		}

		// Build the SET clause conditionally based on which keys were present.
		setManualVolume := pu.RawManualVolume != nil
		setManualNote := pu.RawManualNote != nil

		if !setManualVolume && !setManualNote {
			// Nothing to update — skip rather than execute a no-op UPDATE.
			continue
		}

		// Parse the raw values only when the key was present.
		var manualVolume *float64
		if setManualVolume {
			if string(pu.RawManualVolume) != "null" {
				var v float64
				if err := json.Unmarshal(pu.RawManualVolume, &v); err != nil {
					return nil, &ErrBulkImport{
						Message: fmt.Sprintf("Bulk BOQ import: invalid manual_volume for position %s", pu.PositionID),
					}
				}
				manualVolume = &v
			}
			// else leave manualVolume nil → SQL NULL
		}

		var manualNote *string
		if setManualNote {
			if string(pu.RawManualNote) != "null" {
				var s string
				if err := json.Unmarshal(pu.RawManualNote, &s); err != nil {
					return nil, &ErrBulkImport{
						Message: fmt.Sprintf("Bulk BOQ import: invalid manual_note for position %s", pu.PositionID),
					}
				}
				manualNote = &s
			}
			// else leave manualNote nil → SQL NULL
		}

		// Issue the UPDATE with only the columns that should change.
		// Both columns are always in the SET clause when both keys are present;
		// individual branches handle each combination.
		var tag pgconn.CommandTag
		switch {
		case setManualVolume && setManualNote:
			const q = `
				UPDATE public.client_positions
				SET manual_volume = $1, manual_note = $2
				WHERE id = $3::uuid
			`
			tag, err = tx.Exec(ctx, q, manualVolume, manualNote, pu.PositionID)
		case setManualVolume:
			const q = `
				UPDATE public.client_positions
				SET manual_volume = $1
				WHERE id = $2::uuid
			`
			tag, err = tx.Exec(ctx, q, manualVolume, pu.PositionID)
		default: // setManualNote only
			const q = `
				UPDATE public.client_positions
				SET manual_note = $1
				WHERE id = $2::uuid
			`
			tag, err = tx.Exec(ctx, q, manualNote, pu.PositionID)
		}
		if err != nil {
			return nil, fmt.Errorf("importRepo.BulkImport: update position %s: %w", pu.PositionID, err)
		}
		if tag.RowsAffected() > 0 {
			result.UpdatedPositionsCount++
		}
	}

	// ------------------------------------------------------------------
	// Step 5: patch items_count on the import_sessions row.
	// ------------------------------------------------------------------
	if importSessionID != nil {
		const updateSessionQ = `
			UPDATE public.import_sessions
			SET items_count = $1
			WHERE id = $2::uuid
		`
		if _, err := tx.Exec(ctx, updateSessionQ, result.InsertedItemsCount, *importSessionID); err != nil {
			return nil, fmt.Errorf("importRepo.BulkImport: update import_sessions: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("importRepo.BulkImport: commit: %w", err)
	}

	result.ImportSessionID = importSessionID
	return result, nil
}
