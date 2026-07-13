package repository

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/calc"
)

// PostgreSQL integration tests for the FULL production Version Transfer path
// (TransferRepo.ExecuteVersionTransfer). Reuses the existing convention and the
// production-DSN guard (newTestPool / HUBTENDER_TEST_DATABASE_URL); SKIPs when no
// test DB is configured.
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run ExecuteVersionTransfer -v
//
// ─── Fixture arithmetic (deterministic, non-default configuration) ───────────
//
// markup percentages (COPIED to the target, deliberately != the hardcoded fallback):
//
//	works_16_markup      = 50   (fallback would be 60)
//	material_cost_growth = 20   (fallback would be 10)
//
// tactic sequences (base × (1 + pct/100)):
//
//	раб → ×1.50   (fallback would give ×1.60)
//	мат → ×1.20   (fallback would give ×1.10)
//
// pricing distribution (COPIED; work markup deliberately routed to the MATERIAL
// column, which a nil/default distribution would NOT do):
//
//	work:           base → work,     markup → material
//	basic material: base → material, markup → work
//
// BOQ of the matched position (RUB, all with CORRUPTED source derived values):
//
//	work        qty10 × 100                      → total 1000 ; ×1.5 = 1500 → work 1000 , mat  500
//	child mat   qty10 × 100, cons 1.2, parent=work → total 1000 (cons forced to 1)
//	                                                ; ×1.2 = 1200 → mat 1000 , work  200
//	standalone  qty10 × 100, cons 1.2            → total 1200 ; ×1.2 = 1440 → mat 1200 , work  240
//
// BOQ of the additional position:
//
//	work        qty5  × 100                      → total  500 ; ×1.5 =  750 → work  500 , mat  250
//
// Σ commercial = 1500 + 1200 + 1440 + 750 = 4890
// insurance    = (apt_price 10 × apt_area 10) × 50% × 100% = 50
// grand total  = 4890 + 50 = 4940
const (
	tWorkTotal       = 1000.0
	tChildMatTotal   = 1000.0
	tStandaloneTotal = 1200.0
	tAddWorkTotal    = 500.0

	tInsurance  = 50.0
	tGrandTotal = 4940.0
)

type transferFixture struct {
	tenderNumber string
	srcTenderID  string
	// source positions
	normalPosID string
	addPosID    string
	// source BOQ ids
	workID       string
	childMatID   string
	standaloneID string
	addWorkID    string

	tacticID    string
	detailCatID string
}

