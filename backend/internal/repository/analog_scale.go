package repository

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

// Чистая логика пилота «аналог»: каноничное тело запроса (сравнение при
// повторе), правила масштаба и отпечаток-токен предпросмотра. Без БД.

// AnalogRequest — тело предпросмотра и применения (без токена и ключа).
type AnalogRequest struct {
	SourcePositionID string
	ScaleMode        string // none | volume_ratio | factor — обязателен, без дефолта
	ScaleFactor      *float64
	CopyPrices       bool
}

// analogCanonical — каноничный вид запроса: хранится в analog_applications.request
// и сравнивается при повторе с тем же ключом идемпотентности. Коэффициент
// значим только в режиме factor; ключ позиции входит в тело, чтобы один ключ
// нельзя было применить к двум разным позициям.
type analogCanonical struct {
	PositionID       string   `json:"position_id"`
	SourcePositionID string   `json:"source_position_id"`
	ScaleMode        string   `json:"scale_mode"`
	ScaleFactor      *float64 `json:"scale_factor"`
	CopyPrices       bool     `json:"copy_prices"`
}

func canonicalAnalogRequest(positionID string, r AnalogRequest) analogCanonical {
	c := analogCanonical{
		PositionID:       strings.ToLower(strings.TrimSpace(positionID)),
		SourcePositionID: strings.ToLower(strings.TrimSpace(r.SourcePositionID)),
		ScaleMode:        r.ScaleMode,
		CopyPrices:       r.CopyPrices,
	}
	if r.ScaleMode == ScaleModeFactor && r.ScaleFactor != nil {
		f := *r.ScaleFactor
		c.ScaleFactor = &f
	}
	return c
}

func (c analogCanonical) same(o analogCanonical) bool {
	if c.PositionID != o.PositionID || c.SourcePositionID != o.SourcePositionID ||
		c.ScaleMode != o.ScaleMode || c.CopyPrices != o.CopyPrices {
		return false
	}
	if (c.ScaleFactor == nil) != (o.ScaleFactor == nil) {
		return false
	}
	return c.ScaleFactor == nil || *c.ScaleFactor == *o.ScaleFactor
}

// analogRequestJSON — каноничный JSON запроса для записи в analog_applications.
func analogRequestJSON(positionID string, r AnalogRequest) ([]byte, error) {
	return json.Marshal(canonicalAnalogRequest(positionID, r))
}

// analogRequestMatches — совпадает ли сохранённое тело с новым запросом.
func analogRequestMatches(stored []byte, positionID string, r AnalogRequest) bool {
	var old analogCanonical
	if err := json.Unmarshal(stored, &old); err != nil {
		return false
	}
	return old.same(canonicalAnalogRequest(positionID, r))
}

// ─── токен предпросмотра ────────────────────────────────────────────────────

// analogToken — "<отпечаток источника>.<отпечаток цели>".
func analogToken(srcFingerprint, tgtFingerprint string) string {
	return srcFingerprint + "." + tgtFingerprint
}

func splitAnalogToken(token string) (src, tgt string, ok bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	return parts[0], parts[1], true
}

// ValidAnalogToken — формат токена (две md5-суммы через точку).
func ValidAnalogToken(token string) bool {
	src, tgt, ok := splitAnalogToken(token)
	return ok && isHex32(src) && isHex32(tgt)
}

