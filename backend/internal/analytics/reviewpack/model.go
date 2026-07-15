// Package reviewpack — этап 1.6: единый серверный «Отчёт для проверки».
//
// Жёсткие границы:
//   - read-only: никаких мутаций/recalc/approval/сохранения файлов/истории;
//   - НИКАКИХ новых финансовых формул: все суммы приходят из ГОТОВЫХ engines
//     этапов 0-1.5 (quality, action plan, benchmark, source, change impact);
//   - XLSX не пересчитывает деньги и не содержит Excel-формул вообще;
//   - один согласованный snapshot (одна financial_input_revision);
//   - formula-injection protection для всего user-controlled текста.
package reviewpack

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	ap "github.com/su10/hubtender/backend/internal/analytics/actionplan"
	ci "github.com/su10/hubtender/backend/internal/analytics/changeimpact"
	pb "github.com/su10/hubtender/backend/internal/analytics/pricebenchmark"
	ps "github.com/su10/hubtender/backend/internal/analytics/pricesource"
	"github.com/su10/hubtender/backend/internal/quality"
)

// ReportSchemaVersion — версия схемы отчёта (§4).
const ReportSchemaVersion = 1

// Статусы отчёта и секций (§5).
const (
	ReportReady        = "ready"
	ReportNotReady     = "calculation_not_ready"
	SectionAvailable   = "available"
	SectionNoData      = "no_data"
	SectionBaselineNA  = "baseline_not_available"
	SectionNotReady    = "calculation_not_ready"
	SectionUnavailable = "unavailable"
)

// Metadata — реквизиты отчёта (§4).
type Metadata struct {
	ReportSchemaVersion    int     `json:"report_schema_version"`
	TenderID               string  `json:"tender_id"`
	TenderNumber           string  `json:"tender_number"`
	TenderVersion          int     `json:"tender_version"`
	TenderLabel            string  `json:"tender_label"`
	FinancialInputRevision int64   `json:"financial_input_revision"`
	FinancialCalcRevision  int64   `json:"financial_calculation_revision"`
	FinancialCalcStatus    string  `json:"financial_calculation_status"`
	FinancialApproved      bool    `json:"financial_approved"`
	ApprovedByLabel        string  `json:"approved_by_label,omitempty"`
	ApprovedAt             string  `json:"approved_at,omitempty"`
	GeneratedAt            string  `json:"generated_at"`
	AsOfDate               string  `json:"as_of_date"`
	BenchmarkPeriodMonths  int     `json:"benchmark_period_months"`
	SourceMaxAgeDays       int     `json:"source_max_age_days"`
	BaselineTenderID       string  `json:"baseline_tender_id,omitempty"`
	BaselineVersion        int     `json:"baseline_version,omitempty"`
	CalculationSource      string  `json:"calculation_source"` // всегда "server"
	CachedGrandTotal       float64 `json:"cached_grand_total"`
	ReportFingerprint      string  `json:"report_fingerprint"`
}

// Fingerprint — стабильный отпечаток (§4): зависит от tender/revision/schema/
// параметров/baseline/as-of; НЕ зависит от generated_at/пагинации/UUID.
func Fingerprint(tenderID string, inputRev int64, schemaVersion, periodMonths, maxAgeDays int, baselineTenderID, asOfDate string) string {
	canonical := fmt.Sprintf("hubtender-review|t=%s|rev=%d|schema=%d|period=%d|maxage=%d|baseline=%s|asof=%s",
		tenderID, inputRev, schemaVersion, periodMonths, maxAgeDays, baselineTenderID, asOfDate)
	sum := sha256.Sum256([]byte(canonical))
	return hex.EncodeToString(sum[:])
}

// SectionStatus — состояние компонента отчёта.
type SectionStatus struct {
	Status string `json:"status"`
	Note   string `json:"note,omitempty"`
}

