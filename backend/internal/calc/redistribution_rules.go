// Stage 0.1.2.3a: typed redistribution rules + server-side validation.
// The client saves ONLY rules; every per-BOQ financial value is calculated by
// CalculateRedistribution from the tender's current authoritative state.
package calc

import (
	"fmt"
	"math"
	"sort"
)

// Metadata written into the canonical persisted rules JSON. A snapshot without
// these markers was produced by a pre-0.1.2.3a client and must not be treated
// as server-authoritative (GET returns status "requires_recalculation").
const (
	RedistributionSchemaVersion     = 2
	RedistributionCalculationServer = "server"
)

// ─── transport / persisted rule shapes ───────────────────────────────────────

// RedistributionSourceRuleInput is one "откуда вычитаем" rule as sent by the
// client and as persisted (canonicalized) in redistribution_rules JSONB.
// CategoryName is display metadata only — semantics come from the IDs.
type RedistributionSourceRuleInput struct {
	Level                string   `json:"level"`
	CategoryID           string   `json:"category_id,omitempty"`
	DetailCostCategoryID string   `json:"detail_cost_category_id,omitempty"`
	CategoryName         string   `json:"category_name,omitempty"`
	Percentage           float64  `json:"percentage"`
	BoqItemTypes         []string `json:"boq_item_types,omitempty"`
}

// RedistributionTargetInput is one "куда добавляем" rule.
type RedistributionTargetInput struct {
	Level                string `json:"level"`
	CategoryID           string `json:"category_id,omitempty"`
	DetailCostCategoryID string `json:"detail_cost_category_id,omitempty"`
	CategoryName         string `json:"category_name,omitempty"`
}

// PositionAdjustmentRuleInput is one position-level ("между строками") rule.
// Only the rule params persist; per-position deltas are recomputed on the
// server-generated category-level base and never stored as money.
type PositionAdjustmentRuleInput struct {
	Mode      string   `json:"mode"` // deduct | transfer | add
	Amount    float64  `json:"amount"`
	SourceIDs []string `json:"sourceIds"`
	TargetIDs []string `json:"targetIds"`
}

// RedistributionRulesInput is the full rules command / persisted rules JSON.
type RedistributionRulesInput struct {
	Deductions          []RedistributionSourceRuleInput `json:"deductions"`
	Targets             []RedistributionTargetInput     `json:"targets"`
	PositionAdjustments []PositionAdjustmentRuleInput   `json:"position_adjustments,omitempty"`
	// LegacyPositionAdjustment — pre-iteration snapshots stored a single
	// operation under "position_adjustment"; normalized into PositionAdjustments.
	LegacyPositionAdjustment *PositionAdjustmentRuleInput `json:"position_adjustment,omitempty"`
	SchemaVersion            int                          `json:"schema_version,omitempty"`
	CalculationSource        string                       `json:"calculation_source,omitempty"`
}

// ─── typed domain errors ─────────────────────────────────────────────────────

// RuleIssue points at one invalid rule field (RFC 7807 "issues" member).
type RuleIssue struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// InvalidRedistributionRulesError — blocking: the rules command cannot be
// executed; nothing is calculated or persisted.
type InvalidRedistributionRulesError struct {
	Issues []RuleIssue
}

func (e *InvalidRedistributionRulesError) Error() string {
	return fmt.Sprintf("INVALID_REDISTRIBUTION_RULES: %d issue(s), first: %+v", len(e.Issues), e.Issues[0])
}

// Code returns the stable machine-readable error code.
func (e *InvalidRedistributionRulesError) Code() string { return "INVALID_REDISTRIBUTION_RULES" }

// RedistributionTacticMismatchError — the save targets a tactic that is not
// the tender's active markup tactic; redistribution over another tactic's
// commercial values is not allowed (no server-side scenario engine yet).
type RedistributionTacticMismatchError struct {
	TenderID          string
	RequestedTacticID string
	ActiveTacticID    string
}

