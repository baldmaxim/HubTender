package services

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"testing"

	"github.com/rs/zerolog"

	"github.com/su10/hubtender/backend/internal/ai/openrouter"
	"github.com/su10/hubtender/backend/internal/ai/triage"
	"github.com/su10/hubtender/backend/internal/repository"
)

type fakeAIClient struct {
	mu       sync.Mutex
	calls    []openrouter.ChatRequest
	fail     error
	label    string
	evidence string
}

func (c *fakeAIClient) Configured() bool                { return true }
func (c *fakeAIClient) Transport() openrouter.Transport { return openrouter.TransportOpenRouter }

var findingRefRe = regexp.MustCompile(`"ref":"(f\d+)"`)

func (c *fakeAIClient) CreateChatCompletion(_ context.Context, req openrouter.ChatRequest) (openrouter.ChatResponse, error) {
	c.mu.Lock()
	c.calls = append(c.calls, req)
	c.mu.Unlock()
	if c.fail != nil {
		return openrouter.ChatResponse{}, c.fail
	}
	var items []string
	for _, m := range findingRefRe.FindAllStringSubmatch(req.Messages[1].Content, -1) {
		items = append(items, fmt.Sprintf(`{"finding":%q,"label":%q,"reason":"проверено","evidence":[%s]}`,
			m[1], c.label, c.evidence))
	}
	return openrouter.ChatResponse{
		Content: `{"assessments":[` + strings.Join(items, ",") + `]}`,
		Usage:   openrouter.Usage{PromptTokens: 900, CompletionTokens: 100, TotalTokens: 1000, Cost: "0.001"},
	}, nil
}

type fakeAIRepo struct {
	settings    repository.VerificationAISettings
	usage       repository.AIUsage
	candidates  []triage.Finding
	positions   map[string]*triage.Position
	requests    []repository.AIRequestRecord
	assessments []triage.Assessment
	tests       []bool
}

func (r *fakeAIRepo) GetSettings(context.Context) (*repository.VerificationAISettings, error) {
	s := r.settings
	return &s, nil
}
func (r *fakeAIRepo) SaveSettings(_ context.Context, s repository.VerificationAISettings, _ *string) error {
	r.settings = s
	return nil
}
func (r *fakeAIRepo) RecordTest(_ context.Context, _ string, passed bool, _ *string, _ int) error {
	r.tests = append(r.tests, passed)
	return nil
}
func (r *fakeAIRepo) Usage(context.Context) (*repository.AIUsage, error) {
	u := r.usage
	u.TodayRequests += len(r.requests)
	return &u, nil
}
func (r *fakeAIRepo) SaveRequest(_ context.Context, rec repository.AIRequestRecord) (string, error) {
	r.requests = append(r.requests, rec)
	return fmt.Sprintf("req-%d", len(r.requests)), nil
}
func (r *fakeAIRepo) AICandidates(_ context.Context, _ string, _ []string, _ string, limit int) ([]triage.Finding, error) {
	if len(r.candidates) > limit {
		return r.candidates[:limit], nil
	}
	return r.candidates, nil
}
func (r *fakeAIRepo) PositionsContext(context.Context, string, []string) (map[string]*triage.Position, error) {
	return r.positions, nil
}
func (r *fakeAIRepo) SaveAssessments(_ context.Context, _, _, _, _ string, _ map[string]triage.Finding, a []triage.Assessment) error {
	r.assessments = append(r.assessments, a...)
	return nil
}
func (r *fakeAIRepo) ListAssessments(context.Context, string, string) ([]repository.AIAssessmentView, error) {
	return nil, nil
}
func (r *fakeAIRepo) Agreement(context.Context) (*repository.AIAgreement, error) {
	return &repository.AIAgreement{}, nil
}

func newAIFixture(findingsPerPosition ...int) (*VerificationAIService, *fakeAIRepo, *fakeAIClient) {
	model := "test/model"
	repo := &fakeAIRepo{
		settings: repository.VerificationAISettings{
			Enabled: true, ModelID: &model, MaxFindingsPerRun: 200, BatchSize: 3, MaxOutputTokens: 2000,
			RequestTimeoutSeconds: 30, MonthlyTokenBudget: 1_000_000, DailyRequestLimit: 100,
		},
		positions: map[string]*triage.Position{},
	}
	for p, n := range findingsPerPosition {
		posID := fmt.Sprintf("pos-%d", p)
		repo.positions[posID] = &triage.Position{ID: posID, CustomerName: "Позиция", Rows: []triage.Row{
			{ID: "row-" + posID, Type: "мат", Name: "Материал", Quantity: "10"},
		}}
		for i := 0; i < n; i++ {
			repo.candidates = append(repo.candidates, triage.Finding{
				ID: fmt.Sprintf("f-%d-%d", p, i), RuleCode: "GA", EntityType: "boq_item",
				EntityID: "row-" + posID, PositionID: posID, Fingerprint: "fp",
			})
		}
	}
	client := &fakeAIClient{label: triage.LabelLikelyOK, evidence: `{"ref":"r1.quantity","value":"10"}`}
	svc := NewVerificationAIService(context.Background(), repo, client, zerolog.Nop())
	return svc, repo, client
}