// seedTransferSource builds a full, realistic source tender.
// usdRate == nil ⇒ tender has no USD rate (used by the missing-FX scenario).
func seedTransferSource(t *testing.T, pool *pgxpool.Pool, tag string, usdRate *float64) *transferFixture {
	t.Helper()
	ctx := context.Background()
	f := &transferFixture{tenderNumber: "ITEST-VT-" + tag}

	must := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("fixture exec: %v\nSQL: %s", err, q)
		}
	}
	scan := func(dst *string, q string, args ...any) {
		t.Helper()
		if err := pool.QueryRow(ctx, q, args...).Scan(dst); err != nil {
			t.Fatalf("fixture query: %v\nSQL: %s", err, q)
		}
	}

	// Reference data.
	var costCatID string
	scan(&costCatID, `INSERT INTO public.cost_categories (name, unit) VALUES ($1,'м2') RETURNING id::text`,
		"itest-vt-cat-"+tag)
	scan(&f.detailCatID, `INSERT INTO public.detail_cost_categories (cost_category_id, location, name, unit)
	                      VALUES ($1::uuid,'loc',$2,'м2') RETURNING id::text`, costCatID, "itest-vt-detail-"+tag)

	// Markup parameters (global) + a tactic whose sequences reference them.
	var pWorks, pMat string
	scan(&pWorks, `INSERT INTO public.markup_parameters (key,label,default_value)
	               VALUES ('works_16_markup','itest works',60) RETURNING id::text`)
	scan(&pMat, `INSERT INTO public.markup_parameters (key,label,default_value)
	             VALUES ('material_cost_growth','itest mat',10) RETURNING id::text`)

	const sequences = `{
	  "раб":[{"baseIndex":-1,"action1":"multiply","operand1Type":"markup",
	          "operand1Key":"works_16_markup","operand1MultiplyFormat":"addOne"}],
	  "мат":[{"baseIndex":-1,"action1":"multiply","operand1Type":"markup",
	          "operand1Key":"material_cost_growth","operand1MultiplyFormat":"addOne"}]
	}`
	scan(&f.tacticID, `INSERT INTO public.markup_tactics (name, sequences)
	                   VALUES ($1, $2::jsonb) RETURNING id::text`, "itest-vt-tactic-"+tag, sequences)

	// Source tender: FX + markup tactic.
	scan(&f.srcTenderID, `INSERT INTO public.tenders
	        (title, client_name, tender_number, version, usd_rate, markup_tactic_id)
	      VALUES ($1,'itest-client',$2,1,$3,$4::uuid) RETURNING id::text`,
		"itest-vt-"+tag, f.tenderNumber, usdRate, f.tacticID)

	// NON-DEFAULT markup percentages (≠ the hardcoded fallback values).
	must(`INSERT INTO public.tender_markup_percentage (tender_id, markup_parameter_id, value)
	      VALUES ($1::uuid,$2::uuid,50)`, f.srcTenderID, pWorks)
	must(`INSERT INTO public.tender_markup_percentage (tender_id, markup_parameter_id, value)
	      VALUES ($1::uuid,$2::uuid,20)`, f.srcTenderID, pMat)

	// EXPLICIT pricing distribution: work markup → MATERIAL column (a nil/default
	// distribution would never do this).
	must(`INSERT INTO public.tender_pricing_distribution
	        (tender_id, markup_tactic_id,
	         basic_material_base_target, basic_material_markup_target,
	         work_base_target, work_markup_target)
	      VALUES ($1::uuid,$2::uuid,'material','work','work','material')`, f.srcTenderID, f.tacticID)

	// Insurance (feeds cached_grand_total): (10 × 10) × 50% × 100% = 50.
	must(`INSERT INTO public.tender_insurance
	        (tender_id, judicial_pct, total_pct, apt_price_m2, apt_area)
	      VALUES ($1::uuid, 50, 100, 10, 10)`, f.srcTenderID)

	// Positions: one normal (will be matched) + one additional child of it.
	scan(&f.normalPosID, `INSERT INTO public.client_positions
	        (tender_id, position_number, work_name, is_additional)
	      VALUES ($1::uuid, 1, 'itest-normal', false) RETURNING id::text`, f.srcTenderID)
	scan(&f.addPosID, `INSERT INTO public.client_positions
	        (tender_id, position_number, work_name, is_additional, parent_position_id)
	      VALUES ($1::uuid, 2, 'itest-additional', true, $2::uuid) RETURNING id::text`,
		f.srcTenderID, f.normalPosID)

	t.Cleanup(func() {
		// Delete every tender that shares this tender_number (source + any created
		// version), children first.
		must(`DELETE FROM public.boq_items WHERE tender_id IN
		        (SELECT id FROM public.tenders WHERE tender_number = $1)`, f.tenderNumber)
		must(`DELETE FROM public.client_positions WHERE tender_id IN
		        (SELECT id FROM public.tenders WHERE tender_number = $1)`, f.tenderNumber)
		for _, tbl := range []string{
			"tender_insurance", "tender_pricing_distribution", "tender_markup_percentage",
			"subcontract_growth_exclusions", "construction_cost_volumes", "user_position_filters",
		} {
			must(`DELETE FROM public.`+tbl+` WHERE tender_id IN
			        (SELECT id FROM public.tenders WHERE tender_number = $1)`, f.tenderNumber)
		}
		must(`DELETE FROM public.tenders WHERE tender_number = $1`, f.tenderNumber)
		must(`DELETE FROM public.markup_tactics WHERE id = $1::uuid`, f.tacticID)
		must(`DELETE FROM public.markup_parameters WHERE id = ANY($1::uuid[])`, []string{pWorks, pMat})
		must(`DELETE FROM public.detail_cost_categories WHERE id = $1::uuid`, f.detailCatID)
		must(`DELETE FROM public.cost_categories WHERE id = $1::uuid`, costCatID)
	})

	return f
}