func (e *RedistributionTacticMismatchError) Error() string {
	return fmt.Sprintf("REDISTRIBUTION_TACTIC_MISMATCH: tender %s, requested %s, active %s",
		e.TenderID, e.RequestedTacticID, e.ActiveTacticID)
}

// Code returns the stable machine-readable error code.
func (e *RedistributionTacticMismatchError) Code() string { return "REDISTRIBUTION_TACTIC_MISMATCH" }

// UnbalancedRedistributionError — the calculated snapshot does not balance
// (total deducted ≠ total added beyond the documented 0.01 tolerance). An
// unbalanced result is never persisted.
type UnbalancedRedistributionError struct {
	TotalDeducted float64
	TotalAdded    float64
}

func (e *UnbalancedRedistributionError) Error() string {
	return fmt.Sprintf("REDISTRIBUTION_UNBALANCED: deducted %v vs added %v", e.TotalDeducted, e.TotalAdded)
}

// Code returns the stable machine-readable error code.
func (e *UnbalancedRedistributionError) Code() string { return "REDISTRIBUTION_UNBALANCED" }

// RedistributionNoBoqItemsError — the tender has no BOQ items to redistribute.
type RedistributionNoBoqItemsError struct {
	TenderID string
}

func (e *RedistributionNoBoqItemsError) Error() string {
	return "REDISTRIBUTION_NO_BOQ_ITEMS: tender " + e.TenderID
}

// Code returns the stable machine-readable error code.
func (e *RedistributionNoBoqItemsError) Code() string { return "REDISTRIBUTION_NO_BOQ_ITEMS" }

// InvalidRedistributionCalculationResultError — an internal calc invariant was
// violated (a bug, not user input); the result is never persisted.
type InvalidRedistributionCalculationResultError struct {
	Field  string
	Reason string
}

func (e *InvalidRedistributionCalculationResultError) Error() string {
	return fmt.Sprintf("INVALID_REDISTRIBUTION_CALCULATION_RESULT: %s (%s)", e.Reason, e.Field)
}

// ─── validation context & normalization ──────────────────────────────────────

// RedistributionValidationContext carries the DB-confirmed reference data the
// pure validator needs (loaded by the repository inside the transaction).
type RedistributionValidationContext struct {
	// KnownCategories / KnownDetails: id → canonical DB name.
	KnownCategories map[string]string
	KnownDetails    map[string]string
	// DetailToCategory: detail_cost_category_id → cost_category_id.
	DetailToCategory map[string]string
	// BoqItems — the tender's full current BOQ (server-loaded).
	BoqItems []BoqItemWithCosts
}

// NormalizedRedistributionRules is the validated, canonical form: engine rules
// plus the canonical rules JSON payload to persist.
type NormalizedRedistributionRules struct {
	Sources             []SourceRule
	Targets             []TargetCost
	PositionAdjustments []PositionAdjustmentRuleInput
	// Canonical — DB-confirmed names, normalized adjustments, server metadata.
	Canonical RedistributionRulesInput
}

func issue(field, code, msg string) RuleIssue {
	return RuleIssue{Field: field, Code: code, Message: msg}
}

func isFinite(f float64) bool { return !math.IsNaN(f) && !math.IsInf(f, 0) }

// canonicalBoqItemTypes — the only values a boq_item_types filter may contain.
var canonicalBoqItemTypes = map[string]bool{
	BoqRab: true, BoqSubRab: true, BoqRabKomp: true,
	BoqMat: true, BoqSubMat: true, BoqMatKomp: true,
}

// scopeKey mirrors the engine's deduction-bucket key: a duplicate scope would
// silently overwrite the previous bucket in BOTH engines, so it is a blocking
// validation error regardless of boq_item_types filters.
func sourceScopeKey(level, catID, detailID string) string {
	if level == string(LevelCategory) {
		return "cat_" + catID
	}
	return "det_" + detailID
}

