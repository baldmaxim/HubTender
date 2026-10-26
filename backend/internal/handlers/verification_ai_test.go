package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
)

const (
	extTenderID  = "22222222-2222-2222-2222-222222222222"
	extFindingID = "33333333-3333-3333-3333-333333333333"
)

type fakeVerifAISvc struct {
	verificationAIServicer
	res   *services.ExternalAssessmentsResult
	err   error
	calls int
	items []services.ExternalAssessment
	model string
}

func (f *fakeVerifAISvc) SaveExternalAssessments(_ context.Context, _, modelID, _ string,
	items []services.ExternalAssessment) (*services.ExternalAssessmentsResult, error) {
	f.calls++
	f.items, f.model = items, modelID
	return f.res, f.err
}

type fakeNotifier struct {
	tenders []string
	err     error
}

func (f *fakeNotifier) NotifyVerificationUpdated(_ context.Context, tenderID string) error {
	f.tenders = append(f.tenders, tenderID)
	return f.err
}

func extItem() string {
	return fmt.Sprintf(`{"finding_id":%q,"fingerprint":"fp","label":"likely_ok","reason":"норма","evidence":[{"ref":"r1.quantity","value":"10"}]}`, extFindingID)
}

func extBody(model, prompt string, items ...string) string {
	return fmt.Sprintf(`{"model_id":%q,"prompt_version":%q,"items":[%s]}`, model, prompt, strings.Join(items, ","))
}

func postExternal(t *testing.T, h *VerificationAIHandler, body string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	h.PostExternalAssessments(w, authedTenderReq(t, http.MethodPost, "/x", body))
	return w
}

func TestPostExternalAssessmentsValidation(t *testing.T) {
	longReason := strings.Repeat("я", 5000)
	manyItems := make([]string, 2001)
	for i := range manyItems {
		manyItems[i] = extItem()
	}
	cases := []struct {
		name string
		body string
	}{
		{"битый json", `{`},
		{"пустые items", extBody("m", "ext:v1")},
		{"больше 2000 items", extBody("m", "ext:v1", manyItems...)},
		{"prompt_version без ext:", extBody("m", "v1", extItem())},
		{"prompt_version длиннее 100", extBody("m", "ext:"+strings.Repeat("a", 100), extItem())},
		{"пустой model_id", extBody("  ", "ext:v1", extItem())},
		{"model_id длиннее 200", extBody(strings.Repeat("m", 201), "ext:v1", extItem())},
		{"нет finding_id", extBody("m", "ext:v1", `{"fingerprint":"fp","label":"likely_ok"}`)},
		{"нет fingerprint", extBody("m", "ext:v1", fmt.Sprintf(`{"finding_id":%q,"label":"likely_ok"}`, extFindingID))},
		{"finding_id не uuid", extBody("m", "ext:v1", `{"finding_id":"abc","fingerprint":"fp","label":"likely_ok"}`)},
		{"плохой label", extBody("m", "ext:v1", fmt.Sprintf(`{"finding_id":%q,"fingerprint":"fp","label":"maybe"}`, extFindingID))},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			svc := &fakeVerifAISvc{res: &services.ExternalAssessmentsResult{}}
			n := &fakeNotifier{}
			w := postExternal(t, NewVerificationAIHandler(svc, n), c.body)
			if w.Code != http.StatusBadRequest || svc.calls != 0 || len(n.tenders) != 0 {
				t.Fatalf("status %d, вызовов сервиса %d: %s", w.Code, svc.calls, w.Body.String())
			}
		})
	}

	t.Run("обрезка reason и evidence", func(t *testing.T) {
		ev := strings.TrimSuffix(strings.Repeat(`{"ref":"r","value":"1"},`, 12), ",")
		item := fmt.Sprintf(`{"finding_id":%q,"fingerprint":"fp","label":"unsure","reason":%q,"evidence":[%s]}`,
			strings.ToUpper(extFindingID), longReason, ev)
		noEv := fmt.Sprintf(`{"finding_id":%q,"fingerprint":"fp","label":"unsure"}`, extFindingID)
		svc := &fakeVerifAISvc{res: &services.ExternalAssessmentsResult{Saved: 2}}
		w := postExternal(t, NewVerificationAIHandler(svc, &fakeNotifier{}), extBody("m", "ext:v1", item, noEv))
		if w.Code != http.StatusOK || len(svc.items) != 2 {
			t.Fatalf("status %d: %s", w.Code, w.Body.String())
		}
		if got := len([]rune(svc.items[0].Reason)); got != 2000 {
			t.Fatalf("reason: %d рун, ожидалось 2000", got)
		}
		if len(svc.items[0].Evidence) != 10 {
			t.Fatalf("evidence: %d, ожидалось 10", len(svc.items[0].Evidence))
		}
		if svc.items[0].FindingID != extFindingID {
			t.Fatalf("finding_id не приведён к нижнему регистру: %s", svc.items[0].FindingID)
		}
		if svc.items[1].Evidence == nil || len(svc.items[1].Evidence) != 0 {
			t.Fatalf("evidence nil должен стать []: %#v", svc.items[1].Evidence)
		}
	})
}

