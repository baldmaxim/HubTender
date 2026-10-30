package repository

import (
	"errors"
	"math"
	"strings"
	"testing"
)

func ptrS(s string) *string   { return &s }
func ptrF(f float64) *float64 { return &f }

func analogCode(t *testing.T, err error) string {
	t.Helper()
	var ae *AnalogError
	if !errors.As(err, &ae) {
		t.Fatalf("ожидалась *AnalogError, получено %v", err)
	}
	return ae.Code
}

func TestPlanAnalogScale_Rules(t *testing.T) {
	m2, m3 := ptrS("м2"), ptrS("м3")
	tests := []struct {
		name     string
		req      AnalogRequest
		src, tgt *string
		sv, tv   *float64
		wantCode string
		wantUnit bool
	}{
		{"ratio ok, единицы с пробелами и регистром", AnalogRequest{ScaleMode: ScaleModeVolumeRatio},
			ptrS(" М2 "), m2, ptrF(100), ptrF(200), "", true},
		{"ratio, разные единицы", AnalogRequest{ScaleMode: ScaleModeVolumeRatio},
			m2, m3, ptrF(100), ptrF(200), AnalogCodeScaleNeedsChoice, false},
		{"ratio, единица не задана у цели", AnalogRequest{ScaleMode: ScaleModeVolumeRatio},
			m2, nil, ptrF(100), ptrF(200), AnalogCodeScaleNeedsChoice, false},
		{"ratio, нулевой объём источника", AnalogRequest{ScaleMode: ScaleModeVolumeRatio},
			m2, m2, ptrF(0), ptrF(200), AnalogCodeVolumeUnknown, true},
		{"ratio, объём цели NULL", AnalogRequest{ScaleMode: ScaleModeVolumeRatio},
			m2, m2, ptrF(100), nil, AnalogCodeVolumeUnknown, true},
		{"ratio, отрицательный объём", AnalogRequest{ScaleMode: ScaleModeVolumeRatio},
			m2, m2, ptrF(-1), ptrF(5), AnalogCodeVolumeUnknown, true},
		{"none при разных единицах разрешён", AnalogRequest{ScaleMode: ScaleModeNone},
			m2, m3, nil, nil, "", false},
		{"factor ok при разных единицах", AnalogRequest{ScaleMode: ScaleModeFactor, ScaleFactor: ptrF(2.5)},
			m2, m3, nil, nil, "", false},
		{"factor без значения", AnalogRequest{ScaleMode: ScaleModeFactor},
			m2, m2, nil, nil, AnalogCodeScaleInvalid, true},
		{"factor ноль", AnalogRequest{ScaleMode: ScaleModeFactor, ScaleFactor: ptrF(0)},
			m2, m2, nil, nil, AnalogCodeScaleInvalid, true},
		{"factor отрицательный", AnalogRequest{ScaleMode: ScaleModeFactor, ScaleFactor: ptrF(-3)},
			m2, m2, nil, nil, AnalogCodeScaleInvalid, true},
		{"factor NaN", AnalogRequest{ScaleMode: ScaleModeFactor, ScaleFactor: ptrF(math.NaN())},
			m2, m2, nil, nil, AnalogCodeScaleInvalid, true},
		{"factor Inf", AnalogRequest{ScaleMode: ScaleModeFactor, ScaleFactor: ptrF(math.Inf(1))},
			m2, m2, nil, nil, AnalogCodeScaleInvalid, true},
		{"режим пуст — без дефолта", AnalogRequest{}, m2, m2, ptrF(1), ptrF(1), AnalogCodeScaleInvalid, true},
		{"неизвестный режим", AnalogRequest{ScaleMode: "auto"}, m2, m2, ptrF(1), ptrF(1), AnalogCodeScaleInvalid, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			plan, err := planAnalogScale(tc.req, tc.src, tc.tgt, tc.sv, tc.tv)
			if tc.wantCode == "" {
				if err != nil {
					t.Fatalf("неожиданная ошибка: %v", err)
				}
				if plan.Spec == nil || plan.Spec.Mode != tc.req.ScaleMode {
					t.Fatalf("spec: %+v", plan.Spec)
				}
			} else if got := analogCode(t, err); got != tc.wantCode {
				t.Fatalf("код = %s, want %s", got, tc.wantCode)
			}
			if plan.UnitsMatch != tc.wantUnit {
				t.Fatalf("UnitsMatch = %v, want %v", plan.UnitsMatch, tc.wantUnit)
			}
		})
	}
}