// ValidateAndNormalizeRedistributionRules validates the rules command against
// the tender's DB-confirmed reference data and current BOQ, and returns the
// canonical normalized form. Fail-closed: ANY issue blocks the save.
func ValidateAndNormalizeRedistributionRules(
	in RedistributionRulesInput,
	vctx RedistributionValidationContext,
) (*NormalizedRedistributionRules, error) {
	var issues []RuleIssue

	// Legacy single position_adjustment → position_adjustments (normalization,
	// not silent dedup: both present is ambiguous and rejected).
	adjustments := in.PositionAdjustments
	if in.LegacyPositionAdjustment != nil {
		if len(adjustments) > 0 {
			issues = append(issues, issue("position_adjustment", "LEGACY_AND_NEW_ADJUSTMENTS",
				"Нельзя передавать одновременно position_adjustment и position_adjustments"))
		} else if in.LegacyPositionAdjustment.Amount > 0 {
			adjustments = []PositionAdjustmentRuleInput{*in.LegacyPositionAdjustment}
		}
	}

	// Empty-rule semantics (§4): both sides, position-only, one-sided, all-empty.
	switch {
	case len(in.Deductions) > 0 && len(in.Targets) > 0:
		// category redistribution
	case len(in.Deductions) == 0 && len(in.Targets) == 0 && len(adjustments) > 0:
		// position-only configuration → server-generated no-op category result
	case len(in.Deductions) == 0 && len(in.Targets) == 0:
		issues = append(issues, issue("rules", "RULES_EMPTY",
			"Правила пусты: нечего рассчитывать (очистка снимка — отдельная операция)"))
	default:
		issues = append(issues, issue("rules", "RULES_ONE_SIDED",
			"Заполнены только источники или только цели перераспределения"))
	}

	canonical := RedistributionRulesInput{
		Deductions:          make([]RedistributionSourceRuleInput, 0, len(in.Deductions)),
		Targets:             make([]RedistributionTargetInput, 0, len(in.Targets)),
		PositionAdjustments: adjustments,
		SchemaVersion:       RedistributionSchemaVersion,
		CalculationSource:   RedistributionCalculationServer,
	}
	sources := make([]SourceRule, 0, len(in.Deductions))
	targets := make([]TargetCost, 0, len(in.Targets))

	// ── deductions ──
	seenSourceScopes := map[string]int{}
	sourceCategoryIDs := map[string]bool{}
	sourceDetailIDs := map[string]bool{}
	for i, d := range in.Deductions {
		f := fmt.Sprintf("deductions[%d]", i)
		if !isFinite(d.Percentage) {
			issues = append(issues, issue(f+".percentage", "PERCENTAGE_NOT_FINITE", "Процент должен быть конечным числом"))
			continue
		}
		if d.Percentage <= 0 || d.Percentage > 100 {
			issues = append(issues, issue(f+".percentage", "PERCENTAGE_OUT_OF_RANGE", "Процент должен быть в диапазоне (0, 100]"))
		}
		name, ok := validateScope(&issues, f, d.Level, d.CategoryID, d.DetailCostCategoryID, vctx)
		if !ok {
			continue
		}
		// boq_item_types: only canonical types, no duplicates.
		seenTypes := map[string]bool{}
		for j, tp := range d.BoqItemTypes {
			tf := fmt.Sprintf("%s.boq_item_types[%d]", f, j)
			if !canonicalBoqItemTypes[tp] {
				issues = append(issues, issue(tf, "UNKNOWN_BOQ_ITEM_TYPE", "Неизвестный тип BOQ-элемента: "+tp))
			}
			if seenTypes[tp] {
				issues = append(issues, issue(tf, "DUPLICATE_BOQ_ITEM_TYPE", "Дублирующийся тип BOQ-элемента: "+tp))
			}
			seenTypes[tp] = true
		}
		key := sourceScopeKey(d.Level, d.CategoryID, d.DetailCostCategoryID)
		if prev, dup := seenSourceScopes[key]; dup {
			issues = append(issues, issue(f, "DUPLICATE_SOURCE_SCOPE",
				fmt.Sprintf("Затрата уже используется в deductions[%d]; каждая затрата вычитается один раз", prev)))
		}
		seenSourceScopes[key] = i
		if d.Level == string(LevelCategory) {
			sourceCategoryIDs[d.CategoryID] = true
		} else {
			sourceDetailIDs[d.DetailCostCategoryID] = true
		}

		canonical.Deductions = append(canonical.Deductions, RedistributionSourceRuleInput{
			Level: d.Level, CategoryID: d.CategoryID, DetailCostCategoryID: d.DetailCostCategoryID,
			CategoryName: name, Percentage: d.Percentage, BoqItemTypes: d.BoqItemTypes,
		})
		sources = append(sources, SourceRule{
			Level: RuleLevel(d.Level), CategoryID: d.CategoryID,
			DetailCostCategoryID: d.DetailCostCategoryID, CategoryName: name,
			Percentage: d.Percentage, BoqItemTypes: d.BoqItemTypes,
		})
	}
	// Hidden source overlap: whole category + a detail inside that category.
	for i, d := range in.Deductions {
		if d.Level == string(LevelDetail) {
			if cat := vctx.DetailToCategory[d.DetailCostCategoryID]; cat != "" && sourceCategoryIDs[cat] {
				issues = append(issues, issue(fmt.Sprintf("deductions[%d]", i), "CATEGORY_DETAIL_OVERLAP",
					"Детальная затрата уже покрыта правилом на всю категорию — двойное вычитание запрещено"))
			}
		}
	}

	// ── targets ──
	seenTargetScopes := map[string]int{}
	targetCategoryIDs := map[string]bool{}
	for i, tg := range in.Targets {
		f := fmt.Sprintf("targets[%d]", i)
		name, ok := validateScope(&issues, f, tg.Level, tg.CategoryID, tg.DetailCostCategoryID, vctx)
		if !ok {
			continue
		}
		key := sourceScopeKey(tg.Level, tg.CategoryID, tg.DetailCostCategoryID)
		if prev, dup := seenTargetScopes[key]; dup {
			issues = append(issues, issue(f, "DUPLICATE_TARGET_SCOPE",
				fmt.Sprintf("Затрата уже используется в targets[%d]", prev)))
		}
		seenTargetScopes[key] = i
		if tg.Level == string(LevelCategory) {
			targetCategoryIDs[tg.CategoryID] = true
		}
		canonical.Targets = append(canonical.Targets, RedistributionTargetInput{
			Level: tg.Level, CategoryID: tg.CategoryID,
			DetailCostCategoryID: tg.DetailCostCategoryID, CategoryName: name,
		})
		targets = append(targets, TargetCost{
			Level: RuleLevel(tg.Level), CategoryID: tg.CategoryID,
			DetailCostCategoryID: tg.DetailCostCategoryID, CategoryName: name,
		})
	}
	for i, tg := range in.Targets {
		if tg.Level == string(LevelDetail) {
			if cat := vctx.DetailToCategory[tg.DetailCostCategoryID]; cat != "" && targetCategoryIDs[cat] {
				issues = append(issues, issue(fmt.Sprintf("targets[%d]", i), "CATEGORY_DETAIL_OVERLAP",
					"Детальная затрата уже покрыта целевым правилом на всю категорию"))
			}
		}
	}

	// ── effective BOQ item sets (not just JSON-key comparison) ──
	if len(issues) == 0 && len(sources) > 0 {
		sourceSet := map[string]bool{}
		for i, s := range sources {
			ids := effectiveSourceItems(vctx.BoqItems, s, vctx.DetailToCategory)
			if len(ids) == 0 {
				issues = append(issues, issue(fmt.Sprintf("deductions[%d]", i), "EMPTY_EFFECTIVE_SOURCE",
					"Правило не находит ни одного BOQ-элемента (с учётом фильтра типов) — вычитать нечего"))
			}
			for _, id := range ids {
				sourceSet[id] = true
			}
		}
		targetSet := map[string]bool{}
		for _, tg := range targets {
			for _, id := range effectiveTargetItems(vctx.BoqItems, tg, vctx.DetailToCategory) {
				targetSet[id] = true // union dedupes the effective target set
			}
		}
		if len(targetSet) == 0 {
			issues = append(issues, issue("targets", "EMPTY_EFFECTIVE_TARGET",
				"Целевые правила не находят ни одного BOQ-элемента — добавлять некуда"))
		}
		overlap := make([]string, 0)
		for id := range sourceSet {
			if targetSet[id] {
				overlap = append(overlap, id)
			}
		}
		if len(overlap) > 0 {
			sort.Strings(overlap)
			issues = append(issues, issue("rules", "SOURCE_TARGET_OVERLAP",
				fmt.Sprintf("%d BOQ-элемент(ов) одновременно являются источником и целью (например %s)", len(overlap), overlap[0])))
		}
	}

	if len(issues) > 0 {
		return nil, &InvalidRedistributionRulesError{Issues: issues}
	}
	return &NormalizedRedistributionRules{
		Sources:             sources,
		Targets:             targets,
		PositionAdjustments: adjustments,
		Canonical:           canonical,
	}, nil
}

