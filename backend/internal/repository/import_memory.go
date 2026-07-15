package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	importmemory "github.com/su10/hubtender/backend/internal/importmemory"
)

// ImportMemoryRepo — этап 2.3: персональные профили сопоставления и
// подтверждённые номенклатурные aliases. ВСЕ запросы фильтруют user_id
// текущего пользователя (§15); financial-полей в таблицах нет (§16).
type ImportMemoryRepo struct {
	pool *pgxpool.Pool
}

// NewImportMemoryRepo creates an ImportMemoryRepo.
func NewImportMemoryRepo(pool *pgxpool.Pool) *ImportMemoryRepo {
	return &ImportMemoryRepo{pool: pool}
}

// ErrImportMemoryNotFound — запись не существует ЛИБО принадлежит другому
// пользователю (не раскрываем разницу, §10/§15).
var ErrImportMemoryNotFound = errors.New("import memory: not found")

// ─── Aliases: загрузка для analyze/execute ───────────────────────────────────

// ListActiveAliases — один батч-запрос активных aliases пользователя (§21).
func (r *ImportMemoryRepo) ListActiveAliases(ctx context.Context, userID string) ([]importmemory.Alias, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, catalog_kind,
		       COALESCE(material_name_id::text, ''), COALESCE(work_name_id::text, ''),
		       normalized_source_text, canonical_boq_item_type,
		       COALESCE(normalized_unit_code, ''), COALESCE(detail_cost_category_id::text, ''),
		       normalization_version, use_count, to_char(created_at, 'YYYY-MM-DD')
		FROM public.nomenclature_import_aliases
		WHERE user_id = $1::uuid AND is_active
		ORDER BY id`, userID)
	if err != nil {
		return nil, fmt.Errorf("importMemoryRepo: aliases: %w", err)
	}
	defer rows.Close()
	out := make([]importmemory.Alias, 0, 64)
	for rows.Next() {
		var al importmemory.Alias
		var matID, workID string
		if err := rows.Scan(&al.ID, &al.CatalogKind, &matID, &workID,
			&al.NormalizedSourceText, &al.CanonicalBoqType,
			&al.NormalizedUnitCode, &al.DetailCategoryID,
			&al.NormalizationVersion, &al.UseCount, &al.SavedAt); err != nil {
			return nil, err
		}
		if al.CatalogKind == importmemory.KindWork {
			al.CatalogID = workID
		} else {
			al.CatalogID = matID
		}
		out = append(out, al)
	}
	return out, rows.Err()
}

// ─── Profiles: analyze lookup + CRUD ─────────────────────────────────────────

func scanProfile(rows pgx.Rows) (importmemory.Profile, error) {
	var p importmemory.Profile
	var mapping, fixed []byte
	var sheetHint string
	var headerHint int
	err := rows.Scan(&p.ID, &p.Name, &p.HeaderSignature,
		&p.MappingSchemaVersion, &p.NormalizationVersion,
		&mapping, &fixed, &sheetHint, &headerHint,
		&p.IsActive, &p.UseCount, &p.LastUsedAt, &p.CreatedAt)
	if err != nil {
		return p, err
	}
	p.SheetNameHint, p.HeaderRowHint = sheetHint, headerHint
	p.Mapping = map[string]string{}
	_ = json.Unmarshal(mapping, &p.Mapping)
	_ = json.Unmarshal(fixed, &p.FixedOptions)
	return p, nil
}

const profileCols = `id::text, name, normalized_header_signature,
	mapping_schema_version, normalization_version, mapping, fixed_options,
	COALESCE(sheet_name_hint, ''), COALESCE(header_row_hint, 0),
	is_active, use_count,
	COALESCE(to_char(last_used_at, 'YYYY-MM-DD'), ''), to_char(created_at, 'YYYY-MM-DD')`

// ListProfilesBySignature — активные профили ТЕКУЩЕГО пользователя с точным
// совпадением сигнатуры (§5). Порядок стабильный: name → id.
func (r *ImportMemoryRepo) ListProfilesBySignature(ctx context.Context, userID, signature string) ([]importmemory.Profile, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+profileCols+`
		FROM public.boq_import_mapping_profiles
		WHERE user_id = $1::uuid AND is_active AND normalized_header_signature = $2
		ORDER BY name, id`, userID, signature)
	if err != nil {
		return nil, fmt.Errorf("importMemoryRepo: profiles by signature: %w", err)
	}
	defer rows.Close()
	var out []importmemory.Profile
	for rows.Next() {
		p, err := scanProfile(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetProfile — user-scoped (§15): чужой ID неотличим от несуществующего.
func (r *ImportMemoryRepo) GetProfile(ctx context.Context, userID, id string) (*importmemory.Profile, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+profileCols+`
		FROM public.boq_import_mapping_profiles
		WHERE user_id = $1::uuid AND id = $2::uuid`, userID, id)
	if err != nil {
		return nil, fmt.Errorf("importMemoryRepo: get profile: %w", err)
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, ErrImportMemoryNotFound
	}
	p, err := scanProfile(rows)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// ListProfiles — management-список (§10) с поиском и пагинацией.
func (r *ImportMemoryRepo) ListProfiles(
	ctx context.Context, userID, search string, activeOnly bool, page, pageSize int,
) ([]importmemory.Profile, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 25
	}
	where := "user_id = $1::uuid"
	args := []any{userID}
	if activeOnly {
		where += " AND is_active"
	}
	if s := strings.TrimSpace(search); s != "" {
		args = append(args, "%"+strings.ToLower(s)+"%")
		where += fmt.Sprintf(" AND lower(name) LIKE $%d", len(args))
	}
	var total int
	if err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM public.boq_import_mapping_profiles WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("importMemoryRepo: profiles count: %w", err)
	}
	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := r.pool.Query(ctx, `
		SELECT `+profileCols+`
		FROM public.boq_import_mapping_profiles
		WHERE `+where+`
		ORDER BY name, id
		LIMIT $`+fmt.Sprint(len(args)-1)+` OFFSET $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, 0, fmt.Errorf("importMemoryRepo: profiles list: %w", err)
	}
	defer rows.Close()
	var out []importmemory.Profile
	for rows.Next() {
		p, err := scanProfile(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, p)
	}
	return out, total, rows.Err()
}