// addBoq inserts a source BOQ row with DELIBERATELY CORRUPTED derived values.
func addBoq(
	t *testing.T, pool *pgxpool.Pool, tenderID, posID, detailCatID,
	itemType, currency string, qty, rate float64, consumption *float64, parentID *string,
) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO public.boq_items
		  (client_position_id, tender_id, boq_item_type, material_type, quantity, unit_rate,
		   currency_type, delivery_price_type, consumption_coefficient, parent_work_item_id,
		   detail_cost_category_id,
		   total_amount, commercial_markup,
		   total_commercial_material_cost, total_commercial_work_cost)
		VALUES ($1::uuid,$2::uuid,$3::boq_item_type,
		        CASE WHEN $3 = 'мат' THEN 'основн.'::material_type ELSE NULL END,
		        $4,$5,$6::currency_type,'в цене',$7,$8::uuid,$9::uuid,
		        999999, 777, 888888, 999999)
		RETURNING id::text`,
		posID, tenderID, itemType, qty, rate, currency, consumption, parentID, detailCatID,
	).Scan(&id); err != nil {
		t.Fatalf("add source boq (%s): %v", itemType, err)
	}
	return id
}

// seedFullBoq adds the standard BOQ graph (work + child material + standalone +
// an additional-position work).
func (f *transferFixture) seedFullBoq(t *testing.T, pool *pgxpool.Pool, currency string) {
	t.Helper()
	cons := 1.2
	f.workID = addBoq(t, pool, f.srcTenderID, f.normalPosID, f.detailCatID, calc.BoqRab, currency, 10, 100, nil, nil)
	f.childMatID = addBoq(t, pool, f.srcTenderID, f.normalPosID, f.detailCatID, calc.BoqMat, currency, 10, 100, &cons, &f.workID)
	f.standaloneID = addBoq(t, pool, f.srcTenderID, f.normalPosID, f.detailCatID, calc.BoqMat, currency, 10, 100, &cons, nil)
	f.addWorkID = addBoq(t, pool, f.srcTenderID, f.addPosID, f.detailCatID, calc.BoqRab, currency, 5, 100, nil, nil)
}

// transferInput builds the payload that matches the single normal position.
func (f *transferFixture) transferInput() TransferInput {
	lvl := 0
	return TransferInput{
		SourceTenderID: f.srcTenderID,
		NewPositions: []NewPositionInput{
			{RowIndex: 0, WorkName: "itest-normal", HierarchyLevel: &lvl},
		},
		Matches: []MatchInput{
			{OldPositionID: f.normalPosID, NewRowIndex: 0},
		},
		ChangedBy: "00000000-0000-0000-0000-000000000000",
	}
}

// ─── observation helpers ────────────────────────────────────────────────────

type vtRow struct {
	id       string
	itemType string
	total    *float64
	markup   *float64
	mat      *float64
	work     *float64
	parent   *string
	posID    string
	isAdd    bool
}

func readTenderBoq(t *testing.T, pool *pgxpool.Pool, tenderID string) []vtRow {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT b.id::text, b.boq_item_type::text, b.total_amount, b.commercial_markup,
		       b.total_commercial_material_cost, b.total_commercial_work_cost,
		       b.parent_work_item_id::text, b.client_position_id::text,
		       COALESCE(cp.is_additional,false)
		FROM public.boq_items b
		JOIN public.client_positions cp ON cp.id = b.client_position_id
		WHERE b.tender_id = $1::uuid
		ORDER BY cp.is_additional, b.sort_number, b.id`, tenderID)
	if err != nil {
		t.Fatalf("read tender boq: %v", err)
	}
	defer rows.Close()
	var out []vtRow
	for rows.Next() {
		var r vtRow
		if err := rows.Scan(&r.id, &r.itemType, &r.total, &r.markup, &r.mat, &r.work,
			&r.parent, &r.posID, &r.isAdd); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out = append(out, r)
	}
	return out
}