// validateScope checks level + the corresponding DB-confirmed ID and returns
// the canonical category name.
func validateScope(
	issues *[]RuleIssue, field, level, catID, detailID string,
	vctx RedistributionValidationContext,
) (string, bool) {
	switch level {
	case string(LevelCategory):
		if catID == "" {
			*issues = append(*issues, issue(field+".category_id", "CATEGORY_ID_REQUIRED", "category_id обязателен для level=category"))
			return "", false
		}
		name, ok := vctx.KnownCategories[catID]
		if !ok {
			*issues = append(*issues, issue(field+".category_id", "UNKNOWN_CATEGORY", "Категория затрат не найдена"))
			return "", false
		}
		return name, true
	case string(LevelDetail):
		if detailID == "" {
			*issues = append(*issues, issue(field+".detail_cost_category_id", "DETAIL_ID_REQUIRED", "detail_cost_category_id обязателен для level=detail"))
			return "", false
		}
		name, ok := vctx.KnownDetails[detailID]
		if !ok {
			*issues = append(*issues, issue(field+".detail_cost_category_id", "UNKNOWN_DETAIL_CATEGORY", "Детальная категория затрат не найдена"))
			return "", false
		}
		return name, true
	default:
		*issues = append(*issues, issue(field+".level", "INVALID_LEVEL", "level должен быть category или detail"))
		return "", false
	}
}

