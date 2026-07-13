package calc

import (
	"errors"
	"fmt"
	"math"
	"testing"
)

// Stage 0.1.2.3a (§16): server-side validation of redistribution rules and
// position adjustments. Fail-closed: any issue blocks the save.

func rulesCtx() RedistributionValidationContext {
	a1, a2, b1 := "a1", "a2", "b1"
	return RedistributionValidationContext{
		KnownCategories:  map[string]string{"A": "Категория А", "B": "Категория Б"},
		KnownDetails:     map[string]string{"a1": "Деталь А1", "a2": "Деталь А2", "b1": "Деталь Б1"},
		DetailToCategory: map[string]string{"a1": "A", "a2": "A", "b1": "B"},
		BoqItems: []BoqItemWithCosts{
			{ID: "i1", ClientPositionID: "p1", DetailCostCategoryID: &a1, BoqItemType: BoqRab, TotalCommercialWorkCost: 1000},
			{ID: "i2", ClientPositionID: "p1", DetailCostCategoryID: &a2, BoqItemType: BoqSubRab, TotalCommercialWorkCost: 500},
			{ID: "i3", ClientPositionID: "p2", DetailCostCategoryID: &b1, BoqItemType: BoqRab, TotalCommercialWorkCost: 300},
		},
	}
}

func detailSource(detailID string, pct float64) RedistributionSourceRuleInput {
	return RedistributionSourceRuleInput{Level: "detail", DetailCostCategoryID: detailID, Percentage: pct}
}

func detailTarget(detailID string) RedistributionTargetInput {
	return RedistributionTargetInput{Level: "detail", DetailCostCategoryID: detailID}
}

func expectIssue(t *testing.T, err error, code string) *InvalidRedistributionRulesError {
	t.Helper()
	var rulesErr *InvalidRedistributionRulesError
	if !errors.As(err, &rulesErr) {
		t.Fatalf("want InvalidRedistributionRulesError, got %v", err)
	}
	for _, is := range rulesErr.Issues {
		if is.Code == code {
			return rulesErr
		}
	}
	t.Fatalf("issues %v do not contain code %s", rulesErr.Issues, code)
	return nil
}

// §16.4-6 — percentage bounds and finiteness.
func TestRulesValidation_PercentageBounds(t *testing.T) {
	for _, tc := range []struct {
		pct  float64
		code string
	}{
		{0, "PERCENTAGE_OUT_OF_RANGE"},
		{-5, "PERCENTAGE_OUT_OF_RANGE"},
		{100.01, "PERCENTAGE_OUT_OF_RANGE"},
		{math.NaN(), "PERCENTAGE_NOT_FINITE"},
		{math.Inf(1), "PERCENTAGE_NOT_FINITE"},
	} {
		in := RedistributionRulesInput{
			Deductions: []RedistributionSourceRuleInput{detailSource("a1", tc.pct)},
			Targets:    []RedistributionTargetInput{detailTarget("b1")},
		}
		_, err := ValidateAndNormalizeRedistributionRules(in, rulesCtx())
		expectIssue(t, err, tc.code)
	}
	// 100 включительно — валидно.
	in := RedistributionRulesInput{
		Deductions: []RedistributionSourceRuleInput{detailSource("a1", 100)},
		Targets:    []RedistributionTargetInput{detailTarget("b1")},
	}
	if _, err := ValidateAndNormalizeRedistributionRules(in, rulesCtx()); err != nil {
		t.Fatalf("percentage=100 must be valid, got %v", err)
	}
}