func TestPostExternalAssessmentsNotify(t *testing.T) {
	body := extBody("qwen", "ext:v1", extItem())
	t.Run("saved>0 — событие один раз и ответ", func(t *testing.T) {
		svc := &fakeVerifAISvc{res: &services.ExternalAssessmentsResult{Saved: 1, Skipped: 2}}
		n := &fakeNotifier{}
		w := postExternal(t, NewVerificationAIHandler(svc, n), body)
		var resp struct {
			Data services.ExternalAssessmentsResult `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil || w.Code != http.StatusOK {
			t.Fatalf("status %d: %s", w.Code, w.Body.String())
		}
		if resp.Data.Saved != 1 || resp.Data.Skipped != 2 {
			t.Fatalf("ответ: %s", w.Body.String())
		}
		if len(n.tenders) != 1 || n.tenders[0] != extTenderID {
			t.Fatalf("события: %v", n.tenders)
		}
	})
	t.Run("saved=0 — события нет", func(t *testing.T) {
		svc := &fakeVerifAISvc{res: &services.ExternalAssessmentsResult{Skipped: 1}}
		n := &fakeNotifier{}
		w := postExternal(t, NewVerificationAIHandler(svc, n), body)
		if w.Code != http.StatusOK || len(n.tenders) != 0 {
			t.Fatalf("status %d, события %v", w.Code, n.tenders)
		}
	})
	t.Run("ошибка события не ломает ответ", func(t *testing.T) {
		svc := &fakeVerifAISvc{res: &services.ExternalAssessmentsResult{Saved: 1}}
		n := &fakeNotifier{err: errors.New("pg down")}
		w := postExternal(t, NewVerificationAIHandler(svc, n), body)
		if w.Code != http.StatusOK || len(n.tenders) != 1 {
			t.Fatalf("status %d, события %v", w.Code, n.tenders)
		}
	})
	t.Run("ошибка сервиса — 500 без события", func(t *testing.T) {
		svc := &fakeVerifAISvc{err: errors.New("db")}
		n := &fakeNotifier{}
		w := postExternal(t, NewVerificationAIHandler(svc, n), body)
		if w.Code != http.StatusInternalServerError || len(n.tenders) != 0 {
			t.Fatalf("status %d, события %v", w.Code, n.tenders)
		}
	})
}

type fakeQualityVerdictSvc struct{ qualityServicer }

func (fakeQualityVerdictSvc) SetVerdictFrom(context.Context, string, string, string, string, string, string, *string, *string) error {
	return nil
}
func (fakeQualityVerdictSvc) SetVerdicts(context.Context, string, []repository.VerdictInput, *string) error {
	return nil
}

// Вердикты по ключу шлют событие «проверка обновилась» (один раз на запрос),
// вердикты человека со страницы — нет.
func TestQualityVerdictsNotifyOnlyForAPIKey(t *testing.T) {
	one := fmt.Sprintf(`{"rule_code":"GA","entity_id":%q,"fingerprint":"fp","verdict":"error"}`, extFindingID)
	bulk := `{"items":[` + one + `,` + one + `]}`
	for _, withKey := range []bool{false, true} {
		for _, c := range []struct {
			name string
			call func(h *QualityHandler, w http.ResponseWriter, r *http.Request)
			body string
		}{
			{"verdict", (*QualityHandler).PostVerdict, one},
			{"verdicts", (*QualityHandler).PostVerdicts, bulk},
		} {
			t.Run(fmt.Sprintf("%s key=%v", c.name, withKey), func(t *testing.T) {
				n := &fakeNotifier{}
				h := NewQualityHandler(fakeQualityVerdictSvc{}, n)
				r := authedTenderReq(t, http.MethodPost, "/x", c.body)
				if withKey {
					r = r.WithContext(context.WithValue(r.Context(), middleware.CtxAPIKey,
						&middleware.APIKeyPrincipal{ID: "k", Scopes: []string{"verification:write"}}))
				}
				w := httptest.NewRecorder()
				c.call(h, w, r)
				if w.Code != http.StatusNoContent {
					t.Fatalf("status %d: %s", w.Code, w.Body.String())
				}
				want := 0
				if withKey {
					want = 1
				}
				if len(n.tenders) != want {
					t.Fatalf("событий %d, ожидалось %d", len(n.tenders), want)
				}
			})
		}
	}
}