// effectiveSourceItems resolves a source rule to concrete BOQ item IDs — the
// same matching + boq_item_types filter the engine applies.
func effectiveSourceItems(items []BoqItemWithCosts, s SourceRule, detailToCategory map[string]string) []string {
	allowed := map[string]bool{}
	for _, tp := range s.BoqItemTypes {
		allowed[tp] = true
	}
	out := make([]string, 0)
	for _, it := range items {
		if !itemInScope(it, RuleLevel(s.Level), s.CategoryID, s.DetailCostCategoryID, detailToCategory) {
			continue
		}
		if len(allowed) > 0 && !allowed[it.BoqItemType] {
			continue
		}
		out = append(out, it.ID)
	}
	return out
}

// effectiveTargetItems resolves a target rule to concrete BOQ item IDs.
func effectiveTargetItems(items []BoqItemWithCosts, tg TargetCost, detailToCategory map[string]string) []string {
	out := make([]string, 0)
	for _, it := range items {
		if itemInScope(it, tg.Level, tg.CategoryID, tg.DetailCostCategoryID, detailToCategory) {
			out = append(out, it.ID)
		}
	}
	return out
}

func itemInScope(it BoqItemWithCosts, level RuleLevel, catID, detailID string, detailToCategory map[string]string) bool {
	if it.DetailCostCategoryID == nil {
		return false
	}
	switch level {
	case LevelDetail:
		return detailID != "" && *it.DetailCostCategoryID == detailID
	case LevelCategory:
		return catID != "" && detailToCategory[*it.DetailCostCategoryID] == catID
	default:
		return false
	}
}
