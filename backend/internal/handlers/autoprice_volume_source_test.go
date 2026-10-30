package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

const apReviewPath = "/runs/" + apSID + "/positions/" + apPos + "/review"

func TestAutopriceVolumeSource_PutThreeStates(t *testing.T) {
	t.Run("объект нормализуется", func(t *testing.T) {
		f := &fakeAutoprice{}
		w, _ := doAutoprice(t, f, "engineer", "PUT", apReviewPath,
			`{"volume_source":{"kind":"ai_model","value":2446.447,"unit":" м3 ","label":"Модель","ref":"","extra":1}}`)
		if w.Code != http.StatusOK || !f.upsertIn.VolumeSourceSet {
			t.Fatalf("status %d set=%v", w.Code, f.upsertIn.VolumeSourceSet)
		}
		var got map[string]any
		if err := json.Unmarshal(f.upsertIn.VolumeSource, &got); err != nil {
			t.Fatal(err)
		}
		want := map[string]any{"kind": "ai_model", "value": 2446.447, "unit": "м3", "label": "Модель"}
		if len(got) != len(want) {
			t.Fatalf("ключи: %v", got)
		}
		for k, v := range want {
			if got[k] != v {
				t.Fatalf("%s: %v, want %v", k, got[k], v)
			}
		}
	})
	t.Run("ключа нет — не менять", func(t *testing.T) {
		f := &fakeAutoprice{}
		w, _ := doAutoprice(t, f, "engineer", "PUT", apReviewPath, `{"basis":"ASSUMED"}`)
		if w.Code != http.StatusOK || f.upsertIn.VolumeSourceSet || f.upsertIn.VolumeSource != nil {
			t.Fatalf("status %d set=%v", w.Code, f.upsertIn.VolumeSourceSet)
		}
	})
	t.Run("null — сбросить", func(t *testing.T) {
		f := &fakeAutoprice{}
		w, _ := doAutoprice(t, f, "engineer", "PUT", apReviewPath, `{"volume_source":null}`)
		if w.Code != http.StatusOK || !f.upsertIn.VolumeSourceSet || f.upsertIn.VolumeSource != nil {
			t.Fatalf("status %d set=%v vs=%s", w.Code, f.upsertIn.VolumeSourceSet, f.upsertIn.VolumeSource)
		}
	})
	t.Run("conditional без value и unit", func(t *testing.T) {
		f := &fakeAutoprice{}
		w, _ := doAutoprice(t, f, "engineer", "PUT", apReviewPath, `{"volume_source":{"kind":"customer_boq","value":0}}`)
		if w.Code != http.StatusOK || !f.upsertIn.VolumeSourceSet {
			t.Fatalf("status %d", w.Code)
		}
	})
}

func volumeSourceCases() []struct{ name, vs string } {
	long := strings.Repeat("я", 301)
	return []struct{ name, vs string }{
		{"неверный kind", `{"kind":"guess","value":1,"unit":"м3"}`},
		{"нет kind", `{"value":1,"unit":"м3"}`},
		{"ai_model без value", `{"kind":"ai_model","unit":"м3"}`},
		{"ai_model value 0", `{"kind":"ai_model","value":0,"unit":"м3"}`},
		{"ai_model без unit", `{"kind":"ai_model","value":5}`},
		{"ai_model пустой unit", `{"kind":"ai_model","value":5,"unit":"  "}`},
		{"unit длиннее 32", `{"kind":"conditional","unit":"` + strings.Repeat("м", 33) + `"}`},
		{"отрицательный value", `{"kind":"conditional","value":-1}`},
		{"value строкой", `{"kind":"conditional","value":"5"}`},
		{"label длиннее 300", `{"kind":"conditional","label":"` + long + `"}`},
		{"note числом", `{"kind":"conditional","note":5}`},
		{"не объект", `"ai_model"`},
		{"массив", `[]`},
	}
}

func TestAutopriceVolumeSource_Put422(t *testing.T) {
	for _, c := range volumeSourceCases() {
		t.Run(c.name, func(t *testing.T) {
			f := &fakeAutoprice{}
			w, m := doAutoprice(t, f, "engineer", "PUT", apReviewPath, `{"volume_source":`+c.vs+`}`)
			if w.Code != http.StatusUnprocessableEntity || m["error"] != "invalid_volume_source" || m["message"] == "" {
				t.Fatalf("status %d body %v", w.Code, m)
			}
			if f.called {
				t.Fatal("store must not be called")
			}
		})
	}
}

func TestAutopriceVolumeSource_Bulk(t *testing.T) {
	body := func(vs string) string {
		return `{"positions":[{"position_id":"` + apPos + `","review":{"volume_source":` + vs + `}}]}`
	}
	t.Run("422 для каждого нарушения", func(t *testing.T) {
		for _, c := range volumeSourceCases() {
			f := &fakeBulk{}
			w, m := doBulk(t, f, body(c.vs))
			if w.Code != http.StatusUnprocessableEntity || m["error"] != "invalid_volume_source" ||
				m["position_id"] != apPos || m["field"] != "review.volume_source" || f.calls != 0 {
				t.Fatalf("%s: status %d body %v calls %d", c.name, w.Code, m, f.calls)
			}
		}
	})
	t.Run("значение доходит до хранилища", func(t *testing.T) {
		f := &fakeBulk{}
		w, _ := doBulk(t, f, body(`{"kind":"ai_model","value":12.5,"unit":"м2"}`))
		if w.Code != http.StatusOK || f.calls != 1 || f.got[0].Review == nil ||
			!f.got[0].Review.VolumeSourceSet || !strings.Contains(string(f.got[0].Review.VolumeSource), `"value":12.5`) {
			t.Fatalf("status %d got %+v", w.Code, f.got)
		}
	})
	t.Run("null и отсутствие", func(t *testing.T) {
		f := &fakeBulk{}
		doBulk(t, f, body(`null`))
		if f.calls != 1 || !f.got[0].Review.VolumeSourceSet || f.got[0].Review.VolumeSource != nil {
			t.Fatalf("null: %+v", f.got[0].Review)
		}
		f = &fakeBulk{}
		doBulk(t, f, `{"positions":[{"position_id":"`+apPos+`","review":{"basis":"ASSUMED"}}]}`)
		if f.calls != 1 || f.got[0].Review.VolumeSourceSet {
			t.Fatalf("без ключа: %+v", f.got[0].Review)
		}
	})
}