// newVersionID returns the id of the tender version created by the transfer
// (the row with the same tender_number that is NOT the source), or "".
func newVersionID(t *testing.T, pool *pgxpool.Pool, f *transferFixture) string {
	t.Helper()
	var id *string
	if err := pool.QueryRow(context.Background(),
		`SELECT id::text FROM public.tenders
		 WHERE tender_number = $1 AND id <> $2::uuid`,
		f.tenderNumber, f.srcTenderID).Scan(&id); err != nil {
		return "" // no rows → no new version
	}
	if id == nil {
		return ""
	}
	return *id
}

func fval(t *testing.T, p *float64, what string) float64 {
	t.Helper()
	if p == nil {
		t.Fatalf("%s is NULL, expected a value", what)
	}
	return *p
}

func grandTotal(t *testing.T, pool *pgxpool.Pool, tenderID string) float64 {
	t.Helper()
	var v *float64
	if err := pool.QueryRow(context.Background(),
		`SELECT cached_grand_total FROM public.tenders WHERE id = $1::uuid`, tenderID).Scan(&v); err != nil {
		t.Fatalf("grand total: %v", err)
	}
	if v == nil {
		return 0
	}
	return *v
}

// ─── §5. Authoritative calculated values ────────────────────────────────────

func TestExecuteVersionTransfer_AuthoritativeCalculatedValues(t *testing.T) {
	pool := newTestPool(t)
	f := seedTransferSource(t, pool, "auth", nil)
	f.seedFullBoq(t, pool, calc.CurrencyRUB)
	repo := NewTransferRepo(pool)

	srcGTBefore := grandTotal(t, pool, f.srcTenderID)

	res, err := repo.ExecuteVersionTransfer(context.Background(), f.transferInput())
	if err != nil {
		t.Fatalf("transfer failed: %v", err)
	}

	newID := newVersionID(t, pool, f)
	if newID == "" {
		t.Fatal("no new tender version was created")
	}

	target := readTenderBoq(t, pool, newID)
	if len(target) != 4 {
		t.Fatalf("target BOQ rows = %d, want 4 (3 matched + 1 additional)", len(target))
	}
	if res.BoqItemsCopied != 4 {
		t.Fatalf("result BoqItemsCopied = %d, want 4 (must match real rows)", res.BoqItemsCopied)
	}

	// New UUIDs — no source id survives.
	srcIDs := map[string]bool{f.workID: true, f.childMatID: true, f.standaloneID: true, f.addWorkID: true}
	for _, r := range target {
		if srcIDs[r.id] {
			t.Fatalf("target row reuses the SOURCE uuid %s", r.id)
		}
		// Source derived values must NOT have been copied.
		if fval(t, r.total, "target total_amount") == 999999 {
			t.Fatal("source total_amount (999999) was copied")
		}
		if fval(t, r.mat, "target mat cost") == 888888 || fval(t, r.work, "target work cost") == 999999 {
			t.Fatal("source commercial values were copied")
		}
		if fval(t, r.markup, "target markup") == 777 {
			t.Fatal("source commercial_markup (777) was copied")
		}
	}

	// Per-row authoritative values.
	var work, childMat, standalone, addWork vtRow
	for _, r := range target {
		switch {
		case r.isAdd:
			addWork = r
		case r.itemType == calc.BoqRab:
			work = r
		case r.parent != nil:
			childMat = r
		default:
			standalone = r
		}
	}

	check := func(name string, r vtRow, total, mat, wrk float64) {
		t.Helper()
		if got := fval(t, r.total, name+" total"); got != total {
			t.Errorf("%s total_amount = %v, want %v", name, got, total)
		}
		if got := fval(t, r.mat, name+" mat"); got != mat {
			t.Errorf("%s material cost = %v, want %v", name, got, mat)
		}
		if got := fval(t, r.work, name+" work"); got != wrk {
			t.Errorf("%s work cost = %v, want %v", name, got, wrk)
		}
	}
	// work:       1000 × 1.5 = 1500 → base 1000 → work, markup 500 → material
	check("work", work, tWorkTotal, 500, 1000)
	// child mat:  1000 × 1.2 = 1200 → base 1000 → material, markup 200 → work
	check("child material", childMat, tChildMatTotal, 1000, 200)
	// standalone: 1200 × 1.2 = 1440 → base 1200 → material, markup 240 → work
	check("standalone material", standalone, tStandaloneTotal, 1200, 240)
	// additional:  500 × 1.5 =  750 → base  500 → work, markup 250 → material
	check("additional work", addWork, tAddWorkTotal, 250, 500)

	// Position totals of the matched position: works 1000, materials 1000 + 1200.
	var tm, tw float64
	if err := pool.QueryRow(context.Background(),
		`SELECT COALESCE(total_material,0), COALESCE(total_works,0)
		 FROM public.client_positions WHERE id = $1::uuid`, work.posID).Scan(&tm, &tw); err != nil {
		t.Fatalf("position totals: %v", err)
	}
	if tm != 2200 || tw != 1000 {
		t.Errorf("matched position totals = (mat %v, work %v), want (2200, 1000)", tm, tw)
	}

	// Grand total = Σ commercial (4890) + insurance (50).
	if got := grandTotal(t, pool, newID); got != tGrandTotal {
		t.Errorf("cached_grand_total = %v, want %v (Σcommercial 4890 + insurance %v)", got, tGrandTotal, tInsurance)
	}

	// Source is untouched.
	srcRows := readTenderBoq(t, pool, f.srcTenderID)
	for _, r := range srcRows {
		if fval(t, r.total, "source total") != 999999 {
			t.Fatal("source BOQ was modified by the transfer")
		}
	}
	if got := grandTotal(t, pool, f.srcTenderID); got != srcGTBefore {
		t.Fatalf("source cached_grand_total changed: %v → %v", srcGTBefore, got)
	}
}