// §16.3 — unknown / duplicate boq_item_types are rejected; §16.2 — absent
// filter means all types (valid).
func TestRulesValidation_BoqItemTypesFilter(t *testing.T) {
	bad := RedistributionRulesInput{
		Deductions: []RedistributionSourceRuleInput{{
			Level: "detail", DetailCostCategoryID: "a1", Percentage: 10,
			BoqItemTypes: []string{"чужой-тип"},
		}},
		Targets: []RedistributionTargetInput{detailTarget("b1")},
	}
	_, err := ValidateAndNormalizeRedistributionRules(bad, rulesCtx())
	expectIssue(t, err, "UNKNOWN_BOQ_ITEM_TYPE")

	dup := RedistributionRulesInput{
		Deductions: []RedistributionSourceRuleInput{{
			Level: "detail", DetailCostCategoryID: "a1", Percentage: 10,
			BoqItemTypes: []string{BoqRab, BoqRab},
		}},
		Targets: []RedistributionTargetInput{detailTarget("b1")},
	}
	_, err = ValidateAndNormalizeRedistributionRules(dup, rulesCtx())
	expectIssue(t, err, "DUPLICATE_BOQ_ITEM_TYPE")

	ok := RedistributionRulesInput{
		Deductions: []RedistributionSourceRuleInput{detailSource("a1", 10)}, // без фильтра = все типы
		Targets:    []RedistributionTargetInput{detailTarget("b1")},
	}
	if _, err := ValidateAndNormalizeRedistributionRules(ok, rulesCtx()); err != nil {
		t.Fatalf("absent filter must be valid, got %v", err)
	}
}

// §16.7 — duplicate source scope (even with different filters: the engine
// bucket key would silently overwrite).
func TestRulesValidation_DuplicateSourceScope(t *testing.T) {
	in := RedistributionRulesInput{
		Deductions: []RedistributionSourceRuleInput{
			{Level: "detail", DetailCostCategoryID: "a1", Percentage: 10, BoqItemTypes: []string{BoqRab}},
			{Level: "detail", DetailCostCategoryID: "a1", Percentage: 20, BoqItemTypes: []string{BoqSubRab}},
		},
		Targets: []RedistributionTargetInput{detailTarget("b1")},
	}
	_, err := ValidateAndNormalizeRedistributionRules(in, rulesCtx())
	expectIssue(t, err, "DUPLICATE_SOURCE_SCOPE")
}

// §16.8 — whole category + a detail inside it is a hidden double deduction.
func TestRulesValidation_CategoryDetailOverlap(t *testing.T) {
	in := RedistributionRulesInput{
		Deductions: []RedistributionSourceRuleInput{
			{Level: "category", CategoryID: "A", Percentage: 10},
			detailSource("a1", 10),
		},
		Targets: []RedistributionTargetInput{detailTarget("b1")},
	}
	_, err := ValidateAndNormalizeRedistributionRules(in, rulesCtx())
	expectIssue(t, err, "CATEGORY_DETAIL_OVERLAP")

	// Тот же инвариант для targets.
	in2 := RedistributionRulesInput{
		Deductions: []RedistributionSourceRuleInput{detailSource("b1", 10)},
		Targets: []RedistributionTargetInput{
			{Level: "category", CategoryID: "A"},
			detailTarget("a1"),
		},
	}
	_, err = ValidateAndNormalizeRedistributionRules(in2, rulesCtx())
	expectIssue(t, err, "CATEGORY_DETAIL_OVERLAP")
}

// §16.9 — effective source/target overlap is computed on REAL BOQ sets, not
// JSON keys: detail a1 → target category A overlaps on item i1.
func TestRulesValidation_EffectiveSourceTargetOverlap(t *testing.T) {
	in := RedistributionRulesInput{
		Deductions: []RedistributionSourceRuleInput{detailSource("a1", 10)},
		Targets:    []RedistributionTargetInput{{Level: "category", CategoryID: "A"}},
	}
	_, err := ValidateAndNormalizeRedistributionRules(in, rulesCtx())
	expectIssue(t, err, "SOURCE_TARGET_OVERLAP")
}