// ExecutiveSummary — сводка (§7): значения берутся ИЗ ГОТОВЫХ summary движков,
// ничего не пересчитывается и не усредняется в единый score.
type ExecutiveSummary struct {
	Headline string `json:"headline"` // «Расчёт готов к проверке» | «Обнаружены блокирующие проблемы» | «Требуются дополнительные проверки»

	Quality struct {
		Blockers                int     `json:"blockers"`
		Warnings                int     `json:"warnings"`
		Information             int     `json:"information"`
		CalculationCompleteness float64 `json:"calculation_completeness_percent"`
		ReviewCompleteness      float64 `json:"review_completeness_percent"`
		BoqItemsWithIssues      int     `json:"boq_items_with_issues"`
	} `json:"quality"`

	ActionPlan struct {
		Blocking              int      `json:"blocking_actions"`
		High                  int      `json:"high_actions"`
		Normal                int      `json:"normal_actions"`
		Low                   int      `json:"low_actions"`
		AffectedItems         int      `json:"affected_boq_items"`
		AmountRequiringReview *float64 `json:"amount_requiring_review"`
	} `json:"action_plan"`

	Benchmark struct {
		EligibleItems       int     `json:"eligible_items"`
		BenchmarkedItems    int     `json:"benchmarked_items"`
		HighOutliers        int     `json:"high_outliers"`
		LowOutliers         int     `json:"low_outliers"`
		InsufficientHistory int     `json:"insufficient_history"`
		WithinRange         int     `json:"within_range"`
		CoveragePercent     float64 `json:"coverage_percent"`
	} `json:"price_benchmark"`

	Source struct {
		CoveragePercent        float64  `json:"source_coverage_percent"`
		CurrentCoveragePercent float64  `json:"current_source_coverage_percent"`
		Stale                  int      `json:"stale_items"`
		Expired                int      `json:"expired_items"`
		MissingSource          int      `json:"missing_source_items"`
		MissingDate            int      `json:"missing_price_date_items"`
		Fresh                  int      `json:"fresh_items"`
		AmountRequiringReview  *float64 `json:"amount_requiring_review"`
	} `json:"price_source"`

	ChangeImpact struct {
		BaselineVersion int     `json:"baseline_version,omitempty"`
		GrandTotalDelta float64 `json:"grand_total_delta"`
		DirectDelta     float64 `json:"direct_total_delta"`
		MaterialDelta   float64 `json:"commercial_material_delta"`
		WorkDelta       float64 `json:"commercial_work_delta"`
		InsuranceDelta  float64 `json:"insurance_delta"`
		Added           int     `json:"items_added"`
		Removed         int     `json:"items_removed"`
		Modified        int     `json:"items_modified"`
		Reconciliation  string  `json:"reconciliation_status,omitempty"`
	} `json:"change_impact"`
}

// Model — immutable-модель отчёта: renderer читает ТОЛЬКО её.
type Model struct {
	Status   string   `json:"status"` // ready | calculation_not_ready
	Metadata Metadata `json:"metadata"`

	Sections struct {
		Quality      SectionStatus `json:"quality"`
		ActionPlan   SectionStatus `json:"action_plan"`
		Benchmark    SectionStatus `json:"price_benchmark"`
		Source       SectionStatus `json:"price_source"`
		ChangeImpact SectionStatus `json:"change_impact"`
	} `json:"components"`

	Executive ExecutiveSummary `json:"executive_summary"`

	// Готовые результаты движков (renderer их не модифицирует).
	Quality      *quality.Report `json:"-"`
	ActionPlan   *ap.Report      `json:"-"`
	Benchmark    *pb.Report      `json:"-"` // nil при no-data (гейт не пускает stale)
	Source       *ps.Report      `json:"-"`
	ChangeImpact *ci.Report      `json:"-"` // Status=BASELINE_NOT_AVAILABLE допустим
}

// Inputs — готовые результаты для сборки модели (никакой БД).
type Inputs struct {
	Metadata     Metadata
	Quality      *quality.Report
	ActionPlan   *ap.Report
	Benchmark    *pb.Report
	Source       *ps.Report
	ChangeImpact *ci.Report
}

