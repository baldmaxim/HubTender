package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// LibraryRepo owns works_library / materials_library / templates /
// library_folders CRUD consumed by src/pages/Library/. This file currently
// covers the WorksTab; sibling tabs are added incrementally.
type LibraryRepo struct {
	pool *pgxpool.Pool
}

// NewLibraryRepo creates a LibraryRepo.
func NewLibraryRepo(pool *pgxpool.Pool) *LibraryRepo {
	return &LibraryRepo{pool: pool}
}

// ─── works_library ──────────────────────────────────────────────────────────

// WorkNameEmbed mirrors the work_names(id,name,unit) PostgREST embed.
type WorkNameEmbed struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Unit string `json:"unit"`
}

// WorkLibraryRow mirrors a works_library row + work_names embed.
type WorkLibraryRow struct {
	ID           string         `json:"id"`
	WorkNameID   *string        `json:"work_name_id"`
	ItemType     string         `json:"item_type"`
	UnitRate     float64        `json:"unit_rate"`
	CurrencyType string         `json:"currency_type"`
	FolderID     *string        `json:"folder_id"`
	CreatedAt    *string        `json:"created_at"`
	UpdatedAt    *string        `json:"updated_at"`
	WorkNames    *WorkNameEmbed `json:"work_names"`
}

// WorkLibraryInput is the create/update payload.
type WorkLibraryInput struct {
	WorkNameID   string  `json:"work_name_id"`
	ItemType     string  `json:"item_type"`
	UnitRate     float64 `json:"unit_rate"`
	CurrencyType string  `json:"currency_type"`
}

