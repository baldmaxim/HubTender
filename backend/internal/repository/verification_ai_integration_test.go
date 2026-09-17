package repository

import (
	"context"
	"testing"

	"github.com/su10/hubtender/backend/internal/ai/triage"
	"github.com/su10/hubtender/backend/internal/quality"
)

// ИИ-разбор находок: отбор кандидатов, контекст позиции, оценки и совпадение с
// вердиктами инженера.
//
//	HUBTENDER_TEST_DATABASE_URL=… go test ./internal/repository/ -run VerificationAIIntegration -v

func activeCodes() []string {
	var out []string
	for _, r := range quality.Active() {
		out = append(out, r.Code)
	}
	return out
}

func TestVerificationAIIntegration_CandidatesContextAssessments(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	f := newVRFixture(t, pool)
	rep := vrRun(t, NewQualityRepo(pool), f.tenderID, RunTriggerView)
	repo := NewVerificationAIRepo(pool)
	const pv = triage.PromptVersion

	cands, err := repo.AICandidates(ctx, f.tenderID, activeCodes(), pv, 100)
	if err != nil {
		t.Fatal(err)
	}
	byEntity := map[string]triage.Finding{}
	for _, c := range cands {
		byEntity[c.RuleCode+"|"+c.EntityID] = c
		if c.PositionID == "" || c.Fingerprint == "" {
			t.Fatalf("кандидат без позиции или отпечатка: %+v", c)
		}
	}
	qa, ok := byEntity["QA|"+f.r2]
	u, ok2 := byEntity["U|"+f.p1]
	if !ok || !ok2 {
		t.Fatalf("ожидались кандидаты QA(r2) и U(p1): %+v", cands)
	}
	if qa.PositionID != f.p2 {
		t.Fatalf("позиция строки: %s", qa.PositionID)
	}

	ctxMap, err := repo.PositionsContext(ctx, f.tenderID, []string{f.p1, f.p2})
	if err != nil {
		t.Fatal(err)
	}
	p2 := ctxMap[f.p2]
	if p2 == nil || p2.GPVolume != "5" || len(p2.Rows) != 1 || p2.Rows[0].Quantity != "2" || p2.Rows[0].Type != "раб" {
		t.Fatalf("контекст позиции: %+v", p2)
	}
	if p2.Rows[0].Name == "" {
		t.Fatal("у строки нет наименования работы")
	}

	// Разбор сохранён: при тех же данных и промпте находка больше не кандидат.
	reqID, err := repo.SaveRequest(ctx, AIRequestRecord{
		TenderID: &f.tenderID, Trigger: "manual", Status: "completed", ModelID: "m", PromptVersion: pv,
		FindingsCount: 2, AssessedCount: 2, TotalTokens: 1500,
	})
	if err != nil {
		t.Fatal(err)
	}
	err = repo.SaveAssessments(ctx, f.tenderID, reqID, "m", pv,
		map[string]triage.Finding{qa.ID: qa, u.ID: u},
		[]triage.Assessment{
			{FindingID: qa.ID, Label: triage.LabelLikelyError, Reason: "работа без цены",
				Evidence: []triage.Evidence{{Ref: "r1.unit_rate", Value: "0"}}},
			{FindingID: u.ID, Label: triage.LabelLikelyOK, Reason: "норма"},
		})
	if err != nil {
		t.Fatal(err)
	}
	cands, _ = repo.AICandidates(ctx, f.tenderID, activeCodes(), pv, 100)
	for _, c := range cands {
		if c.ID == qa.ID || c.ID == u.ID {
			t.Fatal("разобранная находка снова попала в кандидаты")
		}
	}
	// Новая версия промпта — разбирать заново.
	cands, _ = repo.AICandidates(ctx, f.tenderID, activeCodes(), "finding-triage-v999", 100)
	var again bool
	for _, c := range cands {
		again = again || c.ID == qa.ID
	}
	if !again {
		t.Fatal("после смены версии промпта находка должна разбираться заново")
	}

	list, err := repo.ListAssessments(ctx, f.tenderID, pv)
	if err != nil || len(list) != 2 {
		t.Fatalf("оценки тендера: %+v %v", list, err)
	}
	for _, v := range list {
		if !v.Current {
			t.Fatalf("оценка при неизменных данных должна быть текущей: %+v", v)
		}
		if v.FindingID == qa.ID && (len(v.Evidence) != 1 || v.Evidence[0].Ref != "r1.unit_rate") {
			t.Fatalf("доказательства не сохранились: %+v", v)
		}
	}

	// Вердикт инженера: QA — ошибка (ИИ согласен), U — ошибка (ИИ сказал норма).
	qualityRepo := NewQualityRepo(pool)
	qf := findFinding(rep, "QA", f.r2)
	uf := findFinding(rep, "U", f.p1)
	if err := qualityRepo.SetVerdict(ctx, f.tenderID, "QA", f.r2, qf.Fingerprint, "error", nil, nil); err != nil {
		t.Fatal(err)
	}
	if err := qualityRepo.SetVerdict(ctx, f.tenderID, "U", f.p1, uf.Fingerprint, "error", nil, nil); err != nil {
		t.Fatal(err)
	}
	agr, err := repo.Agreement(ctx)
	if err != nil || agr.ErrorAgreed < 1 || agr.OKMissed < 1 {
		t.Fatalf("совпадение с инженером: %+v %v", agr, err)
	}
	// С вердиктом находка не кандидат даже при новой версии промпта.
	cands, _ = repo.AICandidates(ctx, f.tenderID, activeCodes(), "finding-triage-v999", 100)
	for _, c := range cands {
		if c.ID == qa.ID {
			t.Fatal("находка с вердиктом инженера отдана модели")
		}
	}

	// Настройки: включить без проверенной модели нельзя.
	st, err := repo.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	model := "vendor/model"
	st.ModelID, st.Enabled = &model, true
	if err := repo.SaveSettings(ctx, *st, nil); err != ErrAISettingsInvalid {
		t.Fatalf("включение без проверки: %v", err)
	}
	if err := repo.RecordTest(ctx, model, true, nil, 1200); err != nil {
		t.Fatal(err)
	}
	if err := repo.SaveSettings(ctx, *st, nil); err != nil {
		t.Fatalf("включение после проверки: %v", err)
	}
	if err := repo.RecordTest(ctx, model, false, nil, 10); err != nil {
		t.Fatal(err)
	}
	if st2, _ := repo.GetSettings(ctx); st2.Enabled {
		t.Fatal("проваленная проверка должна выключать разбор")
	}
	st.Enabled = false
	st.ModelID = nil
	_ = repo.SaveSettings(ctx, *st, nil)

	usage, err := repo.Usage(ctx)
	if err != nil || usage.MonthTokens < 1500 || usage.TodayRequests < 1 {
		t.Fatalf("расход: %+v %v", usage, err)
	}
}