// §16.10 — nonexistent category/detail IDs.
func TestRulesValidation_UnknownReferences(t *testing.T) {
	in := RedistributionRulesInput{
		Deductions: []RedistributionSourceRuleInput{detailSource("ghost", 10)},
		Targets:    []RedistributionTargetInput{{Level: "category", CategoryID: "GHOST"}},
	}
	_, err := ValidateAndNormalizeRedistributionRules(in, rulesCtx())
	expectIssue(t, err, "UNKNOWN_DETAIL_CATEGORY")
	expectIssue(t, err, "UNKNOWN_CATEGORY")

	lvl := RedistributionRulesInput{
		Deductions: []RedistributionSourceRuleInput{{Level: "чужой", CategoryID: "A", Percentage: 10}},
		Targets:    []RedistributionTargetInput{detailTarget("b1")},
	}
	_, err = ValidateAndNormalizeRedistributionRules(lvl, rulesCtx())
	expectIssue(t, err, "INVALID_LEVEL")
}

// §16.11/12 — empty effective target / source are blocking (never a silent
// wrong result).
func TestRulesValidation_EmptyEffectiveSets(t *testing.T) {
	vctx := rulesCtx()
	// b1 содержит только раб-item i3; фильтр по суб-раб не находит ничего.
	src := RedistributionRulesInput{
		Deductions: []RedistributionSourceRuleInput{{
			Level: "detail", DetailCostCategoryID: "b1", Percentage: 10,
			BoqItemTypes: []string{BoqSubMat},
		}},
		Targets: []RedistributionTargetInput{detailTarget("a1")},
	}
	_, err := ValidateAndNormalizeRedistributionRules(src, vctx)
	expectIssue(t, err, "EMPTY_EFFECTIVE_SOURCE")

	// Цель без items: категория B есть, но перенесём все её items в источник —
	// используем несуществующий-по-факту scope: detail a2 является источником,
	// целевой detail пуст (нет items с deталью, известной только справочнику).
	vctx2 := rulesCtx()
	vctx2.KnownDetails["empty"] = "Пустая деталь"
	vctx2.DetailToCategory["empty"] = "B"
	tgt := RedistributionRulesInput{
		Deductions: []RedistributionSourceRuleInput{detailSource("a1", 10)},
		Targets:    []RedistributionTargetInput{detailTarget("empty")},
	}
	_, err = ValidateAndNormalizeRedistributionRules(tgt, vctx2)
	expectIssue(t, err, "EMPTY_EFFECTIVE_TARGET")
}

// §4 — empty-rule semantics: one-sided and fully-empty configurations block;
// position-only is allowed.
func TestRulesValidation_EmptyRuleSemantics(t *testing.T) {
	oneSided := RedistributionRulesInput{
		Deductions: []RedistributionSourceRuleInput{detailSource("a1", 10)},
	}
	_, err := ValidateAndNormalizeRedistributionRules(oneSided, rulesCtx())
	expectIssue(t, err, "RULES_ONE_SIDED")

	empty := RedistributionRulesInput{}
	_, err = ValidateAndNormalizeRedistributionRules(empty, rulesCtx())
	expectIssue(t, err, "RULES_EMPTY")

	positionOnly := RedistributionRulesInput{
		PositionAdjustments: []PositionAdjustmentRuleInput{{
			Mode: "transfer", Amount: 100, SourceIDs: []string{"p1"}, TargetIDs: []string{"p2"},
		}},
	}
	norm, err := ValidateAndNormalizeRedistributionRules(positionOnly, rulesCtx())
	if err != nil {
		t.Fatalf("position-only configuration must be valid, got %v", err)
	}
	if len(norm.Sources) != 0 || len(norm.Targets) != 0 || len(norm.PositionAdjustments) != 1 {
		t.Fatalf("normalized form wrong: %+v", norm)
	}
	// §16.17 — the category engine yields a server-generated no-op result.
	out := CalculateRedistribution(rulesCtx().BoqItems, norm.Sources, norm.Targets, rulesCtx().DetailToCategory)
	for _, r := range out.Results {
		if r.DeductedAmount != 0 || r.AddedAmount != 0 || r.FinalWorkCost != r.OriginalWorkCost {
			t.Fatalf("no-op expected, got %+v", r)
		}
	}
	if err := ValidateRedistributionCalculation(rulesCtx().BoqItems, out); err != nil {
		t.Fatalf("no-op result must pass invariants: %v", err)
	}
}

