package nomenclature

// Пороги итогового confidence (§9) — задокументированные константы.
const (
	HighDeterministicThreshold = 0.60 // deterministic score top-кандидата
	HighMarginThreshold        = 0.10 // отрыв top-1 от top-2
)

// ComputeConfidence — итоговый уровень рассчитывает BACKEND из
// детерминированных признаков и ответа модели (§9). Self-declared confidence
// модели сам по себе high не даёт.
//
// High только при ОДНОВРЕМЕННО: выбор из set; согласие AI и deterministic
// top-1; deterministic score ≥ порога; достаточный margin; нет hard unit
// conflict; нет конфликта significant tokens; модель не сообщает
// conflicting critical features.
func ComputeConfidence(cands []Candidate, selectedID string, ai RowResult) string {
	var selected *Candidate
	for i := range cands {
		if cands[i].ID == selectedID {
			selected = &cands[i]
			break
		}
	}
	if selected == nil {
		return ConfidenceAbstain
	}
	// Hard-конфликты не могут быть high (§9.5-7).
	hardConflict := selected.UnitCompatibility == "conflict" ||
		selected.SignificantTokenConflict || len(ai.ConflictingFeatures) > 0

	deterministicTop := cands[0].ID == selectedID
	margin := selected.DeterministicScore
	if len(cands) > 1 {
		if deterministicTop {
			margin = cands[0].DeterministicScore - cands[1].DeterministicScore
		} else {
			margin = 0
		}
	}
	aiSaysHigh := ai.Confidence == ConfidenceHigh

	switch {
	case hardConflict:
		if selected.DeterministicScore >= HighDeterministicThreshold {
			return ConfidenceMedium
		}
		return ConfidenceLow
	case aiSaysHigh && deterministicTop &&
		selected.DeterministicScore >= HighDeterministicThreshold &&
		margin >= HighMarginThreshold:
		return ConfidenceHigh
	case deterministicTop && selected.DeterministicScore >= HighDeterministicThreshold:
		return ConfidenceMedium
	case selected.DeterministicScore >= 0.3:
		if ai.Confidence == ConfidenceLow {
			return ConfidenceLow
		}
		return ConfidenceMedium
	default:
		return ConfidenceLow
	}
}
