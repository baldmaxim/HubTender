package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ─── templates / template_items ─────────────────────────────────────────────

// CostCatEmbed mirrors cost_categories(name).
type CostCatEmbed struct {
	Name string `json:"name"`
}

// DetailCatEmbed mirrors detail_cost_categories(name, location, cost_categories(name)).
type DetailCatEmbed struct {
	Name           string        `json:"name"`
	Location       *string       `json:"location"`
	CostCategories *CostCatEmbed `json:"cost_categories"`
}

// TemplateRow mirrors a templates row + detail_cost_categories embed.
type TemplateRow struct {
	ID                   string          `json:"id"`
	Name                 string          `json:"name"`
	DetailCostCategoryID *string         `json:"detail_cost_category_id"`
	FolderID             *string         `json:"folder_id"`
	CreatedAt            *string         `json:"created_at"`
	UpdatedAt            *string         `json:"updated_at"`
	DetailCostCategories *DetailCatEmbed `json:"detail_cost_categories"`
}

// TemplateItemWorkLib is the works_library embed (only fields formatItem uses).
type TemplateItemWorkLib struct {
	ItemType     *string        `json:"item_type"`
	UnitRate     *float64       `json:"unit_rate"`
	CurrencyType *string        `json:"currency_type"`
	WorkNames    *WorkNameEmbed `json:"work_names"`
}

// TemplateItemMatLib is the materials_library embed.
type TemplateItemMatLib struct {
	ItemType               *string        `json:"item_type"`
	MaterialType           *string        `json:"material_type"`
	ConsumptionCoefficient *float64       `json:"consumption_coefficient"`
	UnitRate               *float64       `json:"unit_rate"`
	CurrencyType           *string        `json:"currency_type"`
	DeliveryPriceType      *string        `json:"delivery_price_type"`
	DeliveryAmount         *float64       `json:"delivery_amount"`
	MaterialNames          *WorkNameEmbed `json:"material_names"`
}

// TemplateItemRow mirrors a template_items row + nested library/category embeds.
type TemplateItemRow struct {
	ID                   string               `json:"id"`
	TemplateID           string               `json:"template_id"`
	Kind                 string               `json:"kind"`
	WorkLibraryID        *string              `json:"work_library_id"`
	MaterialLibraryID    *string              `json:"material_library_id"`
	ParentWorkItemID     *string              `json:"parent_work_item_id"`
	ConversationCoeff    *float64             `json:"conversation_coeff"`
	Position             int                  `json:"position"`
	Note                 *string              `json:"note"`
	DetailCostCategoryID *string              `json:"detail_cost_category_id"`
	CreatedAt            *string              `json:"created_at"`
	UpdatedAt            *string              `json:"updated_at"`
	WorksLibrary         *TemplateItemWorkLib `json:"works_library"`
	MaterialsLibrary     *TemplateItemMatLib  `json:"materials_library"`
	DetailCostCategories *DetailCatEmbed      `json:"detail_cost_categories"`
}

const templateItemSelect = `
	SELECT ti.id::text, ti.template_id::text, ti.kind,
	       ti.work_library_id::text, ti.material_library_id::text,
	       ti.parent_work_item_id::text, ti.conversation_coeff, ti.position, ti.note,
	       ti.detail_cost_category_id::text,
	       to_char(ti.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
	       to_char(ti.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
	       (wl.id IS NOT NULL), wl.item_type::text, wl.unit_rate, wl.currency_type::text,
	       wn.name, wn.unit,
	       (ml.id IS NOT NULL), ml.item_type::text, ml.material_type::text,
	       ml.consumption_coefficient, ml.unit_rate, ml.currency_type::text,
	       ml.delivery_price_type::text, ml.delivery_amount, mn.name, mn.unit,
	       (dcc.id IS NOT NULL), dcc.name, dcc.location, cc.name
	FROM public.template_items ti
	LEFT JOIN public.works_library     wl  ON wl.id  = ti.work_library_id
	LEFT JOIN public.work_names        wn  ON wn.id  = wl.work_name_id
	LEFT JOIN public.materials_library ml  ON ml.id  = ti.material_library_id
	LEFT JOIN public.material_names    mn  ON mn.id  = ml.material_name_id
	LEFT JOIN public.detail_cost_categories dcc ON dcc.id = ti.detail_cost_category_id
	LEFT JOIN public.cost_categories   cc  ON cc.id  = dcc.cost_category_id
`