// ─── §6. The COPIED target configuration is what drives the calculation ─────

func TestExecuteVersionTransfer_UsesCopiedTargetConfiguration(t *testing.T) {
	pool := newTestPool(t)
	f := seedTransferSource(t, pool, "cfg", nil)
	f.seedFullBoq(t, pool, calc.CurrencyRUB)
	repo := NewTransferRepo(pool)

	if _, err := repo.ExecuteVersionTransfer(context.Background(), f.transferInput()); err != nil {
		t.Fatalf("transfer failed: %v", err)
	}
	newID := newVersionID(t, pool, f)
	if newID == "" {
		t.Fatal("no new tender version")
	}

	// 1. The configuration rows really landed in the TARGET tender.
	var nPct, nDist int
	if err := pool.QueryRow(context.Background(),
		`SELECT (SELECT count(*) FROM public.tender_markup_percentage WHERE tender_id=$1::uuid),
		        (SELECT count(*) FROM public.tender_pricing_distribution WHERE tender_id=$1::uuid)`,
		newID).Scan(&nPct, &nDist); err != nil {
		t.Fatalf("config counts: %v", err)
	}
	if nPct != 2 {
		t.Fatalf("target markup percentages = %d, want 2", nPct)
	}
	if nDist != 1 {
		t.Fatalf("target pricing distribution rows = %d, want 1", nDist)
	}

	// 2/3. The commercial result reflects THAT configuration, and is distinguishable
	// from what the fallback/default configuration would produce.
	var work vtRow
	for _, r := range readTenderBoq(t, pool, newID) {
		if r.itemType == calc.BoqRab && !r.isAdd {
			work = r
		}
	}
	mat := fval(t, work.mat, "work mat")
	wrk := fval(t, work.work, "work work")

	// With the COPIED config (pct 50 ⇒ ×1.5; work markup → material column):
	//   work column = base 1000, material column = markup 500.
	if wrk != 1000 || mat != 500 {
		t.Fatalf("work commercial = (mat %v, work %v), want (500, 1000) from the copied config", mat, wrk)
	}

	// Had the PERCENTAGES not been copied, BuildMarkupParamsMap would fall back to
	// works_16_markup = 60 ⇒ ×1.6 ⇒ markup 600, not 500.
	if mat == 600 {
		t.Fatal("markup percentages were NOT copied — the fallback (60%) was used")
	}
	// Had the PRICING DISTRIBUTION not been copied, calc would use its nil default and
	// put the whole commercial cost of a work row into the WORK column (1500 / 0).
	if wrk == 1500 && mat == 0 {
		t.Fatal("pricing distribution was NOT copied — calc used its default split")
	}
	if fval(t, work.markup, "work markup coefficient") != 1.5 {
		t.Fatalf("work markup coefficient = %v, want 1.5", *work.markup)
	}
}

