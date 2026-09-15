package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/su10/hubtender/backend/internal/analytics/costbenchmark"
)

var (
	// ErrRangeDuplicate — на эту цель, класс и объём строительства уже есть
	// действующий диапазон.
	ErrRangeDuplicate = errors.New("диапазон для этой цели уже заведён")
	// ErrRangeInvalid — диапазон нарушает ограничения (цель не согласована с
	// уровнем, границы, неизвестный класс или объём строительства).
	ErrRangeInvalid = errors.New("некорректный диапазон")
	// ErrRangeNotFound — действующего диапазона с таким id нет.
	ErrRangeNotFound = errors.New("диапазон не найден")
)

// BenchmarkRangeInput — поля диапазона при создании и правке.
type BenchmarkRangeInput struct {
	MetricKind           string   `json:"metric_kind"`
	Level                string   `json:"level"`
	CostCategoryID       *string  `json:"cost_category_id"`
	DetailCostCategoryID *string  `json:"detail_cost_category_id"`
	HousingClass         *string  `json:"housing_class"`
	ConstructionScope    *string  `json:"construction_scope"`
	Min                  *float64 `json:"min_value"`
	Max                  *float64 `json:"max_value"`
	Note                 *string  `json:"note"`
}

// BenchmarkRange — действующий диапазон с подписью цели.
type BenchmarkRange struct {
	ID string `json:"id"`
	BenchmarkRangeInput
	TargetName    string    `json:"target_name"`
	UpdatedAt     time.Time `json:"updated_at"`
	UpdatedByName *string   `json:"updated_by_name"`
}

