package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"

	"github.com/su10/hubtender/backend/internal/ai/openrouter"
	"github.com/su10/hubtender/backend/internal/ai/triage"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Ошибки настроек ИИ-разбора.
var (
	ErrAITriageNotConfigured = errors.New("verification ai: подключение к модели не настроено")
	ErrAITriageModelRequired = errors.New("verification ai: не указана модель")
	ErrAITriageNotTested     = errors.New("verification ai: модель не прошла проверку")
)

type aiChatClient interface {
	CreateChatCompletion(ctx context.Context, req openrouter.ChatRequest) (openrouter.ChatResponse, error)
	Configured() bool
	Transport() openrouter.Transport
}

type verificationAIRepoer interface {
	GetSettings(ctx context.Context) (*repository.VerificationAISettings, error)
	SaveSettings(ctx context.Context, s repository.VerificationAISettings, actor *string) error
	RecordTest(ctx context.Context, modelID string, passed bool, errText *string, latencyMs int) error
	Usage(ctx context.Context) (*repository.AIUsage, error)
	SaveRequest(ctx context.Context, rec repository.AIRequestRecord) (string, error)
	AICandidates(ctx context.Context, tenderID string, activeRules []string, promptVersion string, limit int) ([]triage.Finding, error)
	PositionsContext(ctx context.Context, tenderID string, positionIDs []string) (map[string]*triage.Position, error)
	SaveAssessments(ctx context.Context, tenderID, requestID, modelID, promptVersion string,
		findings map[string]triage.Finding, assessments []triage.Assessment) error
	ListAssessments(ctx context.Context, tenderID, promptVersion string) ([]repository.AIAssessmentView, error)
	Agreement(ctx context.Context) (*repository.AIAgreement, error)
}

// VerificationAIService — ИИ-разбор находок проверки данных. Оценка — подсказка
// проверяющему: вердикты сервис не ставит.
type VerificationAIService struct {
	repo    verificationAIRepoer
	client  aiChatClient
	logger  zerolog.Logger
	rootCtx context.Context

	mu          sync.Mutex
	running     map[string]bool
	failures    int
	pausedUntil time.Time
	now         func() time.Time
}

func NewVerificationAIService(rootCtx context.Context, repo verificationAIRepoer, client aiChatClient, logger zerolog.Logger) *VerificationAIService {
	return &VerificationAIService{
		repo: repo, client: client, logger: logger, rootCtx: rootCtx,
		running: map[string]bool{}, now: time.Now,
	}
}

// Пауза после серии сбоев модели: не жечь бюджет и не заваливать провайдера.
const (
	aiCircuitThreshold = 3
	aiCircuitPause     = 15 * time.Minute
)

// VerificationVerificationAISettingsView — настройки с расходом и совпадением с инженерами.
type VerificationAISettingsView struct {
	repository.VerificationAISettings
	Configured    bool                    `json:"configured"`
	Transport     string                  `json:"transport"`
	PromptVersion string                  `json:"prompt_version"`
	Usage         *repository.AIUsage     `json:"usage"`
	Agreement     *repository.AIAgreement `json:"agreement"`
	PausedUntil   *time.Time              `json:"paused_until"`
}

func (s *VerificationAIService) Settings(ctx context.Context) (*VerificationAISettingsView, error) {
	st, err := s.repo.GetSettings(ctx)
	if err != nil {
		return nil, err
	}
	usage, err := s.repo.Usage(ctx)
	if err != nil {
		return nil, err
	}
	agreement, err := s.repo.Agreement(ctx)
	if err != nil {
		return nil, err
	}
	v := &VerificationAISettingsView{
		VerificationAISettings: *st, Configured: s.client.Configured(), Transport: string(s.client.Transport()),
		PromptVersion: triage.PromptVersion, Usage: usage, Agreement: agreement,
	}
	s.mu.Lock()
	if s.pausedUntil.After(s.now()) {
		p := s.pausedUntil
		v.PausedUntil = &p
	}
	s.mu.Unlock()
	return v, nil
}