// CreateProfile — сохранение ТОЛЬКО server-validated mapping (§9).
func (r *ImportMemoryRepo) CreateProfile(
	ctx context.Context, userID, name, signature string,
	mapping map[string]string, fixed importmemory.FixedOptions,
	sheetHint string, headerHint int,
) (string, error) {
	mj, _ := json.Marshal(mapping)
	fj, _ := json.Marshal(fixed)
	var id string
	err := r.pool.QueryRow(ctx, `
		INSERT INTO public.boq_import_mapping_profiles
			(user_id, name, normalized_header_signature, mapping_schema_version,
			 normalization_version, mapping, fixed_options, sheet_name_hint, header_row_hint)
		VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7::jsonb, NULLIF($8, ''), NULLIF($9, 0))
		RETURNING id::text`,
		userID, strings.TrimSpace(name), signature,
		importmemory.MappingSchemaVersion, importmemory.NormalizationVersion,
		mj, fj, sheetHint, headerHint).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("importMemoryRepo: create profile: %w", err)
	}
	return id, nil
}

// UpdateProfileContent — явное обновление mapping существующего профиля (§9.8):
// только после подтверждения пользователя и только server-validated данными.
func (r *ImportMemoryRepo) UpdateProfileContent(
	ctx context.Context, userID, id, signature string,
	mapping map[string]string, fixed importmemory.FixedOptions,
	sheetHint string, headerHint int,
) error {
	mj, _ := json.Marshal(mapping)
	fj, _ := json.Marshal(fixed)
	tag, err := r.pool.Exec(ctx, `
		UPDATE public.boq_import_mapping_profiles
		SET normalized_header_signature = $3, mapping = $4::jsonb, fixed_options = $5::jsonb,
		    sheet_name_hint = NULLIF($6, ''), header_row_hint = NULLIF($7, 0),
		    mapping_schema_version = $8, normalization_version = $9
		WHERE user_id = $1::uuid AND id = $2::uuid`,
		userID, id, signature, mj, fj, sheetHint, headerHint,
		importmemory.MappingSchemaVersion, importmemory.NormalizationVersion)
	if err != nil {
		return fmt.Errorf("importMemoryRepo: update profile content: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrImportMemoryNotFound
	}
	return nil
}

// PatchProfile — management PATCH (§10): ТОЛЬКО name/is_active; mapping через
// generic PATCH менять запрещено.
func (r *ImportMemoryRepo) PatchProfile(ctx context.Context, userID, id string, name *string, isActive *bool) error {
	sets := []string{}
	args := []any{userID, id}
	if name != nil {
		args = append(args, strings.TrimSpace(*name))
		sets = append(sets, fmt.Sprintf("name = $%d", len(args)))
	}
	if isActive != nil {
		args = append(args, *isActive)
		sets = append(sets, fmt.Sprintf("is_active = $%d", len(args)))
	}
	if len(sets) == 0 {
		return nil
	}
	tag, err := r.pool.Exec(ctx, `
		UPDATE public.boq_import_mapping_profiles
		SET `+strings.Join(sets, ", ")+`
		WHERE user_id = $1::uuid AND id = $2::uuid`, args...)
	if err != nil {
		return fmt.Errorf("importMemoryRepo: patch profile: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrImportMemoryNotFound
	}
	return nil
}

// BumpProfileUse — счётчик использований ТОЛЬКО после успешного импорта (§8).
func (r *ImportMemoryRepo) BumpProfileUse(ctx context.Context, userID, id string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.boq_import_mapping_profiles
		SET use_count = use_count + 1, last_used_at = now()
		WHERE user_id = $1::uuid AND id = $2::uuid`, userID, id)
	return err
}

// ─── Aliases: management + persistence ───────────────────────────────────────

// AliasListRow — management-проекция alias (§12): без цен/qty/tender-данных.
type AliasListRow struct {
	ID           string `json:"id"`
	CatalogKind  string `json:"catalog_kind"`
	CatalogID    string `json:"catalog_id"`
	CatalogLabel string `json:"catalog_label"`
	CatalogUnit  string `json:"catalog_unit"`
	SourceText   string `json:"normalized_source_text"`
	BoqType      string `json:"canonical_boq_item_type"`
	UnitCode     string `json:"normalized_unit_code,omitempty"`
	IsActive     bool   `json:"is_active"`
	UseCount     int    `json:"use_count"`
	LastUsedAt   string `json:"last_used_at,omitempty"`
	CreatedAt    string `json:"created_at"`
}

// ListAliases — management-список с целевой номенклатурой (§10/§12).
func (r *ImportMemoryRepo) ListAliases(
	ctx context.Context, userID, search string, activeOnly bool, page, pageSize int,
) ([]AliasListRow, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 25
	}
	where := "a.user_id = $1::uuid"
	args := []any{userID}
	if activeOnly {
		where += " AND a.is_active"
	}
	if s := strings.TrimSpace(search); s != "" {
		args = append(args, "%"+strings.ToLower(s)+"%")
		where += fmt.Sprintf(" AND (a.normalized_source_text LIKE $%d OR lower(COALESCE(mn.name, wn.name, '')) LIKE $%d)", len(args), len(args))
	}
	base := `
		FROM public.nomenclature_import_aliases a
		LEFT JOIN public.material_names mn ON mn.id = a.material_name_id
		LEFT JOIN public.work_names wn ON wn.id = a.work_name_id
		WHERE ` + where
	var total int
	if err := r.pool.QueryRow(ctx, `SELECT count(*) `+base, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("importMemoryRepo: aliases count: %w", err)
	}
	args = append(args, pageSize, (page-1)*pageSize)
	rows, err := r.pool.Query(ctx, `
		SELECT a.id::text, a.catalog_kind,
		       COALESCE(a.material_name_id::text, a.work_name_id::text, ''),
		       COALESCE(mn.name, wn.name, ''), COALESCE(mn.unit, wn.unit, ''),
		       a.normalized_source_text, a.canonical_boq_item_type,
		       COALESCE(a.normalized_unit_code, ''), a.is_active, a.use_count,
		       COALESCE(to_char(a.last_used_at, 'YYYY-MM-DD'), ''), to_char(a.created_at, 'YYYY-MM-DD')
		`+base+`
		ORDER BY a.normalized_source_text, a.id
		LIMIT $`+fmt.Sprint(len(args)-1)+` OFFSET $`+fmt.Sprint(len(args)), args...)
	if err != nil {
		return nil, 0, fmt.Errorf("importMemoryRepo: aliases list: %w", err)
	}
	defer rows.Close()
	var out []AliasListRow
	for rows.Next() {
		var a AliasListRow
		if err := rows.Scan(&a.ID, &a.CatalogKind, &a.CatalogID, &a.CatalogLabel, &a.CatalogUnit,
			&a.SourceText, &a.BoqType, &a.UnitCode, &a.IsActive, &a.UseCount,
			&a.LastUsedAt, &a.CreatedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, a)
	}
	return out, total, rows.Err()
}

// SetAliasActive — soft deactivate/restore (§10/§12).
func (r *ImportMemoryRepo) SetAliasActive(ctx context.Context, userID, id string, active bool) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE public.nomenclature_import_aliases
		SET is_active = $3
		WHERE user_id = $1::uuid AND id = $2::uuid`, userID, id, active)
	if err != nil {
		return fmt.Errorf("importMemoryRepo: alias active: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrImportMemoryNotFound
	}
	return nil
}

// BumpAliasUse — счётчики использованных aliases после успешного импорта (§8).
func (r *ImportMemoryRepo) BumpAliasUse(ctx context.Context, userID string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := r.pool.Exec(ctx, `
		UPDATE public.nomenclature_import_aliases
		SET use_count = use_count + 1, last_used_at = now()
		WHERE user_id = $1::uuid AND id = ANY($2::uuid[])`, userID, ids)
	return err
}

// AliasSaveEntry — новое подтверждённое соответствие (§7): только явный выбор.
type AliasSaveEntry struct {
	CatalogKind      string
	CatalogID        string
	SourceText       string // сырой текст строки; нормализуется здесь
	CanonicalBoqType string
	UnitCode         string
	DetailCategoryID string
}

// SaveAliases — persistence ПОСЛЕ успешного импорта (§8), отдельная
// транзакция: сбой здесь не откатывает BOQ. Прежний активный alias с тем же
// ключом и другой целью безопасно деактивируется (§17.43).
func (r *ImportMemoryRepo) SaveAliases(ctx context.Context, userID string, entries []AliasSaveEntry) (int, error) {
	if len(entries) == 0 {
		return 0, nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("importMemoryRepo: save aliases begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	saved := 0
	for _, e := range entries {
		norm := importmemory.NormalizeSourceText(e.SourceText)
		unit := importmemory.NormalizeSourceText(e.UnitCode)
		if norm == "" || e.CatalogID == "" || e.CanonicalBoqType == "" {
			continue
		}
		matID, workID := any(nil), any(nil)
		if e.CatalogKind == importmemory.KindWork {
			workID = e.CatalogID
		} else {
			matID = e.CatalogID
		}
		// Прежние активные с тем же ключом, но другой целью → деактивация.
		if _, err := tx.Exec(ctx, `
			UPDATE public.nomenclature_import_aliases
			SET is_active = false
			WHERE user_id = $1::uuid AND catalog_kind = $2
			  AND normalized_source_text = $3 AND canonical_boq_item_type = $4
			  AND COALESCE(normalized_unit_code, '') = $5
			  AND COALESCE(detail_cost_category_id::text, '') = $6
			  AND is_active
			  AND COALESCE(material_name_id::text, work_name_id::text, '') <> $7`,
			userID, e.CatalogKind, norm, e.CanonicalBoqType, unit, e.DetailCategoryID, e.CatalogID); err != nil {
			return saved, fmt.Errorf("importMemoryRepo: alias supersede: %w", err)
		}
		// Активный с той же целью уже есть → идемпотентно.
		var exists bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM public.nomenclature_import_aliases
				WHERE user_id = $1::uuid AND catalog_kind = $2
				  AND normalized_source_text = $3 AND canonical_boq_item_type = $4
				  AND COALESCE(normalized_unit_code, '') = $5
				  AND COALESCE(detail_cost_category_id::text, '') = $6
				  AND is_active)`,
			userID, e.CatalogKind, norm, e.CanonicalBoqType, unit, e.DetailCategoryID).Scan(&exists); err != nil {
			return saved, err
		}
		if exists {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO public.nomenclature_import_aliases
				(user_id, catalog_kind, material_name_id, work_name_id,
				 normalized_source_text, canonical_boq_item_type,
				 normalized_unit_code, detail_cost_category_id, normalization_version)
			VALUES ($1::uuid, $2, $3::uuid, $4::uuid, $5, $6, NULLIF($7, ''), NULLIF($8, '')::uuid, $9)`,
			userID, e.CatalogKind, matID, workID, norm, e.CanonicalBoqType,
			unit, e.DetailCategoryID, importmemory.NormalizationVersion); err != nil {
			return saved, fmt.Errorf("importMemoryRepo: alias insert: %w", err)
		}
		saved++
	}
	if err := tx.Commit(ctx); err != nil {
		return saved, fmt.Errorf("importMemoryRepo: save aliases commit: %w", err)
	}
	return saved, nil
}