func scanTemplateItem(row interface{ Scan(...any) error }) (*TemplateItemRow, error) {
	var t TemplateItemRow
	var hasWL, hasML, hasDCC bool
	var wType, wCur, wnName, wnUnit *string
	var wRate *float64
	var mType, mMatType, mCur, mDPT, mnName, mnUnit *string
	var mCons, mRate, mDeliv *float64
	var dccName, dccLoc, ccName *string
	if err := row.Scan(
		&t.ID, &t.TemplateID, &t.Kind,
		&t.WorkLibraryID, &t.MaterialLibraryID,
		&t.ParentWorkItemID, &t.ConversationCoeff, &t.Position, &t.Note,
		&t.DetailCostCategoryID, &t.CreatedAt, &t.UpdatedAt,
		&hasWL, &wType, &wRate, &wCur, &wnName, &wnUnit,
		&hasML, &mType, &mMatType, &mCons, &mRate, &mCur, &mDPT, &mDeliv, &mnName, &mnUnit,
		&hasDCC, &dccName, &dccLoc, &ccName,
	); err != nil {
		return nil, err
	}
	if hasWL {
		wl := &TemplateItemWorkLib{ItemType: wType, UnitRate: wRate, CurrencyType: wCur}
		if wnName != nil || wnUnit != nil {
			wl.WorkNames = &WorkNameEmbed{Name: derefStr(wnName), Unit: derefStr(wnUnit)}
		}
		t.WorksLibrary = wl
	}
	if hasML {
		ml := &TemplateItemMatLib{
			ItemType: mType, MaterialType: mMatType, ConsumptionCoefficient: mCons,
			UnitRate: mRate, CurrencyType: mCur, DeliveryPriceType: mDPT, DeliveryAmount: mDeliv,
		}
		if mnName != nil || mnUnit != nil {
			ml.MaterialNames = &WorkNameEmbed{Name: derefStr(mnName), Unit: derefStr(mnUnit)}
		}
		t.MaterialsLibrary = ml
	}
	if hasDCC {
		dc := &DetailCatEmbed{Name: derefStr(dccName), Location: dccLoc}
		if ccName != nil {
			dc.CostCategories = &CostCatEmbed{Name: *ccName}
		}
		t.DetailCostCategories = dc
	}
	return &t, nil
}

