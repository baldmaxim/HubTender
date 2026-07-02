package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// LibraryRepo owns works_library / materials_library / templates /
// library_folders CRUD consumed by src/pages/Library/. Sub-domains live in
// sibling files: library_works.go, library_materials.go,
// library_templates.go; this file keeps the shared types and the
// library_folders section.
type LibraryRepo struct {
	pool *pgxpool.Pool
}

// NewLibraryRepo creates a LibraryRepo.
func NewLibraryRepo(pool *pgxpool.Pool) *LibraryRepo {
	return &LibraryRepo{pool: pool}
}

// WorkNameEmbed mirrors the work_names(id,name,unit) PostgREST embed.
// Shared by works, materials and template-item embeds.
type WorkNameEmbed struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Unit string `json:"unit"`
}

// ─── library_folders ────────────────────────────────────────────────────────

// LibraryFolderRow mirrors a library_folders row (no updated_at column).
type LibraryFolderRow struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Type      string  `json:"type"`
	SortOrder int     `json:"sort_order"`
	ParentID  *string `json:"parent_id"`
	CreatedAt *string `json:"created_at"`
}

// LibraryFolderInput is the create payload.
type LibraryFolderInput struct {
	Name     string  `json:"name"`
	Type     string  `json:"type"`
	ParentID *string `json:"parent_id"`
}

// moveItemTables is the allowlist for MoveLibraryItem — the table name is
// interpolated into SQL, so it must never come unchecked from the request.
var moveItemTables = map[string]bool{
	"works_library":     true,
	"materials_library": true,
	"templates":         true,
}

// ListFolders returns folders of a given type, ordered by (sort_order, name).
func (r *LibraryRepo) ListFolders(ctx context.Context, folderType string) ([]LibraryFolderRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, name, type, sort_order, parent_id::text,
		       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM public.library_folders
		WHERE type = $1
		ORDER BY sort_order, name
	`, folderType)
	if err != nil {
		return nil, fmt.Errorf("libraryRepo.ListFolders: %w", err)
	}
	defer rows.Close()
	out := make([]LibraryFolderRow, 0)
	for rows.Next() {
		var f LibraryFolderRow
		if err := rows.Scan(&f.ID, &f.Name, &f.Type, &f.SortOrder,
			&f.ParentID, &f.CreatedAt); err != nil {
			return nil, fmt.Errorf("libraryRepo.ListFolders scan: %w", err)
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// CreateFolder inserts a library_folders row.
func (r *LibraryRepo) CreateFolder(ctx context.Context, in LibraryFolderInput) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.library_folders (name, type, parent_id)
		VALUES ($1, $2, $3::uuid)
	`, in.Name, in.Type, in.ParentID)
	if err != nil {
		return fmt.Errorf("libraryRepo.CreateFolder: %w", err)
	}
	return nil
}

// RenameFolder updates a folder's name.
func (r *LibraryRepo) RenameFolder(ctx context.Context, id, name string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE public.library_folders SET name = $1 WHERE id = $2`, name, id)
	if err != nil {
		return fmt.Errorf("libraryRepo.RenameFolder: %w", err)
	}
	return nil
}

// DeleteFolder removes a library_folders row.
func (r *LibraryRepo) DeleteFolder(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM public.library_folders WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("libraryRepo.DeleteFolder: %w", err)
	}
	return nil
}

// MoveLibraryItem sets folder_id on a works_library / materials_library /
// templates row. table must be in the allowlist (validated by caller).
func (r *LibraryRepo) MoveLibraryItem(ctx context.Context, table, itemID string, folderID *string) error {
	if !moveItemTables[table] {
		return fmt.Errorf("libraryRepo.MoveLibraryItem: invalid table %q", table)
	}
	q := fmt.Sprintf(
		`UPDATE public.%s SET folder_id = $1::uuid WHERE id = $2`, table)
	if _, err := r.pool.Exec(ctx, q, folderID, itemID); err != nil {
		return fmt.Errorf("libraryRepo.MoveLibraryItem: %w", err)
	}
	return nil
}
