package repository

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	ps "github.com/su10/hubtender/backend/internal/analytics/pricesource"
)

// PostgreSQL integration tests for stage 1.3: price source coverage &
// freshness on a real database. Reuses newTestPool /
// HUBTENDER_TEST_DATABASE_URL (COMPILED + SKIPPED without a test DB).
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run PriceSourceIntegration -v

// seedSourceTender — calculated/current тендер с одной позицией.
func seedSourceTender(t *testing.T, pool *pgxpool.Pool, tag string) (tenderID, posID string) {
	t.Helper()
	ctx := context.Background()
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.tenders
		  (title, client_name, tender_number,
		   financial_calculation_status, financial_input_revision, financial_calculation_revision)
		VALUES ($1,'itest-client',$2,'calculated', 2, 2)
		RETURNING id::text`, "itest-src-"+tag, "ITEST-SRC-"+tag).Scan(&tenderID); err != nil {
		t.Fatalf("seed tender: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM public.boq_items WHERE tender_id=$1::uuid`, tenderID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.client_positions WHERE tender_id=$1::uuid`, tenderID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.tenders WHERE id=$1::uuid`, tenderID)
	})
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.client_positions (tender_id, position_number, work_name)
		VALUES ($1::uuid, 1, 'p') RETURNING id::text`, tenderID).Scan(&posID); err != nil {
		t.Fatalf("seed pos: %v", err)
	}
	return tenderID, posID
}

// addSourceItem — price-bearing строка (qty=1, rate=amount) с source-метаданными.
// Даты задаются в днях относительно server CURRENT_DATE (nil → NULL).
func addSourceItem(
	t *testing.T, pool *pgxpool.Pool, tenderID, posID, workNameID string,
	amount float64, link *string, priceOffsetDays, validOffsetDays *int,
) string {
	t.Helper()
	var itemID string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO public.boq_items
		  (client_position_id, tender_id, boq_item_type, work_name_id, unit_code,
		   quantity, unit_rate, currency_type, total_amount, quote_link,
		   quote_price_date, quote_valid_until)
		VALUES ($1::uuid,$2::uuid,'раб',$3::uuid,'м2',1,$4,'RUB',$4,$5,
		        CASE WHEN $6::int IS NULL THEN NULL ELSE CURRENT_DATE + $6::int END,
		        CASE WHEN $7::int IS NULL THEN NULL ELSE CURRENT_DATE + $7::int END)
		RETURNING id::text`,
		posID, tenderID, workNameID, amount, link, priceOffsetDays, validOffsetDays,
	).Scan(&itemID); err != nil {
		t.Fatalf("seed source item: %v", err)
	}
	return itemID
}

func iptr(v int) *int { return &v }

func sourceReport(t *testing.T, pool *pgxpool.Pool, tenderID string) *ps.Report {
	t.Helper()
	repo := NewPriceSourceRepo(pool)
	snap, err := repo.LoadSnapshot(context.Background(), tenderID)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	return ps.Evaluate(tenderID, snap.InputRev, snap.CalcRev, snap.CalcStatus,
		snap.GeneratedAt, snap.AsOfDate, ps.DefaultMaxAgeDays, ps.DefaultExpiringSoonDays, snap.Items)
}

func rowByID(t *testing.T, r *ps.Report, itemID string) *ps.Row {
	t.Helper()
	for i := range r.Items {
		if r.Items[i].BoqItemID == itemID {
			return &r.Items[i]
		}
	}
	t.Fatalf("item %s not in report", itemID)
	return nil
}