func isHex32(s string) bool {
	if len(s) != 32 {
		return false
	}
	for _, r := range s {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

// staleSide — что изменилось с момента предпросмотра: источник или цель.
// Токен неверного формата считается устаревшей целью.
func staleSide(token, srcNow, tgtNow string) (changed string, stale bool) {
	src, tgt, ok := splitAnalogToken(token)
	switch {
	case !ok:
		return "target", true
	case src != srcNow:
		return "source", true
	case tgt != tgtNow:
		return "target", true
	}
	return "", false
}

// ─── правила масштаба ───────────────────────────────────────────────────────

// analogScalePlan — разобранные правила масштаба для compose.
type analogScalePlan struct {
	Spec         *ScaleSpec
	UnitsMatch   bool
	SourceVolume *float64
	TargetVolume *float64
}

func normalizeUnit(u *string) string {
	if u == nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(*u))
}

// unitsMatch: единицы совпадают (trim+lower) и заданы.
func unitsMatch(src, tgt *string) bool {
	s, t := normalizeUnit(src), normalizeUnit(tgt)
	return s != "" && s == t
}

// ValidateAnalogScaleSyntax проверяет режим и коэффициент без обращения к БД:
// режим из none/volume_ratio/factor, коэффициент (только для factor) конечный и > 0.
func ValidateAnalogScaleSyntax(mode string, factor *float64) *AnalogError {
	switch mode {
	case ScaleModeNone, ScaleModeVolumeRatio:
		return nil
	case ScaleModeFactor:
		if factor == nil || math.IsNaN(*factor) || math.IsInf(*factor, 0) || *factor <= 0 {
			return analogErr(AnalogCodeScaleInvalid, "Коэффициент должен быть числом больше нуля.", nil)
		}
		return nil
	}
	return analogErr(AnalogCodeScaleInvalid,
		fmt.Sprintf("Неизвестный режим масштаба %q: ожидается none, volume_ratio или factor.", mode), nil)
}

// planAnalogScale применяет правила масштаба пилота. Объёмы — действующие
// (manual_volume ?? volume).
//
//   - volume_ratio — только при совпадающих единицах и объёмах > 0;
//   - factor — явный коэффициент инженера, конечный и > 0;
//   - none — «количества как в источнике».
func planAnalogScale(r AnalogRequest, srcUnit, tgtUnit *string, srcVol, tgtVol *float64) (analogScalePlan, error) {
	plan := analogScalePlan{
		UnitsMatch:   unitsMatch(srcUnit, tgtUnit),
		SourceVolume: srcVol,
		TargetVolume: tgtVol,
	}
	if e := ValidateAnalogScaleSyntax(r.ScaleMode, r.ScaleFactor); e != nil {
		return plan, e
	}
	switch r.ScaleMode {
	case ScaleModeNone:
		plan.Spec = &ScaleSpec{Mode: ScaleModeNone}
	case ScaleModeFactor:
		f := *r.ScaleFactor
		plan.Spec = &ScaleSpec{Mode: ScaleModeFactor, Factor: &f}
	case ScaleModeVolumeRatio:
		if !plan.UnitsMatch {
			return plan, analogErr(AnalogCodeScaleNeedsChoice,
				"Единицы измерения позиции и аналога различаются: пересчёт по объёму невозможен. "+
					"Задайте коэффициент вручную или оставьте количества как в аналоге.",
				map[string]any{"source_unit": derefOrEmpty(srcUnit), "target_unit": derefOrEmpty(tgtUnit)})
		}
		if srcVol == nil || *srcVol <= 0 || tgtVol == nil || *tgtVol <= 0 {
			return plan, analogErr(AnalogCodeVolumeUnknown,
				"У позиции или у аналога не задан объём (или он равен нулю): пересчёт по объёму невозможен. "+
					"Задайте коэффициент вручную или оставьте количества как в аналоге.",
				map[string]any{"source_volume": srcVol, "target_volume": tgtVol})
		}
		sv, tv := *srcVol, *tgtVol
		plan.Spec = &ScaleSpec{Mode: ScaleModeVolumeRatio, SourceVolume: &sv, TargetVolume: &tv}
	}
	return plan, nil
}

// scaleDescription — человекочитаемое описание масштаба для журнала проверки.
func scaleDescription(mode string, factor float64, srcVol, tgtVol *float64) string {
	switch mode {
	case ScaleModeVolumeRatio:
		if srcVol != nil && tgtVol != nil {
			return fmt.Sprintf("по объёму ×%s (%s → %s)", fmtNum(factor), fmtNum(*srcVol), fmtNum(*tgtVol))
		}
		return "по объёму ×" + fmtNum(factor)
	case ScaleModeFactor:
		return "коэффициент ×" + fmtNum(factor)
	}
	return "как в аналоге"
}

func fmtNum(v float64) string { return fmt.Sprintf("%.6g", v) }