// ─── §7. Missing target FX ⇒ the WHOLE new version is rolled back ────────────

func TestExecuteVersionTransfer_MissingFXRollsBackWholeVersion(t *testing.T) {
	pool := newTestPool(t)
	f := seedTransferSource(t, pool, "nofx", nil) // tender has NO usd_rate
	f.seedFullBoq(t, pool, calc.CurrencyUSD)      // …but the BOQ is priced in USD
	repo := NewTransferRepo(pool)

	srcGTBefore := grandTotal(t, pool, f.srcTenderID)

	_, err := repo.ExecuteVersionTransfer(context.Background(), f.transferInput())

	var fx *calc.MissingFXRateError
	if !errors.As(err, &fx) {
		t.Fatalf("expected MissingFXRateError, got %v", err)
	}
	if fx.Currency != calc.CurrencyUSD {
		t.Fatalf("currency = %q, want USD", fx.Currency)
	}

	// The ENTIRE new version must be gone — not just the BOQ inserts.
	if id := newVersionID(t, pool, f); id != "" {
		t.Fatalf("a new tender version survived the rollback: %s", id)
	}

	var nPos, nBoq, nPct, nDist, nIns int
	if err := pool.QueryRow(context.Background(), `
		WITH other AS (
		  SELECT id FROM public.tenders WHERE tender_number = $1 AND id <> $2::uuid
		)
		SELECT
		  (SELECT count(*) FROM public.client_positions WHERE tender_id IN (SELECT id FROM other)),
		  (SELECT count(*) FROM public.boq_items          WHERE tender_id IN (SELECT id FROM other)),
		  (SELECT count(*) FROM public.tender_markup_percentage   WHERE tender_id IN (SELECT id FROM other)),
		  (SELECT count(*) FROM public.tender_pricing_distribution WHERE tender_id IN (SELECT id FROM other)),
		  (SELECT count(*) FROM public.tender_insurance            WHERE tender_id IN (SELECT id FROM other))`,
		f.tenderNumber, f.srcTenderID).Scan(&nPos, &nBoq, &nPct, &nDist, &nIns); err != nil {
		t.Fatalf("leftover query: %v", err)
	}
	if nPos+nBoq+nPct+nDist+nIns != 0 {
		t.Fatalf("partial state survived: positions=%d boq=%d pct=%d dist=%d insurance=%d",
			nPos, nBoq, nPct, nDist, nIns)
	}

	// Source untouched.
	if got := grandTotal(t, pool, f.srcTenderID); got != srcGTBefore {
		t.Fatalf("source cached_grand_total changed: %v → %v", srcGTBefore, got)
	}
	if n := len(readTenderBoq(t, pool, f.srcTenderID)); n != 4 {
		t.Fatalf("source BOQ rows = %d, want 4 (unchanged)", n)
	}
}

// ─── §8. Parent links are remapped BEFORE the calculation ───────────────────