// Canonical names come from the DB, legacy position_adjustment is normalized,
// server metadata is stamped.
func TestRulesValidation_CanonicalForm(t *testing.T) {
	in := RedistributionRulesInput{
		Deductions: []RedistributionSourceRuleInput{{
			Level: "detail", DetailCostCategoryID: "a1", Percentage: 10,
			CategoryName: "подделанное имя",
		}},
		Targets: []RedistributionTargetInput{{
			Level: "category", CategoryID: "B", CategoryName: "тоже подделка",
		}},
		LegacyPositionAdjustment: &PositionAdjustmentRuleInput{
			Mode: "deduct", Amount: 50, SourceIDs: []string{"p1"},
		},
	}
	norm, err := ValidateAndNormalizeRedistributionRules(in, rulesCtx())
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if norm.Canonical.Deductions[0].CategoryName != "Деталь А1" {
		t.Fatalf("deduction name must be canonical, got %q", norm.Canonical.Deductions[0].CategoryName)
	}
	if norm.Canonical.Targets[0].CategoryName != "Категория Б" {
		t.Fatalf("target name must be canonical, got %q", norm.Canonical.Targets[0].CategoryName)
	}
	if len(norm.PositionAdjustments) != 1 || norm.PositionAdjustments[0].Mode != "deduct" {
		t.Fatalf("legacy position_adjustment must normalize, got %+v", norm.PositionAdjustments)
	}
	if norm.Canonical.SchemaVersion != RedistributionSchemaVersion ||
		norm.Canonical.CalculationSource != RedistributionCalculationServer {
		t.Fatalf("server metadata missing: %+v", norm.Canonical)
	}
	if norm.Canonical.LegacyPositionAdjustment != nil {
		t.Fatal("canonical form must not keep the legacy single-op field")
	}
}

// Both legacy and new adjustment forms together are ambiguous.
func TestRulesValidation_LegacyAndNewAdjustmentsConflict(t *testing.T) {
	in := RedistributionRulesInput{
		Deductions:               []RedistributionSourceRuleInput{detailSource("a1", 10)},
		Targets:                  []RedistributionTargetInput{detailTarget("b1")},
		PositionAdjustments:      []PositionAdjustmentRuleInput{{Mode: "deduct", Amount: 1, SourceIDs: []string{"p1"}}},
		LegacyPositionAdjustment: &PositionAdjustmentRuleInput{Mode: "add", Amount: 2, TargetIDs: []string{"p2"}},
	}
	_, err := ValidateAndNormalizeRedistributionRules(in, rulesCtx())
	expectIssue(t, err, "LEGACY_AND_NEW_ADJUSTMENTS")
}

// ─── position adjustments (§16.18-20, §5) ────────────────────────────────────

func adjBase() []PositionBaseRow {
	return []PositionBaseRow{
		{PositionID: "p1", TotalWorksAfter: 1000},
		{PositionID: "p2", TotalWorksAfter: 500},
	}
}

func adjKnown() map[string]bool { return map[string]bool{"p1": true, "p2": true} }

func hasAdjIssue(issues []RuleIssue, code string) bool {
	for _, is := range issues {
		if is.Code == code {
			return true
		}
	}
	return false
}

// §16.18 — amount exceeding the available source total is rejected.
func TestPositionAdjustments_AmountExceedsSource(t *testing.T) {
	issues, _ := ValidatePositionAdjustments([]PositionAdjustmentRuleInput{
		{Mode: "deduct", Amount: 1500, SourceIDs: []string{"p1"}},
	}, adjBase(), adjKnown())
	if !hasAdjIssue(issues, "AMOUNT_EXCEEDS_SOURCE") {
		t.Fatalf("want AMOUNT_EXCEEDS_SOURCE, got %v", issues)
	}
}

