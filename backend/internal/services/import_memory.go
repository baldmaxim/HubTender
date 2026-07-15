package services

import (
	"context"

	importmemory "github.com/su10/hubtender/backend/internal/importmemory"
	"github.com/su10/hubtender/backend/internal/repository"
)

// ImportMemoryService — этап 2.3 (§10): управление персональной памятью
// импорта. НИКОГДА не трогает BOQ/финансы/approval/recalc (§16): только
// name/is_active профилей и is_active aliases; catalog target через
// management API не меняется.
type ImportMemoryService struct {
	repo *repository.ImportMemoryRepo
}

// NewImportMemoryService creates an ImportMemoryService.
func NewImportMemoryService(repo *repository.ImportMemoryRepo) *ImportMemoryService {
	return &ImportMemoryService{repo: repo}
}

// ProfileList — страница профилей.
type ProfileList struct {
	Items []ProfileSuggestionView `json:"items"`
	Total int                     `json:"total"`
}

// ListProfiles — user-scoped список (§15).
func (s *ImportMemoryService) ListProfiles(
	ctx context.Context, userID, search string, activeOnly bool, page, pageSize int,
) (*ProfileList, error) {
	profiles, total, err := s.repo.ListProfiles(ctx, userID, search, activeOnly, page, pageSize)
	if err != nil {
		return nil, err
	}
	out := &ProfileList{Items: make([]ProfileSuggestionView, 0, len(profiles)), Total: total}
	for _, p := range profiles {
		v := profileView(p)
		if !p.IsActive {
			v.Status = "inactive"
		}
		out.Items = append(out.Items, v)
	}
	return out, nil
}

// PatchProfile — ТОЛЬКО name/is_active (§10); mapping через generic PATCH
// изменить нельзя — это делает только Smart Import validation-путь.
func (s *ImportMemoryService) PatchProfile(ctx context.Context, userID, id string, name *string, isActive *bool) error {
	if name != nil && importmemory.NormalizeSourceText(*name) == "" {
		return &InvalidSelectionError{Reason: "имя профиля не может быть пустым"}
	}
	return s.repo.PatchProfile(ctx, userID, id, name, isActive)
}

// DeactivateProfile — DELETE = soft deactivate (§10).
func (s *ImportMemoryService) DeactivateProfile(ctx context.Context, userID, id string) error {
	off := false
	return s.repo.PatchProfile(ctx, userID, id, nil, &off)
}

// AliasList — страница aliases.
type AliasList struct {
	Items []repository.AliasListRow `json:"items"`
	Total int                       `json:"total"`
}

// ListAliases — user-scoped список (§15) с целевой номенклатурой.
func (s *ImportMemoryService) ListAliases(
	ctx context.Context, userID, search string, activeOnly bool, page, pageSize int,
) (*AliasList, error) {
	items, total, err := s.repo.ListAliases(ctx, userID, search, activeOnly, page, pageSize)
	if err != nil {
		return nil, err
	}
	return &AliasList{Items: items, Total: total}, nil
}

// SetAliasActive — деактивация/восстановление (§10/§12); catalog target
// неизменяем — новое соответствие создаётся только через Smart Import.
func (s *ImportMemoryService) SetAliasActive(ctx context.Context, userID, id string, active bool) error {
	return s.repo.SetAliasActive(ctx, userID, id, active)
}
