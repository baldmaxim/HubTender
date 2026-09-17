package services

import (
	"context"

	"github.com/su10/hubtender/backend/internal/ai/triage"
	"github.com/su10/hubtender/backend/internal/quality"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Итоги запуска ИИ-разбора по тендеру.
const (
	AITriageStarted        = "started"
	AITriageAlreadyRunning = "already_running"
	AITriageDisabled       = "disabled"
	AITriageTenderExcluded = "tender_not_in_pilot"
	AITriageNotConfigured  = "not_configured"
)

// RecalcTender реализует Recalculator: фоновый разбор после автоматической проверки.
func (s *VerificationAIService) RecalcTender(ctx context.Context, tenderID string) error {
	return s.RunTender(ctx, tenderID, "auto", nil)
}

// Availability — можно ли разбирать этот тендер сейчас (для кнопки на странице).
func (s *VerificationAIService) Availability(ctx context.Context, tenderID string) (string, error) {
	st, err := s.repo.GetSettings(ctx)
	if err != nil {
		return "", err
	}
	switch {
	case !st.Enabled || st.ModelID == nil:
		return AITriageDisabled, nil
	case !st.AllowsTender(tenderID):
		return AITriageTenderExcluded, nil
	case !s.client.Configured():
		return AITriageNotConfigured, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running[tenderID] {
		return AITriageAlreadyRunning, nil
	}
	return AITriageStarted, nil
}

// StartManual запускает разбор в фоне по кнопке. Возвращает итог запуска.
func (s *VerificationAIService) StartManual(ctx context.Context, tenderID string, actor *string) (string, error) {
	status, err := s.Availability(ctx, tenderID)
	if err != nil || status != AITriageStarted {
		return status, err
	}
	go func() {
		if err := s.RunTender(s.rootCtx, tenderID, "manual", actor); err != nil && s.rootCtx.Err() == nil {
			s.logger.Warn().Err(err).Str("tender_id", tenderID).Msg("verification ai triage failed")
		}
	}()
	return AITriageStarted, nil
}

func activeRuleCodes() []string {
	active := quality.Active()
	codes := make([]string, len(active))
	for i, r := range active {
		codes[i] = r.Code
	}
	return codes
}

// RunTender разбирает новые находки тендера: пакетами по позиции, пока хватает
// бюджета и модель отвечает. Выключенный разбор, тендер вне пилота и уже идущий
// разбор — не ошибка.
func (s *VerificationAIService) RunTender(ctx context.Context, tenderID, trigger string, actor *string) error {
	st, err := s.repo.GetSettings(ctx)
	if err != nil {
		return err
	}
	if !st.Enabled || st.ModelID == nil || !st.AllowsTender(tenderID) || !s.client.Configured() {
		return nil
	}
	s.mu.Lock()
	if s.running[tenderID] {
		s.mu.Unlock()
		return nil
	}
	s.running[tenderID] = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.running, tenderID)
		s.mu.Unlock()
	}()

	candidates, err := s.repo.AICandidates(ctx, tenderID, activeRuleCodes(), triage.PromptVersion, st.MaxFindingsPerRun)
	if err != nil || len(candidates) == 0 {
		return err
	}

	// Пакеты: находки одной позиции, не больше batch_size за запрос.
	order := []string{}
	byPos := map[string][]triage.Finding{}
	for _, f := range candidates {
		if r, ok := quality.ByCode(f.RuleCode); ok {
			f.RuleTitle, f.RuleSummary = r.Title, r.Summary
		}
		if _, seen := byPos[f.PositionID]; !seen {
			order = append(order, f.PositionID)
		}
		byPos[f.PositionID] = append(byPos[f.PositionID], f)
	}
	positions, err := s.repo.PositionsContext(ctx, tenderID, order)
	if err != nil {
		return err
	}

	for _, posID := range order {
		pos, ok := positions[posID]
		if !ok {
			continue
		}
		findings := byPos[posID]
		for start := 0; start < len(findings); start += st.BatchSize {
			end := min(start+st.BatchSize, len(findings))
			stop, err := s.runBatch(ctx, st, tenderID, trigger, actor, triage.Batch{Position: *pos, Findings: findings[start:end]})
			if err != nil || stop {
				return err
			}
		}
	}
	return nil
}

// runBatch — один запрос. stop = дальше не идти (бюджет, пауза, отмена).
func (s *VerificationAIService) runBatch(
	ctx context.Context, st *repository.VerificationAISettings, tenderID, trigger string, actor *string, b triage.Batch,
) (bool, error) {
	if ctx.Err() != nil {
		return true, ctx.Err()
	}
	if s.paused() {
		return true, nil
	}
	usage, err := s.repo.Usage(ctx)
	if err != nil {
		return true, err
	}
	if usage.MonthTokens >= st.MonthlyTokenBudget || usage.TodayRequests >= st.DailyRequestLimit {
		s.logger.Warn().Str("tender_id", tenderID).Int64("month_tokens", usage.MonthTokens).
			Int("today_requests", usage.TodayRequests).Msg("verification ai: лимит расхода исчерпан")
		return true, nil
	}
	p, err := triage.Prepare(b)
	if err != nil {
		return false, nil
	}

	res := s.call(ctx, st, p, len(b.Findings))
	if ctx.Err() != nil {
		return true, ctx.Err()
	}
	res.record.TenderID, res.record.Trigger, res.record.CreatedBy = &tenderID, trigger, actor
	requestID, err := s.repo.SaveRequest(ctx, res.record)
	if err != nil {
		return true, err
	}
	s.noteOutcome(res.record.Status == "completed")
	if res.record.Status != "completed" {
		return false, nil
	}
	byID := make(map[string]triage.Finding, len(b.Findings))
	for _, f := range b.Findings {
		byID[f.ID] = f
	}
	if err := s.repo.SaveAssessments(ctx, tenderID, requestID, *st.ModelID, triage.PromptVersion, byID, res.assessments); err != nil {
		return true, err
	}
	return false, nil
}

