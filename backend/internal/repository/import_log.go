package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ImportLogRepo handles import_sessions reads + atomic session-cancel.
type ImportLogRepo struct {
	pool *pgxpool.Pool
}

// NewImportLogRepo creates an ImportLogRepo.
func NewImportLogRepo(pool *pgxpool.Pool) *ImportLogRepo {
	return &ImportLogRepo{pool: pool}
}

// ImportSessionRow mirrors the projection used by Admin/ImportLog.
type ImportSessionRow struct {
	ID                string          `json:"id"`
	UserID            string          `json:"user_id"`
	TenderID          string          `json:"tender_id"`
	FileName          *string         `json:"file_name,omitempty"`
	ItemsCount        int             `json:"items_count"`
	ImportedAt        *string         `json:"imported_at,omitempty"`
	CancelledAt       *string         `json:"cancelled_at,omitempty"`
	CancelledBy       *string         `json:"cancelled_by,omitempty"`
	PositionsSnapshot json.RawMessage `json:"positions_snapshot,omitempty"`
}

// ListSessions returns up to 200 latest sessions, filtered by tenderID.
func (r *ImportLogRepo) ListSessions(ctx context.Context, tenderID string) ([]ImportSessionRow, error) {
	var (
		rows pgx.Rows
		err  error
	)
	if tenderID != "" {
		rows, err = r.pool.Query(ctx, `
			SELECT id::text, user_id::text, tender_id::text, file_name, items_count,
			       to_char(imported_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
			       to_char(cancelled_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
			       cancelled_by::text, positions_snapshot
			FROM public.import_sessions
			WHERE tender_id = $1
			ORDER BY imported_at DESC
			LIMIT 200
		`, tenderID)
	} else {
		rows, err = r.pool.Query(ctx, `
			SELECT id::text, user_id::text, tender_id::text, file_name, items_count,
			       to_char(imported_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
			       to_char(cancelled_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
			       cancelled_by::text, positions_snapshot
			FROM public.import_sessions
			ORDER BY imported_at DESC
			LIMIT 200
		`)
	}
	if err != nil {
		return nil, fmt.Errorf("importLogRepo.ListSessions: %w", err)
	}
	defer rows.Close()

	out := make([]ImportSessionRow, 0)
	for rows.Next() {
		var (
			rec      ImportSessionRow
			snapshot []byte
		)
		if err := rows.Scan(&rec.ID, &rec.UserID, &rec.TenderID, &rec.FileName, &rec.ItemsCount,
			&rec.ImportedAt, &rec.CancelledAt, &rec.CancelledBy, &snapshot); err != nil {
			return nil, fmt.Errorf("importLogRepo.ListSessions scan: %w", err)
		}
		if len(snapshot) > 0 {
			rec.PositionsSnapshot = snapshot
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

// ImportLogUserRow has the user fields surfaced by Admin/ImportLog.
type ImportLogUserRow struct {
	ID       string  `json:"id"`
	FullName string  `json:"full_name"`
	RoleCode string  `json:"role_code"`
	Roles    *struct {
		Name  string  `json:"name"`
		Color *string `json:"color,omitempty"`
	} `json:"roles,omitempty"`
}

// UsersByIDs returns the embedded {role_code, roles{name,color}} for each id.
func (r *ImportLogRepo) UsersByIDs(ctx context.Context, ids []string) ([]ImportLogUserRow, error) {
	if len(ids) == 0 {
		return []ImportLogUserRow{}, nil
	}
	rows, err := r.pool.Query(ctx, `
		SELECT u.id::text, u.full_name, u.role_code,
		       r.name, r.color
		FROM public.users u
		LEFT JOIN public.roles r ON r.code = u.role_code
		WHERE u.id = ANY($1::uuid[])
	`, ids)
	if err != nil {
		return nil, fmt.Errorf("importLogRepo.UsersByIDs: %w", err)
	}
	defer rows.Close()
	out := make([]ImportLogUserRow, 0)
	for rows.Next() {
		var (
			rec       ImportLogUserRow
			roleName  *string
			roleColor *string
		)
		if err := rows.Scan(&rec.ID, &rec.FullName, &rec.RoleCode, &roleName, &roleColor); err != nil {
			return nil, fmt.Errorf("importLogRepo.UsersByIDs scan: %w", err)
		}
		if roleName != nil {
			rec.Roles = &struct {
				Name  string  `json:"name"`
				Color *string `json:"color,omitempty"`
			}{Name: *roleName, Color: roleColor}
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

type TenderShort struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	TenderNumber string `json:"tender_number"`
}

func (r *ImportLogRepo) TendersByIDs(ctx context.Context, ids []string) ([]TenderShort, error) {
	if len(ids) == 0 {
		return []TenderShort{}, nil
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, COALESCE(title, ''), COALESCE(tender_number, '')
		FROM public.tenders
		WHERE id = ANY($1::uuid[])
	`, ids)
	if err != nil {
		return nil, fmt.Errorf("importLogRepo.TendersByIDs: %w", err)
	}
	defer rows.Close()
	out := make([]TenderShort, 0)
	for rows.Next() {
		var t TenderShort
		if err := rows.Scan(&t.ID, &t.Title, &t.TenderNumber); err != nil {
			return nil, fmt.Errorf("importLogRepo.TendersByIDs scan: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (r *ImportLogRepo) ListAllTendersForFilter(ctx context.Context) ([]TenderShort, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, COALESCE(title, ''), COALESCE(tender_number, '')
		FROM public.tenders
		ORDER BY title
	`)
	if err != nil {
		return nil, fmt.Errorf("importLogRepo.ListAllTendersForFilter: %w", err)
	}
	defer rows.Close()
	out := make([]TenderShort, 0)
	for rows.Next() {
		var t TenderShort
		if err := rows.Scan(&t.ID, &t.Title, &t.TenderNumber); err != nil {
			return nil, fmt.Errorf("importLogRepo.ListAllTendersForFilter scan: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// CancelResult is returned by CancelSession to summarise what was undone.
type CancelResult struct {
	BoqDeleted        int `json:"boq_deleted"`
	PositionsRestored int `json:"positions_restored"`
}

// CancelSession atomically:
//   1. deletes boq_items rows tagged with import_session_id
//   2. restores client_positions.manual_volume / manual_note from snapshot
//   3. marks import_sessions row as cancelled
func (r *ImportLogRepo) CancelSession(ctx context.Context, sessionID, cancelledBy string) (*CancelResult, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("importLogRepo.CancelSession: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var snapshot []byte
	err = tx.QueryRow(ctx, `
		SELECT positions_snapshot
		FROM public.import_sessions
		WHERE id = $1
		FOR UPDATE
	`, sessionID).Scan(&snapshot)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("importLogRepo.CancelSession: session not found")
		}
		return nil, fmt.Errorf("importLogRepo.CancelSession: load: %w", err)
	}

	tag, err := tx.Exec(ctx, `
		DELETE FROM public.boq_items WHERE import_session_id = $1
	`, sessionID)
	if err != nil {
		return nil, fmt.Errorf("importLogRepo.CancelSession: delete boq: %w", err)
	}
	res := &CancelResult{BoqDeleted: int(tag.RowsAffected())}

	if len(snapshot) > 0 {
		// Snapshot is JSONB array of {id, manual_volume, manual_note}.
		var snaps []struct {
			ID           string   `json:"id"`
			ManualVolume *float64 `json:"manual_volume"`
			ManualNote   *string  `json:"manual_note"`
		}
		if err := json.Unmarshal(snapshot, &snaps); err != nil {
			return nil, fmt.Errorf("importLogRepo.CancelSession: parse snapshot: %w", err)
		}
		for _, s := range snaps {
			_, err := tx.Exec(ctx, `
				UPDATE public.client_positions
				SET manual_volume = $1, manual_note = $2
				WHERE id = $3
			`, s.ManualVolume, s.ManualNote, s.ID)
			if err != nil {
				return nil, fmt.Errorf("importLogRepo.CancelSession: restore: %w", err)
			}
			res.PositionsRestored++
		}
	}

	_, err = tx.Exec(ctx, `
		UPDATE public.import_sessions
		SET cancelled_at = NOW(), cancelled_by = $1
		WHERE id = $2
	`, cancelledBy, sessionID)
	if err != nil {
		return nil, fmt.Errorf("importLogRepo.CancelSession: mark cancelled: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("importLogRepo.CancelSession: commit: %w", err)
	}
	return res, nil
}