// §16.19 — sequential rules validate against the EVOLVING base: rule 1 empties
// p1, so rule 2 cannot deduct from it again.
func TestPositionAdjustments_SequentialEvolvingBase(t *testing.T) {
	rules := []PositionAdjustmentRuleInput{
		{Mode: "transfer", Amount: 1000, SourceIDs: []string{"p1"}, TargetIDs: []string{"p2"}},
		{Mode: "deduct", Amount: 500, SourceIDs: []string{"p1"}},
	}
	issues, _ := ValidatePositionAdjustments(rules, adjBase(), adjKnown())
	if !hasAdjIssue(issues, "AMOUNT_EXCEEDS_SOURCE") {
		t.Fatalf("rule 2 must see p1 drained by rule 1, got %v", issues)
	}

	// А валидная последовательность даёт кумулятивные дельты по меняющейся базе.
	okRules := []PositionAdjustmentRuleInput{
		{Mode: "transfer", Amount: 400, SourceIDs: []string{"p1"}, TargetIDs: []string{"p2"}},
		{Mode: "deduct", Amount: 600, SourceIDs: []string{"p1"}},
	}
	issues, deltas := ValidatePositionAdjustments(okRules, adjBase(), adjKnown())
	if len(issues) != 0 {
		t.Fatalf("unexpected issues: %v", issues)
	}
	if math.Abs(deltas["p1"]-(-1000)) > 1e-9 || math.Abs(deltas["p2"]-400) > 1e-9 {
		t.Fatalf("cumulative deltas wrong: %v", deltas)
	}
}

// §16.20 — a position of another tender (unknown to the server) is rejected.
func TestPositionAdjustments_ForeignPositionRejected(t *testing.T) {
	issues, _ := ValidatePositionAdjustments([]PositionAdjustmentRuleInput{
		{Mode: "transfer", Amount: 10, SourceIDs: []string{"p1"}, TargetIDs: []string{"foreign-tender-pos"}},
	}, adjBase(), adjKnown())
	if !hasAdjIssue(issues, "UNKNOWN_POSITION") {
		t.Fatalf("want UNKNOWN_POSITION, got %v", issues)
	}
}

// §5 — structural rules: mode, finiteness, required sides, overlap, duplicates.
func TestPositionAdjustments_StructuralRules(t *testing.T) {
	cases := []struct {
		rule PositionAdjustmentRuleInput
		code string
	}{
		{PositionAdjustmentRuleInput{Mode: "explode", Amount: 1}, "INVALID_MODE"},
		{PositionAdjustmentRuleInput{Mode: "deduct", Amount: math.NaN(), SourceIDs: []string{"p1"}}, "AMOUNT_NOT_FINITE"},
		{PositionAdjustmentRuleInput{Mode: "deduct", Amount: 0, SourceIDs: []string{"p1"}}, "AMOUNT_REQUIRED"},
		{PositionAdjustmentRuleInput{Mode: "deduct", Amount: 10}, "SOURCE_REQUIRED"},
		{PositionAdjustmentRuleInput{Mode: "add", Amount: 10}, "TARGET_REQUIRED"},
		{PositionAdjustmentRuleInput{Mode: "transfer", Amount: 10, SourceIDs: []string{"p1"}, TargetIDs: []string{"p1"}}, "SOURCE_TARGET_OVERLAP"},
		{PositionAdjustmentRuleInput{Mode: "deduct", Amount: 10, SourceIDs: []string{"p1", "p1"}}, "DUPLICATE_POSITION_ID"},
	}
	for _, tc := range cases {
		issues, _ := ValidatePositionAdjustments([]PositionAdjustmentRuleInput{tc.rule}, adjBase(), adjKnown())
		if !hasAdjIssue(issues, tc.code) {
			t.Errorf("rule %+v: want %s, got %v", tc.rule, tc.code, issues)
		}
	}
}