// A-F/H/I/J/M/N — все статусы, shared source, покрытие, amount-метрики,
// детерминированный порядок и реальные deep-link IDs на одном тендере.
func TestPriceSourceIntegration_StatusesCoverageAndOrder(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	tenderID, posID := seedSourceTender(t, pool, "ALL")

	link := sptr("https://supplier.kz/quote-1.pdf")
	fresh := addSourceItem(t, pool, tenderID, posID, workNameID, 100, link, iptr(-10), nil)                           // A: FRESH
	missingSrc := addSourceItem(t, pool, tenderID, posID, workNameID, 200, nil, nil, nil)                             // B: SOURCE_MISSING
	missingDate := addSourceItem(t, pool, tenderID, posID, workNameID, 300, link, nil, nil)                           // C: PRICE_DATE_MISSING (H: shared link)
	stale := addSourceItem(t, pool, tenderID, posID, workNameID, 400, sptr("https://s2.kz/q"), iptr(-120), nil)       // D: STALE (120 > 90)
	expired := addSourceItem(t, pool, tenderID, posID, workNameID, 500, sptr("https://s3.kz/q"), iptr(-30), iptr(-1)) // E: EXPIRED
	expiring := addSourceItem(t, pool, tenderID, posID, workNameID, 600, sptr("https://s4.kz/q"), iptr(-5), iptr(7))  // F: EXPIRING_SOON

	r := sourceReport(t, pool, tenderID)

	for id, want := range map[string]string{
		fresh: ps.StatusFresh, missingSrc: ps.StatusSourceMissing,
		missingDate: ps.StatusPriceDateMissing, stale: ps.StatusStale,
		expired: ps.StatusExpired, expiring: ps.StatusExpiringSoon,
	} {
		if got := rowByID(t, r, id).Status; got != want {
			t.Fatalf("item %s: status=%s, want %s", id, got, want)
		}
	}

	// I — row-покрытие: 5 из 6 со источником; актуальное = FRESH+EXPIRING = 2/6.
	sm := r.Summary
	if sm.PriceBearingItemsTotal != 6 || sm.ItemsWithSource != 5 {
		t.Fatalf("coverage base: total=%d withSource=%d, want 6/5", sm.PriceBearingItemsTotal, sm.ItemsWithSource)
	}
	if sm.SourceCoveragePercent < 83.2 || sm.SourceCoveragePercent > 83.4 {
		t.Fatalf("source coverage=%v, want ≈83.3", sm.SourceCoveragePercent)
	}
	// H — общий link у двух строк → 4 различных источника.
	if sm.DistinctSourcesCount != 4 {
		t.Fatalf("distinct sources=%d, want 4", sm.DistinctSourcesCount)
	}

	// J — calculated + revisions match → amount-метрики доступны.
	if r.AmountMetricsStatus != "available" || sm.PriceBearingDirectAmount == nil {
		t.Fatalf("amount metrics: status=%s amount=%v, want available", r.AmountMetricsStatus, sm.PriceBearingDirectAmount)
	}
	if *sm.PriceBearingDirectAmount != 2100 {
		t.Fatalf("price-bearing amount=%v, want 2100", *sm.PriceBearingDirectAmount)
	}
	// review = missing source + missing date + stale + expired = 200+300+400+500.
	if sm.AmountRequiringReview == nil || *sm.AmountRequiringReview != 1400 {
		t.Fatalf("amount requiring review=%v, want 1400", sm.AmountRequiringReview)
	}

	// M — детерминированный порядок статусов (§13).
	prio := map[string]int{
		ps.StatusInvalidSourceDates: 0, ps.StatusExpired: 1, ps.StatusStale: 2,
		ps.StatusSourceMissing: 3, ps.StatusPriceDateMissing: 4,
		ps.StatusExpiringSoon: 5, ps.StatusFresh: 6, ps.StatusNotApplicable: 7,
	}
	for i := 1; i < len(r.Items); i++ {
		if prio[r.Items[i-1].Status] > prio[r.Items[i].Status] {
			t.Fatalf("sort violated at %d: %s after %s", i, r.Items[i].Status, r.Items[i-1].Status)
		}
	}

	// N — deep-link IDs реальные.
	row := rowByID(t, r, fresh)
	if row.ClientPositionID != posID {
		t.Fatalf("deep-link position=%s, want %s", row.ClientPositionID, posID)
	}
	// severity: никогда не blocker.
	for _, it := range r.Items {
		if it.Severity != ps.SeverityWarning && it.Severity != ps.SeverityInformation && it.Severity != ps.SeverityNone {
			t.Fatalf("unexpected severity %q", it.Severity)
		}
	}
}

