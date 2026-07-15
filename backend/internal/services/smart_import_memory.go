package services

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/rs/zerolog/log"

	ia "github.com/su10/hubtender/backend/internal/importanalysis"
	importmemory "github.com/su10/hubtender/backend/internal/importmemory"
	"github.com/su10/hubtender/backend/internal/repository"
)

// importMemoryStore — персональная память импорта (этап 2.3). Все операции
// user-scoped на уровне репозитория (§15).
type importMemoryStore interface {
	ListProfilesBySignature(ctx context.Context, userID, signature string) ([]importmemory.Profile, error)
	GetProfile(ctx context.Context, userID, id string) (*importmemory.Profile, error)
	CreateProfile(ctx context.Context, userID, name, signature string,
		mapping map[string]string, fixed importmemory.FixedOptions,
		sheetHint string, headerHint int) (string, error)
	UpdateProfileContent(ctx context.Context, userID, id, signature string,
		mapping map[string]string, fixed importmemory.FixedOptions,
		sheetHint string, headerHint int) error
	BumpProfileUse(ctx context.Context, userID, id string) error
	BumpAliasUse(ctx context.Context, userID string, ids []string) error
	SaveAliases(ctx context.Context, userID string, entries []repository.AliasSaveEntry) (int, error)
}

// WithImportMemory — подключение памяти импорта; nil = функция выключена,
// весь импорт работает как раньше.
func (s *SmartImportService) WithImportMemory(store importMemoryStore) *SmartImportService {
	s.memory = store
	return s
}

// ─── Analyze: profile match/apply (§5) ───────────────────────────────────────

// ProfileSuggestionView — профиль в ответе analyze (без financial-полей).
type ProfileSuggestionView struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Status        string   `json:"status"` // usable | requires_review
	UseCount      int      `json:"use_count"`
	LastUsedAt    string   `json:"last_used_at,omitempty"`
	CreatedAt     string   `json:"created_at,omitempty"`
	SheetNameHint string   `json:"sheet_name_hint,omitempty"`
	HeaderRowHint int      `json:"header_row_hint,omitempty"`
	MappedFields  []string `json:"mapped_fields,omitempty"`
}

// AnalyzeMemory — memory-блок ответа analyze (§5/§11).
type AnalyzeMemory struct {
	HeaderSignature      string                  `json:"header_signature"`
	ProfileMatch         string                  `json:"profile_match"` // none | one | multiple
	Profiles             []ProfileSuggestionView `json:"profiles,omitempty"`
	AppliedProfileID     string                  `json:"applied_profile_id,omitempty"`
	AppliedProfileStatus string                  `json:"applied_profile_status,omitempty"` // applied | requires_review | signature_mismatch
	AppliedFields        []string                `json:"applied_fields,omitempty"`
	SkippedFields        []string                `json:"skipped_fields,omitempty"`
}

func profileView(p importmemory.Profile) ProfileSuggestionView {
	fields := make([]string, 0, len(p.Mapping))
	for f := range p.Mapping {
		fields = append(fields, f)
	}
	sort.Strings(fields)
	return ProfileSuggestionView{
		ID: p.ID, Name: p.Name, Status: importmemory.ProfileStatus(p),
		UseCount: p.UseCount, LastUsedAt: p.LastUsedAt, CreatedAt: p.CreatedAt,
		SheetNameHint: p.SheetNameHint, HeaderRowHint: p.HeaderRowHint,
		MappedFields: fields,
	}
}

// applyProfileToOptions — merge профиля в opts (§5): пользователь сильнее,
// подтверждение формул НЕ переносится, поля профиля получают source-метку.
func applyProfileToOptions(p *importmemory.Profile, opts ia.Options, an *ia.Analysis) (ia.Options, []string, []string) {
	allowed := map[string]bool{}
	for _, m := range an.Result.Mapping {
		allowed[m.TargetField] = true
	}
	merged, fromProfile, skipped := importmemory.MergeProfileMapping(p.Mapping, opts.MappingOverrides, allowed)
	opts.MappingOverrides = merged
	opts.ProfileFields = map[string]bool{}
	for _, f := range fromProfile {
		opts.ProfileFields[f] = true
	}
	if opts.SheetName == "" && p.SheetNameHint != "" {
		opts.SheetName = p.SheetNameHint
	}
	if opts.HeaderRow == 0 && p.HeaderRowHint > 0 {
		opts.HeaderRow = p.HeaderRowHint
	}
	if opts.DefaultCurrency == "" {
		opts.DefaultCurrency = p.FixedOptions.DefaultCurrency
	}
	if opts.DefaultBoqType == "" {
		opts.DefaultBoqType = p.FixedOptions.DefaultBoqType
	}
	return opts, fromProfile, skipped
}