// ─── calculation invariants (§9, §16.13-16) ──────────────────────────────────

func TestCalculationInvariants(t *testing.T) {
	vctx := rulesCtx()
	items := vctx.BoqItems

	// Валидный результат проходит.
	out := CalculateRedistribution(items,
		[]SourceRule{{Level: LevelDetail, DetailCostCategoryID: "a1", Percentage: 10}},
		[]TargetCost{{Level: LevelDetail, DetailCostCategoryID: "b1"}},
		vctx.DetailToCategory)
	if err := ValidateRedistributionCalculation(items, out); err != nil {
		t.Fatalf("valid result must pass: %v", err)
	}

	// §16.15 — negative final is rejected (internal invariant).
	bad := out
	bad.Results = append([]RedistributionResult{}, out.Results...)
	bad.Results[0] = RedistributionResult{
		BoqItemID: items[0].ID, OriginalWorkCost: items[0].TotalCommercialWorkCost,
		DeductedAmount: items[0].TotalCommercialWorkCost + 500, AddedAmount: 0,
		FinalWorkCost: -500,
	}
	var calcErr *InvalidRedistributionCalculationResultError
	if err := ValidateRedistributionCalculation(items, bad); !errors.As(err, &calcErr) {
		t.Fatalf("negative final must be InvalidRedistributionCalculationResultError, got %v", err)
	}

	// §16.14/§9.12 — a real imbalance is a typed blocking error, never saved.
	unb := out
	unb.TotalAdded = out.TotalAdded + 5
	var unbErr *UnbalancedRedistributionError
	if err := ValidateRedistributionCalculation(items, unb); !errors.As(err, &unbErr) {
		t.Fatalf("imbalance must be UnbalancedRedistributionError, got %v", err)
	}

	// §16.16 — microscopic floating residual within the documented tolerance passes.
	resid := out
	resid.TotalAdded = out.TotalDeducted + 1e-9
	if err := ValidateRedistributionCalculation(items, resid); err != nil {
		t.Fatalf("floating residual within 0.01 must pass, got %v", err)
	}

	// Wrong original vs current commercial cost — invariant violation.
	stale := out
	stale.Results = append([]RedistributionResult{}, out.Results...)
	stale.Results[1].OriginalWorkCost += 777
	stale.Results[1].FinalWorkCost += 777
	if err := ValidateRedistributionCalculation(items, stale); !errors.As(err, &calcErr) {
		t.Fatalf("stale original must fail invariants, got %v", err)
	}
}

// errors.As must survive the repository → service %w chain for every typed error.
func TestRedistributionErrors_SurviveWrapping(t *testing.T) {
	wrap := func(e error) error {
		return fmt.Errorf("redistributionService.Save: %w",
			fmt.Errorf("redistributionRepo.SaveAuthoritative: %w", e))
	}
	var rulesErr *InvalidRedistributionRulesError
	if !errors.As(wrap(&InvalidRedistributionRulesError{Issues: []RuleIssue{{Code: "X"}}}), &rulesErr) {
		t.Fatal("InvalidRedistributionRulesError lost")
	}
	var tacticErr *RedistributionTacticMismatchError
	if !errors.As(wrap(&RedistributionTacticMismatchError{TenderID: "t"}), &tacticErr) {
		t.Fatal("RedistributionTacticMismatchError lost")
	}
	var unbErr *UnbalancedRedistributionError
	if !errors.As(wrap(&UnbalancedRedistributionError{}), &unbErr) {
		t.Fatal("UnbalancedRedistributionError lost")
	}
	var noErr *RedistributionNoBoqItemsError
	if !errors.As(wrap(&RedistributionNoBoqItemsError{TenderID: "t"}), &noErr) {
		t.Fatal("RedistributionNoBoqItemsError lost")
	}
}