// G — некорректные даты отклоняются write-path'ом и DB CHECK'ом.
func TestPriceSourceIntegration_InvalidDatesRejected(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	f := seedRollbackFixture(t, pool, "SRCG", fptr(90))
	itemID := f.addItem(t, pool, "раб", "RUB", 1, 100, nil)
	boqRepo := NewBoqRepo(pool)

	// price_date в будущем.
	future := time.Now().UTC().AddDate(0, 0, 10).Format("2006-01-02")
	var qd *InvalidQuoteDatesError
	if _, err := boqRepo.UpdateBoqItem(ctx, itemID, UpdateBoqItemInput{QuotePriceDate: sptr(future)}); !errors.As(err, &qd) {
		t.Fatalf("future price_date: want InvalidQuoteDatesError, got %v", err)
	}
	// valid_until < price_date.
	if _, err := boqRepo.UpdateBoqItem(ctx, itemID, UpdateBoqItemInput{
		QuotePriceDate: sptr("2026-07-01"), QuoteValidUntil: sptr("2026-06-01"),
	}); !errors.As(err, &qd) {
		t.Fatalf("reversed range: want InvalidQuoteDatesError, got %v", err)
	}
	// Мусорный формат.
	if _, err := boqRepo.UpdateBoqItem(ctx, itemID, UpdateBoqItemInput{QuotePriceDate: sptr("мусор")}); !errors.As(err, &qd) {
		t.Fatalf("malformed date: want InvalidQuoteDatesError, got %v", err)
	}
	// DB CHECK — защита в обход приложения.
	_, err := pool.Exec(ctx, `
		UPDATE public.boq_items
		SET quote_price_date = '2026-07-01', quote_valid_until = '2026-06-01'
		WHERE id = $1::uuid`, itemID)
	if err == nil || !strings.Contains(err.Error(), "boq_items_quote_dates_check") {
		t.Fatalf("DB CHECK must reject reversed range, got %v", err)
	}
}

// K — stale расчёт: строки и статусы возвращаются, amount-метрики unavailable.
func TestPriceSourceIntegration_StaleAmountUnavailableRowsReturned(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	tenderID, posID := seedSourceTender(t, pool, "STALE")
	itemID := addSourceItem(t, pool, tenderID, posID, workNameID, 100, nil, nil, nil)
	if _, err := pool.Exec(context.Background(), `
		UPDATE public.tenders SET financial_calculation_status='stale',
		  financial_input_revision = financial_input_revision + 1
		WHERE id=$1::uuid`, tenderID); err != nil {
		t.Fatal(err)
	}

	r := sourceReport(t, pool, tenderID)
	if r.AmountMetricsStatus != "unavailable" || r.AmountMetricsNote == "" {
		t.Fatalf("amount metrics: %s/%q, want unavailable+note", r.AmountMetricsStatus, r.AmountMetricsNote)
	}
	if r.Summary.PriceBearingDirectAmount != nil || r.Summary.AmountRequiringReview != nil {
		t.Fatal("stale: amount metrics must be nil")
	}
	row := rowByID(t, r, itemID) // строка и статус НЕ скрываются
	if row.Status != ps.StatusSourceMissing || row.TotalAmount != nil {
		t.Fatalf("stale row: status=%s amount=%v, want SOURCE_MISSING + hidden amount", row.Status, row.TotalAmount)
	}
	if r.Summary.SourceCoveragePercent != 0 {
		t.Fatalf("row coverage must stay available: %v", r.Summary.SourceCoveragePercent)
	}
}

// L — тендер не найден.
func TestPriceSourceIntegration_TenderNotFound(t *testing.T) {
	pool := newTestPool(t)
	repo := NewPriceSourceRepo(pool)
	_, err := repo.LoadSnapshot(context.Background(), "ffffffff-ffff-ffff-ffff-ffffffffffff")
	if !errors.Is(err, ErrQualityTenderNotFound) {
		t.Fatalf("want not-found, got %v", err)
	}
}