// AnalyzeWithMemory — §5: обычный analyze + exact-совпадение профилей по
// header signature; применение профиля ТОЛЬКО по явному profileID от
// пользователя, с повторной валидацией mapping текущим анализом.
func (s *SmartImportService) AnalyzeWithMemory(
	ctx context.Context, tenderID, userID, fileName string, data []byte,
	opts ia.Options, profileID string,
) (*ia.Analysis, *AnalyzeMemory, error) {
	an, err := s.Analyze(ctx, tenderID, userID, fileName, data, opts)
	if err != nil {
		return nil, nil, err
	}
	mem := &AnalyzeMemory{
		HeaderSignature: importmemory.BuildImportHeaderSignature(an.Result.RawHeaders),
		ProfileMatch:    importmemory.ProfileMatchNone,
	}
	if s.memory == nil {
		return an, mem, nil
	}
	profiles, err := s.memory.ListProfilesBySignature(ctx, userID, mem.HeaderSignature)
	if err != nil {
		// Недоступность памяти не ломает анализ (§23): работаем без профилей.
		log.Warn().Err(err).Str("operation", "boq_import_profile_lookup").
			Msg("import memory unavailable, analysis continues without profiles")
		return an, mem, nil
	}
	match := importmemory.MatchProfiles(profiles, mem.HeaderSignature)
	mem.ProfileMatch = match.Status
	for _, p := range match.Profiles {
		mem.Profiles = append(mem.Profiles, profileView(p))
	}
	if profileID == "" {
		return an, mem, nil
	}

	// Явное применение профиля пользователем.
	p, err := s.memory.GetProfile(ctx, userID, profileID)
	if err != nil {
		return nil, nil, err // чужой/несуществующий → not found (§10/§15)
	}
	mem.AppliedProfileID = p.ID
	if !p.IsActive || importmemory.ProfileStatus(*p) != importmemory.MemoryUsable {
		mem.AppliedProfileStatus = importmemory.MemoryRequiresReview // §5/§13: не применяем молча
		return an, mem, nil
	}
	if p.HeaderSignature != mem.HeaderSignature {
		mem.AppliedProfileStatus = "signature_mismatch"
		return an, mem, nil
	}
	opts2, fromProfile, skipped := applyProfileToOptions(p, opts, an)
	an2, err := s.Analyze(ctx, tenderID, userID, fileName, data, opts2)
	if err != nil {
		return nil, nil, err
	}
	mem.AppliedProfileStatus = "applied"
	mem.AppliedFields = fromProfile
	mem.SkippedFields = skipped
	return an2, mem, nil
}

// ─── Execute: memory-контракт (§7-§9, §14) ───────────────────────────────────

// MemoryRequest — memory-часть execute-запроса.
type MemoryRequest struct {
	ProfileID    string `json:"profile_id"`
	SaveAsNew    bool   `json:"save_as_new"`
	SaveOrUpdate bool   `json:"save_or_update"`
	Name         string `json:"name"`
	// row_reference → «Запомнить для следующих импортов» (§7; default false,
	// backend не доверяет флагу без успешной re-валидации selection).
	RememberByRef map[string]bool `json:"-"`
}

// ExecuteMemoryProfile — §14.
type ExecuteMemoryProfile struct {
	Applied     bool   `json:"applied"`
	ProfileID   string `json:"profile_id,omitempty"`
	ProfileName string `json:"profile_name,omitempty"`
	Saved       bool   `json:"saved"`
	Updated     bool   `json:"updated"`
}

// ExecuteMemoryNomenclature — §14: одна строка = один final matching method.
type ExecuteMemoryNomenclature struct {
	ExactMatches           int `json:"exact_matches"`
	ApprovedAliasMatches   int `json:"approved_alias_matches"`
	AIConfirmedMatches     int `json:"ai_confirmed_matches"`
	ManualMatches          int `json:"manual_matches"`
	AliasesRequestedToSave int `json:"aliases_requested_to_save"`
	AliasesSaved           int `json:"aliases_saved"`
	AliasesFailed          int `json:"aliases_failed"`
}