func TestExecuteVersionTransfer_RestoresTargetParentLinksBeforeCalculation(t *testing.T) {
	pool := newTestPool(t)
	f := seedTransferSource(t, pool, "parent", nil)
	f.seedFullBoq(t, pool, calc.CurrencyRUB)
	repo := NewTransferRepo(pool)

	if _, err := repo.ExecuteVersionTransfer(context.Background(), f.transferInput()); err != nil {
		t.Fatalf("transfer failed: %v", err)
	}
	newID := newVersionID(t, pool, f)

	var work, childMat, standalone vtRow
	for _, r := range readTenderBoq(t, pool, newID) {
		if r.isAdd {
			continue
		}
		switch {
		case r.itemType == calc.BoqRab:
			work = r
		case r.parent != nil:
			childMat = r
		default:
			standalone = r
		}
	}

	if work.id == "" || childMat.id == "" || standalone.id == "" {
		t.Fatalf("expected work + child + standalone in the target, got %+v", readTenderBoq(t, pool, newID))
	}
	// New UUIDs.
	if work.id == f.workID || childMat.id == f.childMatID {
		t.Fatal("target rows reuse source UUIDs")
	}
	// The child points at the TARGET work…
	if childMat.parent == nil || *childMat.parent != work.id {
		t.Fatalf("child parent = %v, want the target work %s", childMat.parent, work.id)
	}
	// …and never at the SOURCE work.
	if childMat.parent != nil && *childMat.parent == f.workID {
		t.Fatal("SOURCE work UUID leaked into the target parent_work_item_id")
	}

	// Child material: consumption NOT re-applied (forced to 1) ⇒ 10 × 1 × 100 = 1000.
	if got := fval(t, childMat.total, "child total"); got != tChildMatTotal {
		t.Fatalf("child total_amount = %v, want %v (consumption must NOT be applied to a child)", got, tChildMatTotal)
	}
	// Standalone material: consumption IS applied ⇒ 10 × 1.2 × 100 = 1200.
	if got := fval(t, standalone.total, "standalone total"); got != tStandaloneTotal {
		t.Fatalf("standalone total_amount = %v, want %v (consumption must be applied)", got, tStandaloneTotal)
	}
	// Commercial used the FINAL parent state: child base 1000 ⇒ ×1.2 ⇒ mat 1000 / work 200.
	if fval(t, childMat.mat, "child mat") != 1000 || fval(t, childMat.work, "child work") != 200 {
		t.Fatalf("child commercial = (mat %v, work %v), want (1000, 200) — derived from the final parent state",
			*childMat.mat, *childMat.work)
	}
}

// ─── §9. Invalid parent ⇒ the whole new version is rolled back ──────────────

func TestExecuteVersionTransfer_InvalidParentRollsBackWholeVersion(t *testing.T) {
	pool := newTestPool(t)
	f := seedTransferSource(t, pool, "badparent", nil)

	// A material whose parent is ANOTHER MATERIAL (never a valid work parent).
	cons := 1.2
	matParent := addBoq(t, pool, f.srcTenderID, f.normalPosID, f.detailCatID,
		calc.BoqMat, calc.CurrencyRUB, 1, 10, &cons, nil)
	addBoq(t, pool, f.srcTenderID, f.normalPosID, f.detailCatID,
		calc.BoqMat, calc.CurrencyRUB, 1, 10, &cons, &matParent)

	repo := NewTransferRepo(pool)
	_, err := repo.ExecuteVersionTransfer(context.Background(), f.transferInput())

	var pe *InvalidBoqParentError
	if !errors.As(err, &pe) {
		t.Fatalf("expected InvalidBoqParentError, got %v", err)
	}
	if pe.Reason != BoqParentNotWorkItem {
		t.Fatalf("reason = %q, want PARENT_NOT_WORK_ITEM", pe.Reason)
	}

	if id := newVersionID(t, pool, f); id != "" {
		t.Fatalf("a new tender version survived an invalid parent: %s", id)
	}
}

// ─── §10. The additional-position BOQ path is authoritative too ─────────────