func TestAnalogRequestMatches_Idempotency(t *testing.T) {
	const pos = "AAAAAAAA-0000-4000-8000-000000000001"
	base := AnalogRequest{SourcePositionID: "BBBBBBBB-0000-4000-8000-000000000002", ScaleMode: ScaleModeFactor, ScaleFactor: ptrF(2), CopyPrices: true}
	body, err := analogRequestJSON(pos, base)
	if err != nil {
		t.Fatal(err)
	}
	same := base
	same.SourcePositionID = strings.ToLower(base.SourcePositionID) // регистр uuid не важен
	if !analogRequestMatches(body, strings.ToLower(pos), same) {
		t.Fatal("то же тело должно совпасть")
	}
	for name, mutate := range map[string]func(r *AnalogRequest){
		"источник":  func(r *AnalogRequest) { r.SourcePositionID = "CCCCCCCC-0000-4000-8000-000000000003" },
		"режим":     func(r *AnalogRequest) { r.ScaleMode = ScaleModeNone },
		"коэфф.":    func(r *AnalogRequest) { r.ScaleFactor = ptrF(3) },
		"цены":      func(r *AnalogRequest) { r.CopyPrices = false },
		"без коэфф": func(r *AnalogRequest) { r.ScaleFactor = nil },
	} {
		r := base
		mutate(&r)
		if analogRequestMatches(body, pos, r) {
			t.Errorf("изменение «%s» должно ломать совпадение", name)
		}
	}
	if analogRequestMatches(body, "DDDDDDDD-0000-4000-8000-000000000004", base) {
		t.Error("другая позиция с тем же ключом — конфликт")
	}
	// Коэффициент вне режима factor в тело не входит.
	a := AnalogRequest{SourcePositionID: base.SourcePositionID, ScaleMode: ScaleModeNone, ScaleFactor: ptrF(9)}
	b := AnalogRequest{SourcePositionID: base.SourcePositionID, ScaleMode: ScaleModeNone}
	ba, _ := analogRequestJSON(pos, a)
	if !analogRequestMatches(ba, pos, b) {
		t.Error("factor вне режима factor не должен учитываться")
	}
	if analogRequestMatches([]byte("not json"), pos, base) {
		t.Error("битое тело не совпадает")
	}
}

func TestAnalogToken(t *testing.T) {
	src, tgt := strings.Repeat("a", 32), strings.Repeat("b", 32)
	tok := analogToken(src, tgt)
	if !ValidAnalogToken(tok) {
		t.Fatalf("токен %q должен быть валидным", tok)
	}
	for _, bad := range []string{"", "x", src, src + "." + tgt + ".c", src + "." + strings.Repeat("g", 32), "." + tgt} {
		if ValidAnalogToken(bad) {
			t.Errorf("токен %q не должен быть валидным", bad)
		}
	}
	if side, stale := staleSide(tok, src, tgt); stale || side != "" {
		t.Errorf("тот же токен: stale=%v side=%q", stale, side)
	}
	if side, stale := staleSide(tok, strings.Repeat("c", 32), tgt); !stale || side != "source" {
		t.Errorf("источник изменился: %v %q", stale, side)
	}
	if side, stale := staleSide(tok, src, strings.Repeat("c", 32)); !stale || side != "target" {
		t.Errorf("цель изменилась: %v %q", stale, side)
	}
	if side, stale := staleSide("мусор", src, tgt); !stale || side != "target" {
		t.Errorf("битый токен: %v %q", stale, side)
	}
}

func TestMarshalArchiveAudit_ExtraDoesNotOverrideBase(t *testing.T) {
	base := archiveAuditPayload{ID: "i1", Origin: "analog_apply", SourceTenderID: "t1"}
	b, err := marshalArchiveAudit(base, map[string]any{"analog_application_id": "app-1", "origin": "evil"})
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	if !strings.Contains(s, `"analog_application_id":"app-1"`) || !strings.Contains(s, `"origin":"analog_apply"`) ||
		!strings.Contains(s, `"source_tender_id":"t1"`) {
		t.Fatalf("payload: %s", s)
	}
	plain, _ := marshalArchiveAudit(base, nil)
	if strings.Contains(string(plain), "analog_application_id") {
		t.Fatalf("без extra ключа быть не должно: %s", plain)
	}
}

func TestBlockedReasonOf(t *testing.T) {
	for state, want := range map[string]string{
		AnalogStateEmpty: "", AnalogStateDraftOnly: "",
		AnalogStateForeign: AnalogStateForeign, AnalogStateLocked: AnalogStateLocked,
	} {
		if got := blockedReasonOf(state); got != want {
			t.Errorf("blockedReasonOf(%s) = %q, want %q", state, got, want)
		}
	}
}