func TestVerificationAIRunBatchesPerPosition(t *testing.T) {
	svc, repo, client := newAIFixture(4, 2)
	if err := svc.RunTender(context.Background(), "t1", "auto", nil); err != nil {
		t.Fatal(err)
	}
	// Позиция 0: 4 находки при batch_size 3 → 2 запроса; позиция 1 → 1 запрос.
	if len(client.calls) != 3 || len(repo.requests) != 3 {
		t.Fatalf("запросов %d / %d", len(client.calls), len(repo.requests))
	}
	if len(repo.assessments) != 6 {
		t.Fatalf("оценок %d", len(repo.assessments))
	}
	for _, a := range repo.assessments {
		if a.Label != triage.LabelLikelyOK || len(a.Evidence) != 1 {
			t.Fatalf("оценка: %+v", a)
		}
	}
	req := client.calls[0]
	if req.ResponseFormat == nil || !req.ResponseFormat.JSONSchema.Strict || req.IdempotencyKey == "" {
		t.Fatal("запрос без строгой схемы или ключа идемпотентности")
	}
	if strings.Contains(req.Messages[1].Content, "f-0-0") || strings.Contains(req.Messages[1].Content, "pos-0") {
		t.Fatal("внутренние id ушли модели")
	}
}

func TestVerificationAIRespectsDisabledAndPilot(t *testing.T) {
	svc, repo, client := newAIFixture(2)
	repo.settings.Enabled = false
	_ = svc.RunTender(context.Background(), "t1", "auto", nil)
	repo.settings.Enabled = true
	repo.settings.AllowedTenderIDs = []string{"other"}
	_ = svc.RunTender(context.Background(), "t1", "auto", nil)
	if len(client.calls) != 0 {
		t.Fatal("выключенный разбор или тендер вне пилота вызвал модель")
	}
}

func TestVerificationAIStopsOnBudget(t *testing.T) {
	svc, repo, client := newAIFixture(3, 3, 3)
	repo.settings.DailyRequestLimit = 2
	_ = svc.RunTender(context.Background(), "t1", "auto", nil)
	if len(client.calls) != 2 {
		t.Fatalf("лимит в 2 запроса в сутки, сделано %d", len(client.calls))
	}
	svc2, repo2, client2 := newAIFixture(3)
	repo2.usage.MonthTokens = repo2.settings.MonthlyTokenBudget
	_ = svc2.RunTender(context.Background(), "t1", "auto", nil)
	if len(client2.calls) != 0 {
		t.Fatal("исчерпанный бюджет токенов не остановил разбор")
	}
}

func TestVerificationAIPausesAfterFailures(t *testing.T) {
	svc, repo, client := newAIFixture(1, 1, 1, 1, 1)
	client.fail = openrouter.ErrUnavailable
	_ = svc.RunTender(context.Background(), "t1", "auto", nil)
	if len(client.calls) != aiCircuitThreshold {
		t.Fatalf("после %d сбоев подряд — пауза, сделано %d запросов", aiCircuitThreshold, len(client.calls))
	}
	if len(repo.assessments) != 0 || repo.requests[0].Status != "failed" || repo.requests[0].ErrorCode == nil {
		t.Fatalf("сбой не записан как failed: %+v", repo.requests[0])
	}
	client.fail = nil
	_ = svc.RunTender(context.Background(), "t1", "auto", nil)
	if len(client.calls) != aiCircuitThreshold {
		t.Fatal("во время паузы разбор не должен вызывать модель")
	}
}

func TestVerificationAIInvalidResponse(t *testing.T) {
	svc, repo, client := newAIFixture(1)
	client.label = "likely_ok"
	client.evidence = `{"ref":"r1.quantity","value":"999"}`
	_ = svc.RunTender(context.Background(), "t1", "auto", nil)
	if len(repo.assessments) != 1 || repo.assessments[0].Label != triage.LabelUnsure || !repo.assessments[0].Downgraded {
		t.Fatalf("вывод с неверной ссылкой должен сохраниться как «не уверен»: %+v", repo.assessments)
	}
}

func TestVerificationAITestModel(t *testing.T) {
	svc, repo, client := newAIFixture()
	client.evidence = `{"ref":"r2.conversion_coefficient","value":"0.05"}`
	res, err := svc.TestModel(context.Background(), nil)
	if err != nil || !res.Passed || len(repo.tests) != 1 || !repo.tests[0] {
		t.Fatalf("проверка модели: %+v %v", res, err)
	}
	client.label = triage.LabelLikelyError
	res, _ = svc.TestModel(context.Background(), nil)
	if res.Passed || res.Error != "wrong_label" || repo.tests[1] {
		t.Fatalf("модель, назвавшая слои дублем, не должна проходить: %+v", res)
	}
	if repo.requests[0].Trigger != "test" {
		t.Fatal("запрос проверки не помечен как test")
	}
}

func TestVerificationAIEnableRequiresPassedTest(t *testing.T) {
	svc, repo, _ := newAIFixture()
	repo.settings.Enabled = false
	other := "other/model"
	in := repo.settings
	in.Enabled = true
	in.ModelID = &other
	passed := "passed"
	repo.settings.LastTestStatus = &passed
	model := "test/model"
	repo.settings.LastTestModelID = &model
	if _, err := svc.SaveSettings(context.Background(), in, nil); !errors.Is(err, ErrAITriageNotTested) {
		t.Fatalf("включение непроверенной модели: %v", err)
	}
	in.ModelID = &model
	if _, err := svc.SaveSettings(context.Background(), in, nil); err != nil {
		t.Fatalf("включение проверенной модели: %v", err)
	}
}