// ListWorks returns works_library with work_names embed, newest first.
func (r *LibraryRepo) ListWorks(ctx context.Context) ([]WorkLibraryRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT wl.id::text, wl.work_name_id::text, wl.item_type::text,
		       wl.unit_rate, wl.currency_type::text, wl.folder_id::text,
		       to_char(wl.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(wl.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       wn.id::text, wn.name, wn.unit
		FROM public.works_library wl
		LEFT JOIN public.work_names wn ON wn.id = wl.work_name_id
		ORDER BY wl.created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("libraryRepo.ListWorks: %w", err)
	}
	defer rows.Close()
	out := make([]WorkLibraryRow, 0)
	for rows.Next() {
		var w WorkLibraryRow
		var wnID, wnName, wnUnit *string
		if err := rows.Scan(
			&w.ID, &w.WorkNameID, &w.ItemType, &w.UnitRate,
			&w.CurrencyType, &w.FolderID, &w.CreatedAt, &w.UpdatedAt,
			&wnID, &wnName, &wnUnit,
		); err != nil {
			return nil, fmt.Errorf("libraryRepo.ListWorks scan: %w", err)
		}
		if wnID != nil {
			w.WorkNames = &WorkNameEmbed{
				ID:   *wnID,
				Name: derefStr(wnName),
				Unit: derefStr(wnUnit),
			}
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// CreateWork inserts a works_library row.
func (r *LibraryRepo) CreateWork(ctx context.Context, in WorkLibraryInput) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.works_library (work_name_id, item_type, unit_rate, currency_type)
		VALUES ($1::uuid, $2, $3, $4)
	`, in.WorkNameID, in.ItemType, in.UnitRate, in.CurrencyType)
	if err != nil {
		return fmt.Errorf("libraryRepo.CreateWork: %w", err)
	}
	return nil
}

// UpdateWork patches a works_library row.
func (r *LibraryRepo) UpdateWork(ctx context.Context, id string, in WorkLibraryInput) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.works_library
		SET work_name_id  = $1::uuid,
		    item_type     = $2,
		    unit_rate     = $3,
		    currency_type = $4,
		    updated_at    = NOW()
		WHERE id = $5
	`, in.WorkNameID, in.ItemType, in.UnitRate, in.CurrencyType, id)
	if err != nil {
		return fmt.Errorf("libraryRepo.UpdateWork: %w", err)
	}
	return nil
}

// DeleteWork removes a works_library row.
func (r *LibraryRepo) DeleteWork(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM public.works_library WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("libraryRepo.DeleteWork: %w", err)
	}
	return nil
}

// ─── materials_library ──────────────────────────────────────────────────────

// MaterialLibraryRow mirrors a materials_library row + material_names embed.
type MaterialLibraryRow struct {
	ID                     string         `json:"id"`
	MaterialNameID         *string        `json:"material_name_id"`
	MaterialType           string         `json:"material_type"`
	ItemType               string         `json:"item_type"`
	ConsumptionCoefficient *float64       `json:"consumption_coefficient"`
	UnitRate               float64        `json:"unit_rate"`
	CurrencyType           string         `json:"currency_type"`
	DeliveryPriceType      string         `json:"delivery_price_type"`
	DeliveryAmount         *float64       `json:"delivery_amount"`
	FolderID               *string        `json:"folder_id"`
	CreatedAt              *string        `json:"created_at"`
	UpdatedAt              *string        `json:"updated_at"`
	MaterialNames          *WorkNameEmbed `json:"material_names"`
}

// MaterialLibraryInput is the create/update payload.
type MaterialLibraryInput struct {
	MaterialNameID         string  `json:"material_name_id"`
	MaterialType           string  `json:"material_type"`
	ItemType               string  `json:"item_type"`
	ConsumptionCoefficient float64 `json:"consumption_coefficient"`
	UnitRate               float64 `json:"unit_rate"`
	CurrencyType           string  `json:"currency_type"`
	DeliveryPriceType      string  `json:"delivery_price_type"`
	DeliveryAmount         float64 `json:"delivery_amount"`
}

// ListMaterials returns materials_library with material_names embed, newest first.
func (r *LibraryRepo) ListMaterials(ctx context.Context) ([]MaterialLibraryRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT ml.id::text, ml.material_name_id::text, ml.material_type::text,
		       ml.item_type::text, ml.consumption_coefficient, ml.unit_rate,
		       ml.currency_type::text, ml.delivery_price_type::text,
		       ml.delivery_amount, ml.folder_id::text,
		       to_char(ml.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(ml.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       mn.id::text, mn.name, mn.unit
		FROM public.materials_library ml
		LEFT JOIN public.material_names mn ON mn.id = ml.material_name_id
		ORDER BY ml.created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("libraryRepo.ListMaterials: %w", err)
	}
	defer rows.Close()
	out := make([]MaterialLibraryRow, 0)
	for rows.Next() {
		var m MaterialLibraryRow
		var mnID, mnName, mnUnit *string
		if err := rows.Scan(
			&m.ID, &m.MaterialNameID, &m.MaterialType, &m.ItemType,
			&m.ConsumptionCoefficient, &m.UnitRate, &m.CurrencyType,
			&m.DeliveryPriceType, &m.DeliveryAmount, &m.FolderID,
			&m.CreatedAt, &m.UpdatedAt,
			&mnID, &mnName, &mnUnit,
		); err != nil {
			return nil, fmt.Errorf("libraryRepo.ListMaterials scan: %w", err)
		}
		if mnID != nil {
			m.MaterialNames = &WorkNameEmbed{
				ID:   *mnID,
				Name: derefStr(mnName),
				Unit: derefStr(mnUnit),
			}
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// CreateMaterial inserts a materials_library row.
func (r *LibraryRepo) CreateMaterial(ctx context.Context, in MaterialLibraryInput) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.materials_library (
			material_name_id, material_type, item_type, consumption_coefficient,
			unit_rate, currency_type, delivery_price_type, delivery_amount
		) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
	`, in.MaterialNameID, in.MaterialType, in.ItemType, in.ConsumptionCoefficient,
		in.UnitRate, in.CurrencyType, in.DeliveryPriceType, in.DeliveryAmount)
	if err != nil {
		return fmt.Errorf("libraryRepo.CreateMaterial: %w", err)
	}
	return nil
}

// UpdateMaterial patches a materials_library row.
func (r *LibraryRepo) UpdateMaterial(ctx context.Context, id string, in MaterialLibraryInput) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.materials_library
		SET material_name_id        = $1::uuid,
		    material_type           = $2,
		    item_type               = $3,
		    consumption_coefficient = $4,
		    unit_rate               = $5,
		    currency_type           = $6,
		    delivery_price_type     = $7,
		    delivery_amount         = $8,
		    updated_at              = NOW()
		WHERE id = $9
	`, in.MaterialNameID, in.MaterialType, in.ItemType, in.ConsumptionCoefficient,
		in.UnitRate, in.CurrencyType, in.DeliveryPriceType, in.DeliveryAmount, id)
	if err != nil {
		return fmt.Errorf("libraryRepo.UpdateMaterial: %w", err)
	}
	return nil
}

// DeleteMaterial removes a materials_library row.
func (r *LibraryRepo) DeleteMaterial(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM public.materials_library WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("libraryRepo.DeleteMaterial: %w", err)
	}
	return nil
}

// ─── library_folders ────────────────────────────────────────────────────────

// LibraryFolderRow mirrors a library_folders row (no updated_at column).
type LibraryFolderRow struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Type      string  `json:"type"`
	SortOrder int     `json:"sort_order"`
	ParentID  *string `json:"parent_id"`
	CreatedAt *string `json:"created_at"`
}

// LibraryFolderInput is the create payload.
type LibraryFolderInput struct {
	Name     string  `json:"name"`
	Type     string  `json:"type"`
	ParentID *string `json:"parent_id"`
}

// moveItemTables is the allowlist for MoveLibraryItem — the table name is
// interpolated into SQL, so it must never come unchecked from the request.
var moveItemTables = map[string]bool{
	"works_library":     true,
	"materials_library": true,
	"templates":         true,
}

// ListFolders returns folders of a given type, ordered by (sort_order, name).
func (r *LibraryRepo) ListFolders(ctx context.Context, folderType string) ([]LibraryFolderRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, name, type, sort_order, parent_id::text,
		       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM public.library_folders
		WHERE type = $1
		ORDER BY sort_order, name
	`, folderType)
	if err != nil {
		return nil, fmt.Errorf("libraryRepo.ListFolders: %w", err)
	}
	defer rows.Close()
	out := make([]LibraryFolderRow, 0)
	for rows.Next() {
		var f LibraryFolderRow
		if err := rows.Scan(&f.ID, &f.Name, &f.Type, &f.SortOrder,
			&f.ParentID, &f.CreatedAt); err != nil {
			return nil, fmt.Errorf("libraryRepo.ListFolders scan: %w", err)
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// CreateFolder inserts a library_folders row.
func (r *LibraryRepo) CreateFolder(ctx context.Context, in LibraryFolderInput) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.library_folders (name, type, parent_id)
		VALUES ($1, $2, $3::uuid)
	`, in.Name, in.Type, in.ParentID)
	if err != nil {
		return fmt.Errorf("libraryRepo.CreateFolder: %w", err)
	}
	return nil
}

// RenameFolder updates a folder's name.
func (r *LibraryRepo) RenameFolder(ctx context.Context, id, name string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE public.library_folders SET name = $1 WHERE id = $2`, name, id)
	if err != nil {
		return fmt.Errorf("libraryRepo.RenameFolder: %w", err)
	}
	return nil
}

// DeleteFolder removes a library_folders row.
func (r *LibraryRepo) DeleteFolder(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM public.library_folders WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("libraryRepo.DeleteFolder: %w", err)
	}
	return nil
}

// MoveLibraryItem sets folder_id on a works_library / materials_library /
// templates row. table must be in the allowlist (validated by caller).
func (r *LibraryRepo) MoveLibraryItem(ctx context.Context, table, itemID string, folderID *string) error {
	if !moveItemTables[table] {
		return fmt.Errorf("libraryRepo.MoveLibraryItem: invalid table %q", table)
	}
	q := fmt.Sprintf(
		`UPDATE public.%s SET folder_id = $1::uuid WHERE id = $2`, table)
	if _, err := r.pool.Exec(ctx, q, folderID, itemID); err != nil {
		return fmt.Errorf("libraryRepo.MoveLibraryItem: %w", err)
	}
	return nil
}

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