// ExecuteMemory — memory-блок ответа execute (§14).
type ExecuteMemory struct {
	MappingProfile ExecuteMemoryProfile      `json:"mapping_profile"`
	Nomenclature   ExecuteMemoryNomenclature `json:"nomenclature"`
	Warnings       []string                  `json:"warnings"`
	MemorySaved    bool                      `json:"memory_saved"`
}

// prepareExecuteMemory — до импорта: применяем профиль к opts тем же путём,
// что и analyze (повторная серверная валидация), и проверяем контракт запроса.
func (s *SmartImportService) prepareExecuteMemory(
	ctx context.Context, tenderID, userID, fileName string, data []byte,
	opts ia.Options, mem *MemoryRequest,
) (ia.Options, string, error) {
	if mem != nil && mem.SaveAsNew && strings.TrimSpace(mem.Name) == "" {
		return opts, "", &InvalidSelectionError{Reason: "для сохранения нового профиля требуется имя"}
	}
	if mem == nil || (mem.ProfileID == "" && !mem.SaveAsNew && !mem.SaveOrUpdate) || s.memory == nil {
		return opts, "", nil
	}
	an, err := s.Analyze(ctx, tenderID, userID, fileName, data, opts)
	if err != nil {
		return opts, "", err
	}
	sig := importmemory.BuildImportHeaderSignature(an.Result.RawHeaders)
	if mem.ProfileID == "" {
		return opts, sig, nil
	}
	p, err := s.memory.GetProfile(ctx, userID, mem.ProfileID)
	if err != nil {
		return opts, "", err // чужой profile ID отклоняется (§9.3)
	}
	if !p.IsActive || importmemory.ProfileStatus(*p) != importmemory.MemoryUsable || p.HeaderSignature != sig {
		return opts, "", &InvalidSelectionError{
			Reason: "профиль устарел или не соответствует файлу — обновите анализ"}
	}
	opts2, _, _ := applyProfileToOptions(p, opts, an)
	return opts2, sig, nil
}