// Build — чистая сборка модели: section statuses + executive summary из
// ГОТОВЫХ summary (§7). Ничего не пересчитывается.
func Build(in Inputs) *Model {
	m := &Model{Status: ReportReady, Metadata: in.Metadata}
	m.Metadata.ReportSchemaVersion = ReportSchemaVersion
	m.Metadata.CalculationSource = "server"
	m.Quality, m.ActionPlan, m.Benchmark, m.Source, m.ChangeImpact =
		in.Quality, in.ActionPlan, in.Benchmark, in.Source, in.ChangeImpact

	// Section statuses (§5): expected no-data — статус секции, не ошибка.
	m.Sections.Quality = statusOf(in.Quality != nil, "")
	m.Sections.ActionPlan = statusOf(in.ActionPlan != nil, "")
	if in.Benchmark != nil {
		m.Sections.Benchmark = SectionStatus{Status: SectionAvailable}
	} else {
		m.Sections.Benchmark = SectionStatus{Status: SectionNoData,
			Note: "Ценовые отклонения не рассчитаны для этой ревизии."}
	}
	m.Sections.Source = statusOf(in.Source != nil, "")
	switch {
	case in.ChangeImpact == nil:
		m.Sections.ChangeImpact = SectionStatus{Status: SectionUnavailable}
	case in.ChangeImpact.Status == ci.ReportBaselineNotAvailable:
		m.Sections.ChangeImpact = SectionStatus{Status: SectionBaselineNA,
			Note: "Предыдущая согласованная версия отсутствует."}
	default:
		m.Sections.ChangeImpact = SectionStatus{Status: SectionAvailable}
	}

	// Executive summary — только копирование готовых значений.
	e := &m.Executive
	if q := in.Quality; q != nil {
		e.Quality.Blockers = q.Summary.Blockers
		e.Quality.Warnings = q.Summary.Warnings
		e.Quality.Information = q.Summary.Information
		e.Quality.CalculationCompleteness = q.Summary.CalculationCompletenessPercent
		e.Quality.ReviewCompleteness = q.Summary.ReviewCompletenessPercent
		e.Quality.BoqItemsWithIssues = q.Summary.BoqItemsWithIssues
	}
	if a := in.ActionPlan; a != nil {
		e.ActionPlan.Blocking = a.Summary.BlockingActions
		e.ActionPlan.High = a.Summary.HighActions
		e.ActionPlan.Normal = a.Summary.NormalActions
		e.ActionPlan.Low = a.Summary.LowActions
		e.ActionPlan.AffectedItems = a.Summary.AffectedBoqItems
		e.ActionPlan.AmountRequiringReview = a.Summary.AmountRequiringReview
	}
	if b := in.Benchmark; b != nil {
		e.Benchmark.EligibleItems = b.Summary.EligibleItems
		e.Benchmark.BenchmarkedItems = b.Summary.BenchmarkedItems
		e.Benchmark.HighOutliers = b.Summary.HighOutliers
		e.Benchmark.LowOutliers = b.Summary.LowOutliers
		e.Benchmark.InsufficientHistory = b.Summary.InsufficientHistory
		e.Benchmark.WithinRange = b.Summary.WithinRange
		e.Benchmark.CoveragePercent = b.Summary.CoveragePercent
	}
	if s := in.Source; s != nil {
		e.Source.CoveragePercent = s.Summary.SourceCoveragePercent
		e.Source.CurrentCoveragePercent = s.Summary.CurrentSourceCoveragePercent
		e.Source.Stale = s.Summary.StaleItems
		e.Source.Expired = s.Summary.ExpiredItems
		e.Source.MissingSource = s.Summary.MissingSourceItems
		e.Source.MissingDate = s.Summary.MissingPriceDateItems
		e.Source.Fresh = s.Summary.FreshItems
		e.Source.AmountRequiringReview = s.Summary.AmountRequiringReview
	}
	if c := in.ChangeImpact; c != nil && c.Status != ci.ReportBaselineNotAvailable && c.Baseline != nil {
		e.ChangeImpact.BaselineVersion = c.Baseline.Version
		e.ChangeImpact.GrandTotalDelta = c.Summary.GrandTotalDelta
		e.ChangeImpact.DirectDelta = c.Summary.DirectTotalDelta
		e.ChangeImpact.MaterialDelta = c.Summary.CommercialMaterialDelta
		e.ChangeImpact.WorkDelta = c.Summary.CommercialWorkDelta
		e.ChangeImpact.InsuranceDelta = c.Summary.InsuranceDelta
		e.ChangeImpact.Added = c.Summary.ItemsAdded
		e.ChangeImpact.Removed = c.Summary.ItemsRemoved
		e.ChangeImpact.Modified = c.Summary.ItemsModified
		e.ChangeImpact.Reconciliation = c.Summary.ReconciliationStatus
	}

	// Headline (§7): без «тендер корректен» и без усреднённого score.
	switch {
	case e.Quality.Blockers > 0 || e.ActionPlan.Blocking > 0:
		e.Headline = "Обнаружены блокирующие проблемы"
	case e.ActionPlan.High > 0 || e.Benchmark.HighOutliers+e.Benchmark.LowOutliers > 0 ||
		e.Source.Stale+e.Source.Expired+e.Source.MissingSource > 0:
		e.Headline = "Требуются дополнительные проверки"
	default:
		e.Headline = "Расчёт готов к проверке"
	}
	return m
}

func statusOf(available bool, note string) SectionStatus {
	if available {
		return SectionStatus{Status: SectionAvailable}
	}
	return SectionStatus{Status: SectionUnavailable, Note: note}
}