func TestExecuteVersionTransfer_AdditionalPositionAuthoritativeCalculation(t *testing.T) {
	pool := newTestPool(t)
	f := seedTransferSource(t, pool, "addpos", nil)
	f.seedFullBoq(t, pool, calc.CurrencyRUB)
	repo := NewTransferRepo(pool)

	res, err := repo.ExecuteVersionTransfer(context.Background(), f.transferInput())
	if err != nil {
		t.Fatalf("transfer failed: %v", err)
	}
	newID := newVersionID(t, pool, f)

	// The additional position was created.
	var nAdd int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM public.client_positions
		 WHERE tender_id = $1::uuid AND is_additional = true`, newID).Scan(&nAdd); err != nil {
		t.Fatalf("count additional: %v", err)
	}
	if nAdd != 1 {
		t.Fatalf("target additional positions = %d, want 1 (the additional path did not run)", nAdd)
	}
	if res.AdditionalWorksCopied != 1 {
		t.Fatalf("result AdditionalWorksCopied = %d, want 1", res.AdditionalWorksCopied)
	}

	var addWork vtRow
	for _, r := range readTenderBoq(t, pool, newID) {
		if r.isAdd {
			addWork = r
		}
	}
	if addWork.id == "" {
		t.Fatal("additional position has no BOQ row")
	}
	if addWork.id == f.addWorkID {
		t.Fatal("additional BOQ reuses the source UUID")
	}
	// Source derived values must not have been copied…
	if fval(t, addWork.total, "add total") == 999999 {
		t.Fatal("additional BOQ copied the source total_amount")
	}
	// …and everything is recomputed: 5 × 100 = 500 ; ×1.5 = 750 → work 500, material 250.
	if got := fval(t, addWork.total, "add total"); got != tAddWorkTotal {
		t.Fatalf("additional total_amount = %v, want %v", got, tAddWorkTotal)
	}
	if fval(t, addWork.work, "add work") != 500 || fval(t, addWork.mat, "add mat") != 250 {
		t.Fatalf("additional commercial = (mat %v, work %v), want (250, 500)", *addWork.mat, *addWork.work)
	}

	// The grand total includes the additional position's commercial cost.
	if got := grandTotal(t, pool, newID); got != tGrandTotal {
		t.Fatalf("cached_grand_total = %v, want %v (must include the additional position)", got, tGrandTotal)
	}
}

// ─── §12. Grand total is computed AFTER commercial + insurance, exactly once ─

func TestExecuteVersionTransfer_GrandTotalIncludesInsuranceAndCommercial(t *testing.T) {
	pool := newTestPool(t)
	f := seedTransferSource(t, pool, "gt", nil)
	f.seedFullBoq(t, pool, calc.CurrencyRUB)
	repo := NewTransferRepo(pool)

	if _, err := repo.ExecuteVersionTransfer(context.Background(), f.transferInput()); err != nil {
		t.Fatalf("transfer failed: %v", err)
	}
	newID := newVersionID(t, pool, f)

	// Insurance was copied to the target.
	var nIns int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM public.tender_insurance WHERE tender_id = $1::uuid`, newID).Scan(&nIns); err != nil {
		t.Fatalf("insurance count: %v", err)
	}
	if nIns != 1 {
		t.Fatalf("target insurance rows = %d, want 1", nIns)
	}

	// Σ(commercial) straight from the target rows.
	var sumCommercial float64
	if err := pool.QueryRow(context.Background(),
		`SELECT COALESCE(SUM(COALESCE(total_commercial_material_cost,0)
		                   + COALESCE(total_commercial_work_cost,0)),0)
		 FROM public.boq_items WHERE tender_id = $1::uuid`, newID).Scan(&sumCommercial); err != nil {
		t.Fatalf("sum commercial: %v", err)
	}
	if sumCommercial != 4890 {
		t.Fatalf("Σ commercial = %v, want 4890", sumCommercial)
	}

	gt := grandTotal(t, pool, newID)

	// The grand total must equal Σcommercial + insurance. If it had been computed
	// BEFORE the commercial materialization it would be just the insurance (50);
	// if it had run BEFORE the insurance copy it would be just Σcommercial (4890).
	if gt != sumCommercial+tInsurance {
		t.Fatalf("cached_grand_total = %v, want Σcommercial (%v) + insurance (%v) = %v",
			gt, sumCommercial, tInsurance, sumCommercial+tInsurance)
	}
	if gt == tInsurance {
		t.Fatal("grand total ran BEFORE the commercial values were materialized")
	}
	if gt == sumCommercial {
		t.Fatal("grand total ran BEFORE tender_insurance was copied")
	}
}