// ListTemplates returns templates with detail_cost_categories embed, newest first.
func (r *LibraryRepo) ListTemplates(ctx context.Context) ([]TemplateRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT t.id::text, t.name, t.detail_cost_category_id::text, t.folder_id::text,
		       to_char(t.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(t.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       (dcc.id IS NOT NULL), dcc.name, dcc.location, cc.name
		FROM public.templates t
		LEFT JOIN public.detail_cost_categories dcc ON dcc.id = t.detail_cost_category_id
		LEFT JOIN public.cost_categories cc ON cc.id = dcc.cost_category_id
		ORDER BY t.created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("libraryRepo.ListTemplates: %w", err)
	}
	defer rows.Close()
	out := make([]TemplateRow, 0)
	for rows.Next() {
		var t TemplateRow
		var hasDCC bool
		var dccName, dccLoc, ccName *string
		if err := rows.Scan(&t.ID, &t.Name, &t.DetailCostCategoryID, &t.FolderID,
			&t.CreatedAt, &t.UpdatedAt, &hasDCC, &dccName, &dccLoc, &ccName); err != nil {
			return nil, fmt.Errorf("libraryRepo.ListTemplates scan: %w", err)
		}
		if hasDCC {
			dc := &DetailCatEmbed{Name: derefStr(dccName), Location: dccLoc}
			if ccName != nil {
				dc.CostCategories = &CostCatEmbed{Name: *ccName}
			}
			t.DetailCostCategories = dc
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// DeleteTemplate removes a template (template_items cascade via FK).
func (r *LibraryRepo) DeleteTemplate(ctx context.Context, id string) error {
	if _, err := r.pool.Exec(ctx, `DELETE FROM public.templates WHERE id = $1`, id); err != nil {
		return fmt.Errorf("libraryRepo.DeleteTemplate: %w", err)
	}
	return nil
}

// ListTemplateItems returns a template's items + nested embeds, by position.
func (r *LibraryRepo) ListTemplateItems(ctx context.Context, templateID string) ([]TemplateItemRow, error) {
	rows, err := r.pool.Query(ctx, templateItemSelect+`
		WHERE ti.template_id = $1
		ORDER BY ti.position
	`, templateID)
	if err != nil {
		return nil, fmt.Errorf("libraryRepo.ListTemplateItems: %w", err)
	}
	defer rows.Close()
	out := make([]TemplateItemRow, 0)
	for rows.Next() {
		ti, scanErr := scanTemplateItem(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("libraryRepo.ListTemplateItems scan: %w", scanErr)
		}
		out = append(out, *ti)
	}
	return out, rows.Err()
}

// DeleteTemplateItem unlinks child materials (parent_work_item_id ON DELETE
// CASCADE would otherwise delete them) then deletes the row — one tx,
// replicating the legacy two-step useTemplateItems.handleDeleteTemplateItem.
func (r *LibraryRepo) DeleteTemplateItem(ctx context.Context, id string) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("libraryRepo.DeleteTemplateItem: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `
		UPDATE public.template_items
		SET parent_work_item_id = NULL, conversation_coeff = NULL
		WHERE parent_work_item_id = $1
	`, id); err != nil {
		return fmt.Errorf("libraryRepo.DeleteTemplateItem: unlink children: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM public.template_items WHERE id = $1`, id); err != nil {
		return fmt.Errorf("libraryRepo.DeleteTemplateItem: delete: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("libraryRepo.DeleteTemplateItem: commit: %w", err)
	}
	return nil
}

// TemplateWorkInput / TemplateMaterialInput / CreateTemplateInput drive the
// atomic template-creation flow (useTemplateCreation.saveTemplate).
type TemplateWorkInput struct {
	WorkLibraryID        *string `json:"work_library_id"`
	DetailCostCategoryID *string `json:"detail_cost_category_id"`
	Note                 *string `json:"note"`
}

type TemplateMaterialInput struct {
	MaterialLibraryID    *string  `json:"material_library_id"`
	ParentWorkIndex      *int     `json:"parent_work_index"`
	ConversationCoeff    *float64 `json:"conversation_coeff"`
	DetailCostCategoryID *string  `json:"detail_cost_category_id"`
	Note                 *string  `json:"note"`
}

type CreateTemplateInput struct {
	Name                 string                  `json:"name"`
	DetailCostCategoryID string                  `json:"detail_cost_category_id"`
	Works                []TemplateWorkInput     `json:"works"`
	Materials            []TemplateMaterialInput `json:"materials"`
}

// CreateTemplate inserts a template + its work/material items atomically,
// resolving material→work parent links by work-array index.
func (r *LibraryRepo) CreateTemplate(ctx context.Context, in CreateTemplateInput) (string, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", fmt.Errorf("libraryRepo.CreateTemplate: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var templateID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO public.templates (name, detail_cost_category_id)
		VALUES ($1, $2::uuid) RETURNING id::text
	`, in.Name, in.DetailCostCategoryID).Scan(&templateID); err != nil {
		return "", fmt.Errorf("libraryRepo.CreateTemplate: insert template: %w", err)
	}

	workIDs := make([]string, len(in.Works))
	for i, wkr := range in.Works {
		var itemID string
		if err := tx.QueryRow(ctx, `
			INSERT INTO public.template_items
				(template_id, kind, work_library_id, material_library_id,
				 parent_work_item_id, conversation_coeff, detail_cost_category_id,
				 position, note)
			VALUES ($1::uuid, 'work', $2::uuid, NULL, NULL, NULL, $3::uuid, $4, $5)
			RETURNING id::text
		`, templateID, wkr.WorkLibraryID, wkr.DetailCostCategoryID, i, wkr.Note).Scan(&itemID); err != nil {
			return "", fmt.Errorf("libraryRepo.CreateTemplate: insert work: %w", err)
		}
		workIDs[i] = itemID
	}

	for i, mat := range in.Materials {
		var parentID *string
		if mat.ParentWorkIndex != nil {
			idx := *mat.ParentWorkIndex
			if idx >= 0 && idx < len(workIDs) {
				parentID = &workIDs[idx]
			}
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO public.template_items
				(template_id, kind, work_library_id, material_library_id,
				 parent_work_item_id, conversation_coeff, detail_cost_category_id,
				 position, note)
			VALUES ($1::uuid, 'material', NULL, $2::uuid, $3::uuid, $4, $5::uuid, $6, $7)
		`, templateID, mat.MaterialLibraryID, parentID, mat.ConversationCoeff,
			mat.DetailCostCategoryID, len(in.Works)+i, mat.Note); err != nil {
			return "", fmt.Errorf("libraryRepo.CreateTemplate: insert material: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("libraryRepo.CreateTemplate: commit: %w", err)
	}
	return templateID, nil
}

// TemplateItemPatch is one row of the edit-time upsert.
type TemplateItemPatch struct {
	ID                   string   `json:"id"`
	ParentWorkItemID     *string  `json:"parent_work_item_id"`
	ConversationCoeff    *float64 `json:"conversation_coeff"`
	DetailCostCategoryID *string  `json:"detail_cost_category_id"`
}

type UpdateTemplateInput struct {
	Name                 string              `json:"name"`
	DetailCostCategoryID string              `json:"detail_cost_category_id"`
	Items                []TemplateItemPatch `json:"items"`
}

// UpdateTemplate patches the template header + each item's links, one tx
// (replicating useTemplateEditing.saveEditing).
func (r *LibraryRepo) UpdateTemplate(ctx context.Context, id string, in UpdateTemplateInput) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("libraryRepo.UpdateTemplate: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `
		UPDATE public.templates
		SET name = $1, detail_cost_category_id = $2::uuid, updated_at = NOW()
		WHERE id = $3
	`, in.Name, in.DetailCostCategoryID, id); err != nil {
		return fmt.Errorf("libraryRepo.UpdateTemplate: update template: %w", err)
	}
	for _, it := range in.Items {
		if _, err := tx.Exec(ctx, `
			UPDATE public.template_items
			SET parent_work_item_id    = $1::uuid,
			    conversation_coeff     = $2,
			    detail_cost_category_id = $3::uuid,
			    updated_at             = NOW()
			WHERE id = $4
		`, it.ParentWorkItemID, it.ConversationCoeff, it.DetailCostCategoryID, it.ID); err != nil {
			return fmt.Errorf("libraryRepo.UpdateTemplate: update item: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("libraryRepo.UpdateTemplate: commit: %w", err)
	}
	return nil
}

// AddTemplateItemInput adds one work/material to an existing template.
type AddTemplateItemInput struct {
	Kind              string  `json:"kind"`
	WorkLibraryID     *string `json:"work_library_id"`
	MaterialLibraryID *string `json:"material_library_id"`
	Position          int     `json:"position"`
}

// AddTemplateItem inserts a single item and returns it with embeds (the
// shape useTemplateEditing.addWork/addMaterial expect for local state).
func (r *LibraryRepo) AddTemplateItem(ctx context.Context, templateID string, in AddTemplateItemInput) (*TemplateItemRow, error) {
	var newID string
	if err := r.pool.QueryRow(ctx, `
		INSERT INTO public.template_items
			(template_id, kind, work_library_id, material_library_id,
			 parent_work_item_id, conversation_coeff, position, note)
		VALUES ($1::uuid, $2, $3::uuid, $4::uuid, NULL, NULL, $5, NULL)
		RETURNING id::text
	`, templateID, in.Kind, in.WorkLibraryID, in.MaterialLibraryID, in.Position).Scan(&newID); err != nil {
		return nil, fmt.Errorf("libraryRepo.AddTemplateItem: insert: %w", err)
	}
	row := r.pool.QueryRow(ctx, templateItemSelect+` WHERE ti.id = $1`, newID)
	ti, err := scanTemplateItem(row)
	if err != nil {
		return nil, fmt.Errorf("libraryRepo.AddTemplateItem: scan: %w", err)
	}
	return ti, nil
}
