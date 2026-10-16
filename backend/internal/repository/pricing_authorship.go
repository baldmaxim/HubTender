package repository

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/su10/hubtender/backend/internal/pricing"
)

// MCP may change or delete only the VOR rows and GP values that the caller
// changed last (docs/mcp/AUTHORSHIP.md). Authorship comes from the audit:
// public.boq_item_last_authorship / public.client_position_gp_last_authorship
// (db/yandex/incremental/2026_10_mcp_row_authorship.sql). Portal writes are not
// restricted by this rule.

// MCPAuthorshipError rejects an MCP write that touches someone else's data.
type MCPAuthorshipError struct {
	Subject string // «строка «Монтаж …»», «количество ГП позиции №12»
	Author  string // last author's full name; empty — no author under an account
}

func (e *MCPAuthorshipError) Error() string {
	if e.Author == "" {
		return fmt.Sprintf("MCP_NOT_AUTHOR: %s — нет автора под учёткой (скопировано в версию или изменено системой). Через MCP можно менять и удалять только то, что вы меняли последним; правьте в портале.", e.Subject)
	}
	return fmt.Sprintf("MCP_NOT_AUTHOR: %s — последнее изменение: %s. Через MCP можно менять и удалять только то, что вы меняли последним; правьте в портале или попросите автора.", e.Subject, e.Author)
}

// boqRowAuthor is a row with its last author, in the order requested.
type boqRowAuthor struct {
	pricing.RowChange
	AuthorID *string
}

func boqRowAuthorsTx(ctx context.Context, tx pgx.Tx, ids []string) ([]boqRowAuthor, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := tx.Query(ctx, `
		SELECT b.id::text, COALESCE(wn.name, mn.name, b.description, ''), b.boq_item_type::text,
		       COALESCE(b.unit_code, ''), b.quantity, b.total_amount, la.changed_by::text, u.full_name
		FROM unnest($1::uuid[]) WITH ORDINALITY AS x(id, ord)
		JOIN public.boq_items b ON b.id = x.id
		LEFT JOIN public.work_names wn ON wn.id = b.work_name_id
		LEFT JOIN public.material_names mn ON mn.id = b.material_name_id
		LEFT JOIN LATERAL public.boq_item_last_authorship(b.id) la ON true
		LEFT JOIN public.users u ON u.id = la.changed_by
		ORDER BY x.ord`, ids)
	if err != nil {
		return nil, fmt.Errorf("boqRowAuthorsTx: %w", err)
	}
	defer rows.Close()
	out := make([]boqRowAuthor, 0, len(ids))
	for rows.Next() {
		var r boqRowAuthor
		var authorName *string
		if err := rows.Scan(&r.ItemID, &r.Name, &r.ItemType, &r.UnitCode, &r.Quantity, &r.TotalAmount, &r.AuthorID, &authorName); err != nil {
			return nil, fmt.Errorf("boqRowAuthorsTx: scan: %w", err)
		}
		r.Author = deref(authorName)
		out = append(out, r)
	}
	return out, rows.Err()
}

// requireMCPRowAuthors fails on the first row whose last author is not actorID.
func requireMCPRowAuthors(actorID string, rows []boqRowAuthor) error {
	for _, r := range rows {
		if r.AuthorID == nil || *r.AuthorID != actorID {
			return &MCPAuthorshipError{Subject: fmt.Sprintf("строка «%s»", r.Name), Author: r.Author}
		}
	}
	return nil
}

// linkedMaterialIDsTx lists materials linked to a work; a work change
// recalculates them and a work deletion cascades to them.
func linkedMaterialIDsTx(ctx context.Context, tx pgx.Tx, workID string) ([]string, error) {
	rows, err := tx.Query(ctx, `SELECT id::text FROM public.boq_items WHERE parent_work_item_id = $1 ORDER BY id`, workID)
	if err != nil {
		return nil, fmt.Errorf("linkedMaterialIDsTx: %w", err)
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("linkedMaterialIDsTx: scan: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// requireMCPGPAuthorTx: a filled GP quantity (field "volume") or note ("note")
// may be changed through MCP only by its last author.
func requireMCPGPAuthorTx(ctx context.Context, tx pgx.Tx, actorID, positionID, field, subject string) error {
	var authorID, authorName *string
	err := tx.QueryRow(ctx, `
		SELECT la.changed_by::text, u.full_name
		FROM public.client_position_gp_last_authorship($1, $2) la
		LEFT JOIN public.users u ON u.id = la.changed_by`, positionID, field).Scan(&authorID, &authorName)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("requireMCPGPAuthorTx: %w", err)
	}
	if authorID == nil || *authorID != actorID {
		return &MCPAuthorshipError{Subject: subject, Author: deref(authorName)}
	}
	return nil
}

func sameFloat(a, b *float64) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// changeContextTx describes the tender and position of a write for the
// confirmation window. Call after the position row is locked.
func changeContextTx(ctx context.Context, tx pgx.Tx, positionID string) (*pricing.ChangeContext, string, error) {
	var number, title, workName string
	var version int
	var positionNumber float64
	var total float64
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(t.tender_number, ''), COALESCE(t.title, ''), COALESCE(t.version, 1),
		       cp.position_number, COALESCE(cp.work_name, ''),
		       COALESCE(cp.total_material, 0) + COALESCE(cp.total_works, 0)
		FROM public.client_positions cp JOIN public.tenders t ON t.id = cp.tender_id
		WHERE cp.id = $1`, positionID).Scan(&number, &title, &version, &positionNumber, &workName, &total)
	if err != nil {
		return nil, "", fmt.Errorf("changeContextTx: %w", err)
	}
	positionLabel := "№" + strconv.FormatFloat(positionNumber, 'f', -1, 64)
	return &pricing.ChangeContext{
		Tender:              fmt.Sprintf("№%s «%s», версия %d", number, title, version),
		Position:            fmt.Sprintf("%s «%s»", positionLabel, workName),
		PositionTotalBefore: total,
	}, positionLabel, nil
}

// categoryNameTx returns «Категория / вид затрат» of a row for the window.
func categoryNameTx(ctx context.Context, tx pgx.Tx, detailCategoryID *string) (string, error) {
	if detailCategoryID == nil {
		return "", nil
	}
	var name string
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(cc.name || ' / ', '') || d.name
		FROM public.detail_cost_categories d
		LEFT JOIN public.cost_categories cc ON cc.id = d.cost_category_id
		WHERE d.id = $1`, *detailCategoryID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("categoryNameTx: %w", err)
	}
	return name, nil
}