// SaveSettings сохраняет настройки. Включить можно только проверенную модель.
func (s *VerificationAIService) SaveSettings(ctx context.Context, in repository.VerificationAISettings, actor *string) (*VerificationAISettingsView, error) {
	if in.ModelID != nil {
		m := strings.TrimSpace(*in.ModelID)
		if m == "" {
			in.ModelID = nil
		} else {
			in.ModelID = &m
		}
	}
	if in.Enabled {
		cur, err := s.repo.GetSettings(ctx)
		if err != nil {
			return nil, err
		}
		switch {
		case in.ModelID == nil:
			return nil, ErrAITriageModelRequired
		case cur.LastTestStatus == nil || *cur.LastTestStatus != "passed" ||
			cur.LastTestModelID == nil || *cur.LastTestModelID != *in.ModelID:
			return nil, ErrAITriageNotTested
		}
	}
	if err := s.repo.SaveSettings(ctx, in, actor); err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.failures, s.pausedUntil = 0, time.Time{}
	s.mu.Unlock()
	return s.Settings(ctx)
}

// callResult — разобранный ответ модели на пакет.
type callResult struct {
	assessments []triage.Assessment
	missing     int
	record      repository.AIRequestRecord
}

// call отправляет пакет модели и проверяет ответ. Ошибка сети/провайдера и ответ
// не по схеме — в record.Status и record.ErrorCode; err — только для отмены.
func (s *VerificationAIService) call(ctx context.Context, st *repository.VerificationAISettings, p *triage.Prepared, findings int) callResult {
	model := *st.ModelID
	sum := sha256.Sum256(append([]byte(model+"|"+triage.PromptVersion+"|"), p.JSON...))
	temp := 0.0
	req := openrouter.ChatRequest{
		Model: model,
		Messages: []openrouter.ChatMessage{
			{Role: "system", Content: triage.SystemInstruction},
			{Role: "user", Content: triage.UserMessage(p)},
		},
		MaxTokens:   st.MaxOutputTokens,
		Temperature: &temp,
		ResponseFormat: &openrouter.ResponseFormat{
			Type:       "json_schema",
			JSONSchema: openrouter.JSONSchemaSpec{Name: triage.SchemaName, Strict: true, Schema: triage.ResponseSchema},
		},
		IdempotencyKey: "hub-triage." + hex.EncodeToString(sum[:])[:40],
	}
	if s.client.Transport() != openrouter.TransportProxyLLM {
		requireParams := true
		req.Provider = &openrouter.ProviderPrefs{DataCollection: "deny", RequireParameters: &requireParams}
	}

	res := callResult{record: repository.AIRequestRecord{
		Status: "completed", ModelID: model, PromptVersion: triage.PromptVersion, FindingsCount: findings,
	}}
	callCtx, cancel := context.WithTimeout(ctx, time.Duration(st.RequestTimeoutSeconds)*time.Second)
	defer cancel()
	started := s.now()
	resp, err := s.client.CreateChatCompletion(callCtx, req)
	res.record.LatencyMs = int(s.now().Sub(started).Milliseconds())
	if err != nil {
		code := openrouter.StatusCode(err)
		if code == "" {
			code = "provider_error"
		}
		res.record.Status, res.record.ErrorCode = "failed", &code
		return res
	}
	res.record.PromptTokens = resp.Usage.PromptTokens
	res.record.CompletionTokens = resp.Usage.CompletionTokens
	res.record.TotalTokens = resp.Usage.TotalTokens
	if c := resp.Usage.Cost.String(); c != "" {
		res.record.Cost = &c
	}
	assessments, missing, verr := triage.Validate(resp.Content, p)
	if verr != nil {
		code := "invalid_response"
		res.record.Status, res.record.ErrorCode = "invalid", &code
		return res
	}
	res.assessments, res.missing = assessments, missing
	res.record.AssessedCount = len(assessments) - missing
	return res
}

// noteOutcome ведёт счётчик сбоев подряд; после порога — пауза.
func (s *VerificationAIService) noteOutcome(ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ok {
		s.failures = 0
		return
	}
	s.failures++
	if s.failures >= aiCircuitThreshold {
		s.pausedUntil = s.now().Add(aiCircuitPause)
		s.failures = 0
	}
}

func (s *VerificationAIService) paused() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.pausedUntil.After(s.now())
}