// TenderAssessments — оценки для страницы и итог доступности разбора.
type TenderAssessments struct {
	Availability string                        `json:"availability"`
	Running      bool                          `json:"running"`
	Assessments  []repository.AIAssessmentView `json:"assessments"`
}

func (s *VerificationAIService) Assessments(ctx context.Context, tenderID string) (*TenderAssessments, error) {
	avail, err := s.Availability(ctx, tenderID)
	if err != nil {
		return nil, err
	}
	list, err := s.repo.ListAssessments(ctx, tenderID, triage.PromptVersion)
	if err != nil {
		return nil, err
	}
	return &TenderAssessments{Availability: avail, Running: avail == AITriageAlreadyRunning, Assessments: list}, nil
}

// AITestResult — итог проверки модели.
type AITestResult struct {
	Passed    bool              `json:"passed"`
	Label     string            `json:"label"`
	Reason    string            `json:"reason"`
	Evidence  []triage.Evidence `json:"evidence"`
	Error     string            `json:"error,omitempty"`
	LatencyMs int               `json:"latency_ms"`
	Tokens    int               `json:"tokens"`
}

// testBatch — случай из разбора «Большой Татарской»: утеплитель одной марки двумя
// строками с коэффициентами 0.05 и 0.1 при толщине 150 мм — норма, а не дубль.
func testBatch() triage.Batch {
	return triage.Batch{
		Position: triage.Position{
			ID: "test-position", ItemNo: "16.3",
			CustomerName: "Утепление наружных стен минераловатной плитой ТЕХНОФАС ОПТИМА на клею с дюбелями, толщина 150 мм",
			Unit:         "м2", CustomerVolume: "102.61", GPVolume: "102.61",
			Rows: []triage.Row{
				{ID: "w", Type: "раб", Name: "Монтаж утеплителя на клей с дюбелями", Unit: "м2", Quantity: "102.61", UnitRate: "950", Currency: "RUB", Total: "97479.5"},
				{ID: "m1", Type: "мат", Name: "ТЕХНОФАС ОПТИМА", Unit: "м3", Quantity: "5.900075", ConversionCoefficient: "0.05",
					ConsumptionCoefficient: "1.15", UnitRate: "9068", Currency: "RUB", Total: "53501.88", ParentWorkID: "w"},
				{ID: "m2", Type: "мат", Name: "ТЕХНОФАС ОПТИМА", Unit: "м3", Quantity: "11.80015", ConversionCoefficient: "0.1",
					ConsumptionCoefficient: "1.15", UnitRate: "9068", Currency: "RUB", Total: "107003.76", ParentWorkID: "w"},
			},
		},
		Findings: []triage.Finding{{
			ID: "test-finding", RuleCode: "GA", RuleTitle: "Дубль материала при той же работе, категории затрат и цене",
			Detail:     "Материал ТЕХНОФАС ОПТИМА заведён 2 раз с одной привязкой и ценой 9068.00 ₽; суммарно 160505.64 ₽",
			EntityType: "boq_item", EntityID: "m1",
		}},
	}
}

// TestModel проверяет выбранную модель на известном случае. Пройдена, если ответ по
// схеме и модель признала два слоя нормой со ссылками на данные.
func (s *VerificationAIService) TestModel(ctx context.Context, actor *string) (*AITestResult, error) {
	if !s.client.Configured() {
		return nil, ErrAITriageNotConfigured
	}
	st, err := s.repo.GetSettings(ctx)
	if err != nil {
		return nil, err
	}
	if st.ModelID == nil {
		return nil, ErrAITriageModelRequired
	}
	p, err := triage.Prepare(testBatch())
	if err != nil {
		return nil, err
	}
	res := s.call(ctx, st, p, 1)
	res.record.Trigger, res.record.CreatedBy = "test", actor
	if _, err := s.repo.SaveRequest(ctx, res.record); err != nil {
		return nil, err
	}
	out := &AITestResult{LatencyMs: res.record.LatencyMs, Tokens: res.record.TotalTokens}
	switch {
	case res.record.Status != "completed":
		out.Error = *res.record.ErrorCode
	case len(res.assessments) == 0 || res.missing > 0:
		out.Error = "no_assessment"
	default:
		a := res.assessments[0]
		out.Label, out.Reason, out.Evidence = a.Label, a.Reason, a.Evidence
		out.Passed = a.Label == triage.LabelLikelyOK
		if !out.Passed {
			out.Error = "wrong_label"
		}
	}
	var errText *string
	if out.Error != "" {
		errText = &out.Error
	}
	if err := s.repo.RecordTest(ctx, *st.ModelID, out.Passed, errText, out.LatencyMs); err != nil {
		return nil, err
	}
	return out, nil
}