// O (КЛЮЧЕВОЙ) — metadata-only правка источника НЕ двигает ревизию, НЕ снимает
// согласование и НЕ переводит расчёт в stale; ETag (updated_at) двигается.
// Финансовая правка тем же методом — двигает ревизию и снимает согласование.
func TestPriceSourceIntegration_MetadataEditKeepsRevisionAndApproval(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	f := seedRollbackFixture(t, pool, "SRCO", fptr(90))
	itemID := f.addItem(t, pool, "раб", "RUB", 5, 10, nil)

	if _, err := RecalcTenderCommercialAuthoritative(ctx, pool, f.tenderID); err != nil {
		t.Fatalf("recalc: %v", err)
	}
	approveDirect(t, pool, f.tenderID)
	before := readFinState(t, pool, f.tenderID)
	if !before.approved || before.status != "calculated" {
		t.Fatalf("fixture not ready: %+v", before)
	}
	var updBefore time.Time
	if err := pool.QueryRow(ctx, `SELECT updated_at FROM public.boq_items WHERE id=$1::uuid`, itemID).Scan(&updBefore); err != nil {
		t.Fatal(err)
	}

	// Metadata-only patch: link + обе даты.
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	if _, err := NewBoqRepo(pool).UpdateBoqItem(ctx, itemID, UpdateBoqItemInput{
		QuoteLink:       sptr("https://supplier.kz/quote-O.pdf"),
		QuotePriceDate:  sptr(yesterday),
		QuoteValidUntil: sptr(""), // явная очистка тоже metadata-only
	}); err != nil {
		t.Fatalf("metadata edit: %v", err)
	}

	after := readFinState(t, pool, f.tenderID)
	if after.inputRev != before.inputRev {
		t.Fatalf("metadata edit bumped financial_input_revision %d → %d", before.inputRev, after.inputRev)
	}
	if !after.approved {
		t.Fatal("metadata edit cleared financial approval")
	}
	if after.status != "calculated" {
		t.Fatalf("metadata edit flipped status to %q", after.status)
	}
	var updAfter time.Time
	if err := pool.QueryRow(ctx, `SELECT updated_at FROM public.boq_items WHERE id=$1::uuid`, itemID).Scan(&updAfter); err != nil {
		t.Fatal(err)
	}
	if !updAfter.After(updBefore) {
		t.Fatal("metadata edit must still move boq_items.updated_at (user ETag)")
	}

	// Контроль: смешанный patch (дата + количество) — финансовый.
	if _, err := NewBoqRepo(pool).UpdateBoqItem(ctx, itemID, UpdateBoqItemInput{
		QuotePriceDate: sptr(yesterday), Quantity: fptr(6),
	}); err != nil {
		t.Fatalf("financial edit: %v", err)
	}
	fin := readFinState(t, pool, f.tenderID)
	if fin.inputRev != before.inputRev+1 || fin.approved || fin.status != "stale" {
		t.Fatalf("financial edit must bump+unapprove+stale, got %+v", fin)
	}
}

// P — копирование позиции переносит source-метаданные.
func TestPriceSourceIntegration_CopyPreservesQuoteDates(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	workNameID, _ := ensureTestNames(t, pool)
	tenderID, posID := seedSourceTender(t, pool, "COPY")
	addSourceItem(t, pool, tenderID, posID, workNameID, 100, sptr("https://s.kz/copy.pdf"), iptr(-10), iptr(20))

	var pos2 string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.client_positions (tender_id, position_number, work_name)
		VALUES ($1::uuid, 2, 'p2') RETURNING id::text`, tenderID).Scan(&pos2); err != nil {
		t.Fatal(err)
	}
	if _, err := NewBoqRepo(pool).CopyPositionItems(ctx, posID, pos2, rbActor); err != nil {
		t.Fatalf("copy: %v", err)
	}
	var link, pd, vu *string
	if err := pool.QueryRow(ctx, `
		SELECT quote_link, to_char(quote_price_date,'YYYY-MM-DD'), to_char(quote_valid_until,'YYYY-MM-DD')
		FROM public.boq_items WHERE client_position_id=$1::uuid`, pos2).Scan(&link, &pd, &vu); err != nil {
		t.Fatalf("copied row: %v", err)
	}
	if link == nil || *link != "https://s.kz/copy.pdf" || pd == nil || vu == nil {
		t.Fatalf("copy lost source metadata: link=%v pd=%v vu=%v", link, pd, vu)
	}
}

// Q — даты в импорте BOQ: осознанно отложено (backlog этапа 1.3, §9).
func TestPriceSourceIntegration_ImportDatesBacklog(t *testing.T) {
	t.Skip("даты источника в импорте отложены в backlog (этап 1.3 §9: optional-or-backlog)")
}

// R — консистентный снапшот: as-of и generated_at приходят от сервера.
func TestPriceSourceIntegration_SnapshotConsistency(t *testing.T) {
	pool := newTestPool(t)
	tenderID, _ := seedSourceTender(t, pool, "SNAP")
	repo := NewPriceSourceRepo(pool)
	snap, err := repo.LoadSnapshot(context.Background(), tenderID)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if _, err := time.Parse("2006-01-02", snap.AsOfDate); err != nil {
		t.Fatalf("as_of_date %q not a server date: %v", snap.AsOfDate, err)
	}
	if snap.GeneratedAt == "" || snap.CalcStatus == "" {
		t.Fatalf("snapshot incomplete: %+v", snap)
	}
	// Пустой тендер: политика 100% покрытия и никакого NaN.
	r := ps.Evaluate(tenderID, snap.InputRev, snap.CalcRev, snap.CalcStatus,
		snap.GeneratedAt, snap.AsOfDate, ps.DefaultMaxAgeDays, ps.DefaultExpiringSoonDays, snap.Items)
	if r.Summary.SourceCoveragePercent != 100 || r.Summary.CurrentSourceCoveragePercent != 100 {
		t.Fatalf("empty tender coverage policy: %+v", r.Summary)
	}
}
