package repository

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/analytics/costbenchmark"
)

// PostgreSQL integration tests: удельные показатели тендера, история согласованных
// тендеров и справочник эталонных диапазонов.
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run CostBenchmarkIntegration -v

type cbFixture struct {
	catID, detID string
	workID       string
	tenders      []string
}

func newCBFixture(t *testing.T, pool *pgxpool.Pool) *cbFixture {
	t.Helper()
	ctx := context.Background()
	f := &cbFixture{}
	f.workID, _ = ensureTestNames(t, pool)
	suffix := fmt.Sprint(len(t.Name())) + "-" + t.Name()
	if err := pool.QueryRow(ctx, `INSERT INTO public.cost_categories (name, unit)
		VALUES ($1, 'м3') RETURNING id::text`, "itest Монолит "+suffix).Scan(&f.catID); err != nil {
		t.Fatalf("категория: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO public.detail_cost_categories (cost_category_id, location, name, unit)
		VALUES ($1, 'Корпус', 'Стены', 'м3') RETURNING id::text`, f.catID).Scan(&f.detID); err != nil {
		t.Fatalf("детализация: %v", err)
	}
	t.Cleanup(func() {
		c := context.Background()
		for _, id := range f.tenders {
			_, _ = pool.Exec(c, `DELETE FROM public.tenders WHERE id = $1`, id)
		}
		_, _ = pool.Exec(c, `DELETE FROM public.benchmark_ranges WHERE cost_category_id = $1 OR detail_cost_category_id = $2`, f.catID, f.detID)
		_, _ = pool.Exec(c, `DELETE FROM public.detail_cost_categories WHERE id = $1`, f.detID)
		_, _ = pool.Exec(c, `DELETE FROM public.cost_categories WHERE id = $1`, f.catID)
	})
	return f
}

// tender создаёт тендер с одной расценённой строкой монолита: коммерческая сумма
// commercial, объём категории и детализации volume, площадь по СП area.
func (f *cbFixture) tender(t *testing.T, pool *pgxpool.Pool, number string, version int, class string,
	approved bool, commercial, volume, area float64) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.tenders (title, client_name, tender_number, version, housing_class, construction_scope,
		                            area_sp, financial_approved, financial_approved_at)
		VALUES ('itest cost benchmark', 'itest', $1, $2, $3::public.housing_class_type, 'генподряд',
		        $4, $5, CASE WHEN $5 THEN now() END)
		RETURNING id::text`, number, version, class, area, approved).Scan(&id); err != nil {
		t.Fatalf("тендер %s: %v", number, err)
	}
	f.tenders = append(f.tenders, id)
	var pos string
	if err := pool.QueryRow(ctx, `INSERT INTO public.client_positions (tender_id, position_number, work_name)
		VALUES ($1, 1, 'itest') RETURNING id::text`, id).Scan(&pos); err != nil {
		t.Fatalf("позиция: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.boq_items (tender_id, client_position_id, boq_item_type, work_name_id, unit_code,
		                              quantity, unit_rate, total_amount, detail_cost_category_id,
		                              total_commercial_material_cost, total_commercial_work_cost)
		VALUES ($1, $2, 'раб', $3, 'м2', 1, $4, $4, $5, 0, $4)`, id, pos, f.workID, commercial, f.detID); err != nil {
		t.Fatalf("строка: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.construction_cost_volumes (tender_id, detail_cost_category_id, volume)
		VALUES ($1, $2, $3)`, id, f.detID, volume); err != nil {
		t.Fatalf("объём детализации: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.construction_cost_volumes (tender_id, group_key, volume)
		SELECT $1, 'category-' || name, $3 FROM public.cost_categories WHERE id = $2`, id, f.catID, volume); err != nil {
		t.Fatalf("объём категории: %v", err)
	}
	return id
}

func metricByLevel(ms []costbenchmark.Metric, level string) *costbenchmark.Metric {
	for i := range ms {
		if ms[i].Level == level {
			return &ms[i]
		}
	}
	return nil
}

func TestCostBenchmarkIntegration_MetricsHistoryAndReport(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	repo := NewCostBenchmarkRepo(pool)
	f := newCBFixture(t, pool)
	prefix := "itest-cb-" + f.catID[:8] + "-"

	// История: 6 согласованных тендеров бизнес-класса по ~20 тыс. ₽/м³.
	for i := 0; i < 6; i++ {
		f.tender(t, pool, fmt.Sprintf("%sH%d", prefix, i), 1, "бизнес", true, 2_000_000+float64(i)*10_000, 100, 1000)
	}
	// Старая версия одного из них — не должна попасть в историю.
	f.tender(t, pool, prefix+"H0", 0, "бизнес", true, 99_000_000, 100, 1000)
	// Несогласованный тендер — тоже нет.
	f.tender(t, pool, prefix+"draft", 1, "бизнес", false, 1, 100, 1000)
	// Текущий: 30 тыс. ₽/м³, 3 000 ₽/м².
	cur := f.tender(t, pool, prefix+"CUR", 1, "бизнес", false, 3_000_000, 100, 1000)

	current, err := repo.LoadCurrent(ctx, cur)
	if err != nil {
		t.Fatal(err)
	}
	if !current.CalculationReady || current.HousingClass == nil || *current.HousingClass != "бизнес" {
		t.Fatalf("шапка текущего тендера: %+v", current)
	}
	cat := metricByLevel(current.Metrics, costbenchmark.LevelCategory)
	det := metricByLevel(current.Metrics, costbenchmark.LevelDetail)
	total := metricByLevel(current.Metrics, costbenchmark.LevelTotal)
	if cat == nil || det == nil || total == nil || current.Metrics[0].Level != costbenchmark.LevelTotal {
		t.Fatalf("ожидались итог, категория и детализация (итог первым): %+v", current.Metrics)
	}
	if cat.Volume == nil || *cat.Volume != 100 || cat.CommercialTotal != 3_000_000 || cat.Unit != "м3" {
		t.Fatalf("категория: %+v", cat)
	}
	if det.Volume == nil || *det.Volume != 100 || det.CategoryID != f.catID || det.Location != "Корпус" {
		t.Fatalf("детализация: %+v", det)
	}

	hist, err := repo.LoadHistory(ctx, 24)
	if err != nil {
		t.Fatal(err)
	}
	ours := 0
	for _, h := range hist {
		for _, o := range h.Observations {
			if o.Target.CategoryID == f.catID && o.Target.Level == costbenchmark.LevelCategory {
				ours++
				if o.CommercialTotal > 10_000_000 {
					t.Fatalf("в историю попала старая версия тендера: %+v", o)
				}
			}
		}
	}
	if ours != 6 {
		t.Fatalf("в истории %d тендеров с нашей категорией, ожидалось 6", ours)
	}

	var obs []costbenchmark.Observation
	for _, h := range hist {
		if h.TenderNumber != current.TenderNumber {
			obs = append(obs, h.Observations...)
		}
	}
	ranges, err := repo.EngineRanges(ctx)
	if err != nil {
		t.Fatal(err)
	}
	rep := costbenchmark.Evaluate(costbenchmark.Input{
		HousingClass: current.HousingClass, ConstructionScope: current.ConstructionScope,
		AreaSP: current.AreaSP, CalculationReady: current.CalculationReady,
		Metrics: current.Metrics, Ranges: ranges, History: obs,
	})
	for _, row := range rep.Rows {
		if row.Level != costbenchmark.LevelCategory || row.CategoryID != f.catID {
			continue
		}
		a := row.PerVolumeUnit
		if a.Status != costbenchmark.StatusAbove || a.Reference == nil ||
			a.Reference.Source != costbenchmark.SourceHistoryClass || *a.Value != 30000 {
			t.Fatalf("категория против истории: %+v %+v", a, a.Reference)
		}
		return
	}
	t.Fatal("строка категории не найдена в отчёте")
}

func TestCostBenchmarkIntegration_RangesCRUD(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	repo := NewCostBenchmarkRepo(pool)
	f := newCBFixture(t, pool)

	class := "бизнес"
	in := BenchmarkRangeInput{MetricKind: costbenchmark.MetricPerVolumeUnit, Level: costbenchmark.LevelCategory,
		CostCategoryID: &f.catID, HousingClass: &class, Min: fp64(18000), Max: fp64(25000)}
	id, err := repo.CreateRange(ctx, in, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CreateRange(ctx, in, nil); !errors.Is(err, ErrRangeDuplicate) {
		t.Fatalf("дубль: %v", err)
	}
	bad := BenchmarkRangeInput{MetricKind: costbenchmark.MetricPerVolumeUnit, Level: costbenchmark.LevelTotal, Max: fp64(1)}
	if _, err := repo.CreateRange(ctx, bad, nil); !errors.Is(err, ErrRangeInvalid) {
		t.Fatalf("₽/ед. для тендера целиком: %v", err)
	}
	wrongClass := "эконом"
	badEnum := in
	badEnum.HousingClass = &wrongClass
	if _, err := repo.CreateRange(ctx, badEnum, nil); !errors.Is(err, ErrRangeInvalid) {
		t.Fatalf("класса «эконом» в справочнике нет: %v", err)
	}

	det := BenchmarkRangeInput{MetricKind: costbenchmark.MetricPerAreaSP, Level: costbenchmark.LevelDetail,
		DetailCostCategoryID: &f.detID, Max: fp64(500)}
	if _, err := repo.CreateRange(ctx, det, nil); err != nil {
		t.Fatal(err)
	}

	ranges, err := repo.EngineRanges(ctx)
	if err != nil {
		t.Fatal(err)
	}
	foundDet := false
	for _, r := range ranges {
		if r.Target.DetailID == f.detID {
			foundDet = true
			if r.Target.CategoryID != f.catID {
				t.Fatalf("у диапазона детализации не проставлена категория: %+v", r.Target)
			}
		}
	}
	if !foundDet {
		t.Fatal("диапазон детализации не попал во вход движка")
	}

	in.Max = fp64(26000)
	if err := repo.UpdateRange(ctx, id, in, nil); err != nil {
		t.Fatal(err)
	}
	list, err := repo.ListActiveRanges(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range list {
		if r.ID == id && (r.Max == nil || *r.Max != 26000 || r.TargetName == "") {
			t.Fatalf("правка не сохранилась: %+v", r)
		}
	}

	if err := repo.DeactivateRange(ctx, id, nil); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeactivateRange(ctx, id, nil); !errors.Is(err, ErrRangeNotFound) {
		t.Fatalf("повторное удаление: %v", err)
	}
	// После мягкого удаления цель свободна — можно завести заново.
	if _, err := repo.CreateRange(ctx, in, nil); err != nil {
		t.Fatalf("новый диапазон после удаления: %v", err)
	}
}

func fp64(v float64) *float64 { return &v }

func TestCostBenchmarkIntegration_Brief(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	repo := NewCostBenchmarkRepo(pool)
	f := newCBFixture(t, pool)
	tid := f.tender(t, pool, "itest-brief-"+f.catID[:8], 1, "бизнес", false, 1000, 10, 100)

	b, err := repo.GetBrief(ctx, tid)
	if err != nil || b.SummaryText != "" || b.FactCategoryIDs != nil || b.UpdatedAt != nil {
		t.Fatalf("новая выжимка должна быть пустой: %+v %v", b, err)
	}

	if err := repo.SaveBrief(ctx, tid, "Монолит 30 тыс. ₽/м³, фасад НВФ", []string{f.catID}, nil); err != nil {
		t.Fatal(err)
	}
	b, err = repo.GetBrief(ctx, tid)
	if err != nil || b.SummaryText != "Монолит 30 тыс. ₽/м³, фасад НВФ" || len(b.FactCategoryIDs) != 1 ||
		b.FactCategoryIDs[0] != f.catID || b.UpdatedAt == nil {
		t.Fatalf("сохранённая выжимка: %+v %v", b, err)
	}

	// nil — снова автоматический выбор категорий.
	if err := repo.SaveBrief(ctx, tid, "только текст", nil, nil); err != nil {
		t.Fatal(err)
	}
	if b, err = repo.GetBrief(ctx, tid); err != nil || b.FactCategoryIDs != nil || b.SummaryText != "только текст" {
		t.Fatalf("сброс выбора категорий: %+v %v", b, err)
	}

	if err := repo.SaveBrief(ctx, "00000000-0000-0000-0000-000000000000", "x", nil, nil); !errors.Is(err, ErrRangeInvalid) {
		t.Fatalf("выжимка несуществующего тендера: %v", err)
	}
}