// finishExecuteMemory — ТОЛЬКО после успешного authoritative import (§8):
// счётчики использований + явно запрошенные сохранения. Ошибка здесь не
// откатывает BOQ — предпочтённая policy A: warning IMPORT_MEMORY_SAVE_FAILED.
func (s *SmartImportService) finishExecuteMemory(
	ctx context.Context, userID string, an *ia.Analysis, opts ia.Options,
	mem *MemoryRequest, signature string,
) ExecuteMemory {
	out := ExecuteMemory{MemorySaved: true, Warnings: []string{}}

	// §14: счётчики методов (одна строка — один метод).
	prov := buildProvenance(an, opts.SelectionSources)
	out.Nomenclature.ExactMatches = prov.ExactMatches
	out.Nomenclature.AIConfirmedMatches = prov.AISuggestionsConfirmed
	out.Nomenclature.ManualMatches = prov.ManuallySelected
	aliasIDs := map[string]bool{}
	for i := range an.Items {
		if an.Items[i].AliasID != "" {
			out.Nomenclature.ApprovedAliasMatches++
			aliasIDs[an.Items[i].AliasID] = true
		}
	}
	if s.memory == nil {
		return out
	}

	fail := func(err error, what string) {
		out.MemorySaved = false
		if len(out.Warnings) == 0 {
			out.Warnings = append(out.Warnings, "IMPORT_MEMORY_SAVE_FAILED")
		}
		log.Warn().Err(err).Str("operation", "boq_import_memory_persist").
			Str("step", what).Msg("import memory persistence failed (import itself succeeded)")
	}

	// Use counters применённых profile/aliases (§8.5).
	if mem != nil && mem.ProfileID != "" {
		out.MappingProfile.Applied = true
		out.MappingProfile.ProfileID = mem.ProfileID
		if p, err := s.memory.GetProfile(ctx, userID, mem.ProfileID); err == nil {
			out.MappingProfile.ProfileName = p.Name
		}
		if err := s.memory.BumpProfileUse(ctx, userID, mem.ProfileID); err != nil {
			fail(err, "profile_use")
		}
	}
	if len(aliasIDs) > 0 {
		ids := make([]string, 0, len(aliasIDs))
		for id := range aliasIDs {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		if err := s.memory.BumpAliasUse(ctx, userID, ids); err != nil {
			fail(err, "alias_use")
		}
	}

	// Явно запрошенные aliases (§7): только remember=true и только строки,
	// которые прошли повторную валидацию (selection применена в an.Items).
	if mem != nil && len(mem.RememberByRef) > 0 {
		entries := make([]repository.AliasSaveEntry, 0, len(mem.RememberByRef))
		byRow := map[int]*ia.NormalizedItem{}
		for i := range an.Items {
			byRow[an.Items[i].ExcelRow] = &an.Items[i]
		}
		refs := make([]string, 0, len(mem.RememberByRef))
		for ref, remember := range mem.RememberByRef {
			if remember {
				refs = append(refs, ref)
			}
		}
		sort.Strings(refs)
		for _, ref := range refs {
			catalogID := opts.NomenclatureSelections[ref]
			src := opts.SelectionSources[ref]
			if catalogID == "" || (src != "ai_confirmed" && src != "manual") {
				continue // §7: запоминаются только подтверждённые решения
			}
			row := 0
			if i := strings.LastIndex(ref, "|"); i >= 0 {
				fmt.Sscanf(ref[i+1:], "%d", &row) //nolint:errcheck
			}
			it := byRow[row]
			if it == nil || it.Description == nil || it.BoqItemType == "" {
				continue
			}
			applied := (it.WorkNameID != nil && *it.WorkNameID == catalogID) ||
				(it.MaterialNameID != nil && *it.MaterialNameID == catalogID)
			if !applied {
				continue // selection не прошла повторную валидацию — не запоминаем
			}
			unit, dcID := "", ""
			if it.UnitCode != nil {
				unit = *it.UnitCode
			}
			if it.DetailCategoryID != nil {
				dcID = *it.DetailCategoryID
			}
			entries = append(entries, repository.AliasSaveEntry{
				CatalogKind:      importmemory.CatalogKindForBoqType(it.BoqItemType),
				CatalogID:        catalogID,
				SourceText:       *it.Description,
				CanonicalBoqType: it.BoqItemType,
				UnitCode:         unit,
				DetailCategoryID: dcID,
			})
		}
		out.Nomenclature.AliasesRequestedToSave = len(entries)
		if len(entries) > 0 {
			saved, err := s.memory.SaveAliases(ctx, userID, entries)
			out.Nomenclature.AliasesSaved = saved
			out.Nomenclature.AliasesFailed = len(entries) - saved
			if err != nil {
				fail(err, "alias_save")
			}
		}
	}

	// Профиль: сохранение/обновление ТОЛЬКО по явному запросу (§9).
	if mem != nil && (mem.SaveAsNew || (mem.SaveOrUpdate && mem.ProfileID != "")) {
		mapping := map[string]string{}
		for _, m := range an.Result.Mapping {
			switch {
			case m.FixedValue != "":
				mapping[m.TargetField] = "=" + m.FixedValue
			case m.SourceColumn != "":
				mapping[m.TargetField] = m.SourceColumn
			}
		}
		fixed := importmemory.FixedOptions{
			DefaultCurrency: opts.DefaultCurrency,
			DefaultBoqType:  opts.DefaultBoqType,
		}
		if mem.SaveAsNew {
			if _, err := s.memory.CreateProfile(ctx, userID, mem.Name, signature,
				mapping, fixed, an.Result.SelectedSheet, an.Result.DetectedHeaderRow); err != nil {
				fail(err, "profile_create")
			} else {
				out.MappingProfile.Saved = true
			}
		} else {
			if err := s.memory.UpdateProfileContent(ctx, userID, mem.ProfileID, signature,
				mapping, fixed, an.Result.SelectedSheet, an.Result.DetectedHeaderRow); err != nil {
				fail(err, "profile_update")
			} else {
				out.MappingProfile.Updated = true
			}
		}
	}

	log.Info().
		Str("operation", "boq_import_memory_summary").
		Bool("profile_applied", out.MappingProfile.Applied).
		Bool("profile_saved", out.MappingProfile.Saved).
		Bool("profile_updated", out.MappingProfile.Updated).
		Int("alias_hits", out.Nomenclature.ApprovedAliasMatches).
		Int("aliases_saved", out.Nomenclature.AliasesSaved).
		Int("aliases_failed", out.Nomenclature.AliasesFailed).
		Bool("memory_saved", out.MemorySaved).
		Msg("import memory persisted")
	return out
}