// ListActiveRanges — действующие диапазоны.
func (r *CostBenchmarkRepo) ListActiveRanges(ctx context.Context) ([]BenchmarkRange, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT br.id::text, br.metric_kind, br.level,
		       br.cost_category_id::text, br.detail_cost_category_id::text,
		       br.housing_class::text, br.construction_scope::text,
		       br.min_value::float8, br.max_value::float8, br.note,
		       CASE br.level
		            WHEN 'total' THEN 'Итого по тендеру'
		            WHEN 'category' THEN cc.name
		            ELSE concat_ws(' · ', dc.name, NULLIF(dc.location, ''))
		       END,
		       br.updated_at, u.full_name
		FROM public.benchmark_ranges br
		LEFT JOIN public.cost_categories cc ON cc.id = br.cost_category_id
		LEFT JOIN public.detail_cost_categories dc ON dc.id = br.detail_cost_category_id
		LEFT JOIN public.users u ON u.id = COALESCE(br.updated_by, br.created_by)
		WHERE br.is_active
		ORDER BY br.level, 11, br.metric_kind, br.housing_class NULLS FIRST, br.construction_scope NULLS FIRST`)
	if err != nil {
		return nil, fmt.Errorf("costBenchmark.ListActiveRanges: %w", err)
	}
	defer rows.Close()
	out := make([]BenchmarkRange, 0, 32)
	for rows.Next() {
		var b BenchmarkRange
		if err := rows.Scan(&b.ID, &b.MetricKind, &b.Level, &b.CostCategoryID, &b.DetailCostCategoryID,
			&b.HousingClass, &b.ConstructionScope, &b.Min, &b.Max, &b.Note, &b.TargetName,
			&b.UpdatedAt, &b.UpdatedByName); err != nil {
			return nil, fmt.Errorf("costBenchmark.ListActiveRanges scan: %w", err)
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// EngineRanges — действующие диапазоны в виде входа движка.
func (r *CostBenchmarkRepo) EngineRanges(ctx context.Context) ([]costbenchmark.Range, error) {
	list, err := r.ListActiveRanges(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]costbenchmark.Range, len(list))
	for i, b := range list {
		t := costbenchmark.Target{Level: b.Level}
		if b.CostCategoryID != nil {
			t.CategoryID = *b.CostCategoryID
		}
		if b.DetailCostCategoryID != nil {
			t.DetailID = *b.DetailCostCategoryID
		}
		out[i] = costbenchmark.Range{
			ID: b.ID, MetricKind: b.MetricKind, Target: t,
			HousingClass: b.HousingClass, ConstructionScope: b.ConstructionScope,
			Min: b.Min, Max: b.Max, Note: b.Note,
		}
	}
	// У детализации в движке цель — пара (категория, детализация): категорию
	// берём из справочника, чтобы ключ совпал с показателем тендера.
	return fillDetailCategories(ctx, r, out)
}

func fillDetailCategories(ctx context.Context, r *CostBenchmarkRepo, ranges []costbenchmark.Range) ([]costbenchmark.Range, error) {
	need := false
	for _, rg := range ranges {
		if rg.Target.Level == costbenchmark.LevelDetail {
			need = true
			break
		}
	}
	if !need {
		return ranges, nil
	}
	_, dets, err := loadCostReferenceNames(ctx, r.pool)
	if err != nil {
		return nil, fmt.Errorf("costBenchmark.EngineRanges: %w", err)
	}
	for i := range ranges {
		if ranges[i].Target.Level == costbenchmark.LevelDetail {
			ranges[i].Target.CategoryID = dets[ranges[i].Target.DetailID].categoryID
		}
	}
	return ranges, nil
}

func mapRangeErr(op string, err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return ErrRangeDuplicate
		case "23514", "22P02", "23503":
			return ErrRangeInvalid
		}
	}
	return fmt.Errorf("costBenchmark.%s: %w", op, err)
}

// CreateRange заводит диапазон.
func (r *CostBenchmarkRepo) CreateRange(ctx context.Context, in BenchmarkRangeInput, actor *string) (string, error) {
	var id string
	err := r.pool.QueryRow(ctx, `
		INSERT INTO public.benchmark_ranges
			(metric_kind, level, cost_category_id, detail_cost_category_id, housing_class,
			 construction_scope, min_value, max_value, note, created_by, updated_by)
		VALUES ($1, $2, $3::uuid, $4::uuid, $5::public.housing_class_type,
		        $6::public.construction_scope_type, $7, $8, $9, $10::uuid, $10::uuid)
		RETURNING id::text`,
		in.MetricKind, in.Level, in.CostCategoryID, in.DetailCostCategoryID, in.HousingClass,
		in.ConstructionScope, in.Min, in.Max, in.Note, actor).Scan(&id)
	if err != nil {
		return "", mapRangeErr("CreateRange", err)
	}
	return id, nil
}

// UpdateRange меняет действующий диапазон.
func (r *CostBenchmarkRepo) UpdateRange(ctx context.Context, id string, in BenchmarkRangeInput, actor *string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE public.benchmark_ranges
		SET metric_kind = $2, level = $3, cost_category_id = $4::uuid,
		    detail_cost_category_id = $5::uuid, housing_class = $6::public.housing_class_type,
		    construction_scope = $7::public.construction_scope_type,
		    min_value = $8, max_value = $9, note = $10, updated_by = $11::uuid
		WHERE id = $1 AND is_active`,
		id, in.MetricKind, in.Level, in.CostCategoryID, in.DetailCostCategoryID, in.HousingClass,
		in.ConstructionScope, in.Min, in.Max, in.Note, actor)
	if err != nil {
		return mapRangeErr("UpdateRange", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrRangeNotFound
	}
	return nil
}

// DeactivateRange — мягкое удаление: запись остаётся, но в сравнении не участвует.
func (r *CostBenchmarkRepo) DeactivateRange(ctx context.Context, id string, actor *string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE public.benchmark_ranges SET is_active = false, updated_by = $2::uuid
		WHERE id = $1 AND is_active`, id, actor)
	if err != nil {
		return mapRangeErr("DeactivateRange", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrRangeNotFound
	}
	return nil
}
