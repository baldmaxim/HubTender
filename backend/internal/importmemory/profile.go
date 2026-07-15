package importmemory

import "sort"

// Profile — персональный профиль сопоставления колонок (строка БД).
// Хранит ТОЛЬКО mapping/фиксированные опции — никаких financial-полей,
// строк Excel, fingerprint или BOQ-данных (§2/§16).
type Profile struct {
	ID                   string
	Name                 string
	HeaderSignature      string
	MappingSchemaVersion int
	NormalizationVersion int
	Mapping              map[string]string // target field → source column | "=fixed"
	FixedOptions         FixedOptions
	SheetNameHint        string
	HeaderRowHint        int
	IsActive             bool
	UseCount             int
	LastUsedAt           string
	CreatedAt            string
}

// FixedOptions — единственные допустимые сохранённые опции (§2/аудит §1):
// подтверждение формул сюда НЕ входит — его нельзя обходить профилем.
type FixedOptions struct {
	DefaultCurrency string `json:"default_currency,omitempty"`
	DefaultBoqType  string `json:"default_boq_type,omitempty"`
}

// ProfileStatus — применимость профиля (§5/§13).
func ProfileStatus(p Profile) string {
	if p.MappingSchemaVersion != MappingSchemaVersion ||
		p.NormalizationVersion != NormalizationVersion {
		return MemoryRequiresReview
	}
	return MemoryUsable
}

// ProfileMatch — результат exact-поиска профилей по сигнатуре (§5):
// один → можно предложить автоматически; несколько → выбор пользователя.
type ProfileMatch struct {
	Status   string // none | one | multiple
	Profiles []Profile
}

// Статусы ProfileMatch.
const (
	ProfileMatchNone     = "none"
	ProfileMatchOne      = "one"
	ProfileMatchMultiple = "multiple"
)

// MatchProfiles — детерминированный порядок (name → id), НИКОГДА не выбирает
// один из нескольких по last_used_at (§2).
func MatchProfiles(profiles []Profile, signature string) ProfileMatch {
	var hits []Profile
	for _, p := range profiles {
		if p.IsActive && p.HeaderSignature == signature {
			hits = append(hits, p)
		}
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].Name != hits[j].Name {
			return hits[i].Name < hits[j].Name
		}
		return hits[i].ID < hits[j].ID
	})
	switch len(hits) {
	case 0:
		return ProfileMatch{Status: ProfileMatchNone}
	case 1:
		return ProfileMatch{Status: ProfileMatchOne, Profiles: hits}
	default:
		return ProfileMatch{Status: ProfileMatchMultiple, Profiles: hits}
	}
}

// MergeProfileMapping — merge профиля в overrides (§5/§9):
//   - пользовательские overrides всегда сильнее профиля;
//   - одна колонка не назначается двум полям (первое по алфавиту поля
//     остаётся, дубликат отбрасывается и попадает в skipped);
//   - профиль НЕ добавляет поля, которых нет в allowedFields (удалённый
//     target field отбрасывается).
//
// Возвращает: итоговые overrides, поля из профиля, отброшенные поля.
func MergeProfileMapping(
	profile map[string]string,
	userOverrides map[string]string,
	allowedFields map[string]bool,
) (merged map[string]string, fromProfile []string, skipped []string) {
	merged = map[string]string{}
	usedColumns := map[string]bool{}
	for f, v := range userOverrides {
		merged[f] = v
		if v != "" && v[0] != '=' {
			usedColumns[v] = true
		}
	}
	fields := make([]string, 0, len(profile))
	for f := range profile {
		fields = append(fields, f)
	}
	sort.Strings(fields)
	for _, f := range fields {
		v := profile[f]
		if !allowedFields[f] {
			skipped = append(skipped, f)
			continue
		}
		if _, userSet := userOverrides[f]; userSet {
			continue // пользователь сильнее профиля
		}
		if v != "" && v[0] != '=' {
			if usedColumns[v] {
				skipped = append(skipped, f) // §5: колонка уже занята
				continue
			}
			usedColumns[v] = true
		}
		merged[f] = v
		fromProfile = append(fromProfile, f)
	}
	sort.Strings(fromProfile)
	return merged, fromProfile, skipped
}
