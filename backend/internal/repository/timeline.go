package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

// TenderGroupRow mirrors public.tender_groups columns.
type TenderGroupRow struct {
	ID               string     `json:"id"`
	TenderID         string     `json:"tender_id"`
	Name             string     `json:"name"`
	Color            string     `json:"color"`
	SortOrder        int        `json:"sort_order"`
	QualityLevel     *int16     `json:"quality_level"`
	QualityComment   *string    `json:"quality_comment"`
	QualityUpdatedBy *string    `json:"quality_updated_by"`
	QualityUpdatedAt *time.Time `json:"quality_updated_at"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

// TenderIterationRow mirrors public.tender_iterations columns.
type TenderIterationRow struct {
	ID                  string     `json:"id"`
	GroupID             string     `json:"group_id"`
	UserID              string     `json:"user_id"`
	IterationNumber     int        `json:"iteration_number"`
	UserComment         string     `json:"user_comment"`
	UserAmount          *float64   `json:"user_amount"`
	ManagerID           *string    `json:"manager_id"`
	ManagerComment      *string    `json:"manager_comment"`
	ManagerRespondedAt  *time.Time `json:"manager_responded_at"`
	ApprovalStatus      string     `json:"approval_status"`
	SubmittedAt         time.Time  `json:"submitted_at"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

// ---------------------------------------------------------------------------
// Scan helpers
// ---------------------------------------------------------------------------

const groupScanCols = `
	id::text, tender_id::text, name, color, sort_order,
	quality_level, quality_comment, quality_updated_by::text, quality_updated_at,
	COALESCE(created_at, NOW()), COALESCE(updated_at, NOW())
`

func scanGroupRow(row interface{ Scan(...any) error }) (*TenderGroupRow, error) {
	var g TenderGroupRow
	if err := row.Scan(
		&g.ID, &g.TenderID, &g.Name, &g.Color, &g.SortOrder,
		&g.QualityLevel, &g.QualityComment, &g.QualityUpdatedBy, &g.QualityUpdatedAt,
		&g.CreatedAt, &g.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &g, nil
}

const iterScanCols = `
	id::text, group_id::text, user_id::text, iteration_number,
	user_comment, user_amount,
	manager_id::text, manager_comment, manager_responded_at, approval_status,
	submitted_at,
	COALESCE(created_at, NOW()), COALESCE(updated_at, NOW())
`

func scanIterRow(row interface{ Scan(...any) error }) (*TenderIterationRow, error) {
	var it TenderIterationRow
	if err := row.Scan(
		&it.ID, &it.GroupID, &it.UserID, &it.IterationNumber,
		&it.UserComment, &it.UserAmount,
		&it.ManagerID, &it.ManagerComment, &it.ManagerRespondedAt, &it.ApprovalStatus,
		&it.SubmittedAt,
		&it.CreatedAt, &it.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &it, nil
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

// TimelineRepo handles timeline table mutations (tender_groups, tender_iterations).
type TimelineRepo struct {
	pool *pgxpool.Pool
}

// NewTimelineRepo creates a TimelineRepo.
func NewTimelineRepo(pool *pgxpool.Pool) *TimelineRepo {
	return &TimelineRepo{pool: pool}
}

// SetGroupQuality updates quality fields on a tender_group, replicating
// public.set_tender_group_quality (lines 1524-1559).
// Returns pgx.ErrNoRows if no row matched.
func (r *TimelineRepo) SetGroupQuality(
	ctx context.Context,
	groupID string,
	qualityLevel *int16,
	qualityComment *string,
	updatedBy string,
) (*TenderGroupRow, error) {
	// Normalise comment: NULL if blank (matches NULLIF(TRIM(COALESCE(...)), '')).
	var comment *string
	if qualityComment != nil {
		trimmed := trimString(*qualityComment)
		if trimmed != "" {
			comment = &trimmed
		}
	}

	q := `
		UPDATE public.tender_groups
		SET quality_level      = $1,
		    quality_comment    = $2,
		    quality_updated_by = $3,
		    quality_updated_at = NOW()
		WHERE id = $4
		RETURNING ` + groupScanCols

	row := r.pool.QueryRow(ctx, q, qualityLevel, comment, updatedBy, groupID)
	g, err := scanGroupRow(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, pgx.ErrNoRows
		}
		return nil, fmt.Errorf("timelineRepo.SetGroupQuality: scan: %w", err)
	}
	return g, nil
}

// RespondIteration updates manager fields on a tender_iteration, replicating
// public.respond_tender_iteration (lines 1479-1510).
// Privilege check is done at the service layer.
// Returns pgx.ErrNoRows if no row matched.
func (r *TimelineRepo) RespondIteration(
	ctx context.Context,
	iterationID string,
	managerID string,
	managerComment string,
	approvalStatus string,
) (*TenderIterationRow, error) {
	q := `
		UPDATE public.tender_iterations
		SET manager_id           = $1,
		    manager_comment      = $2,
		    manager_responded_at = NOW(),
		    approval_status      = $3
		WHERE id = $4
		RETURNING ` + iterScanCols

	row := r.pool.QueryRow(ctx, q, managerID, managerComment, approvalStatus, iterationID)
	it, err := scanIterRow(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, pgx.ErrNoRows
		}
		return nil, fmt.Errorf("timelineRepo.RespondIteration: scan: %w", err)
	}
	return it, nil
}

// GetUserRoleCode returns the role_code for a user from public.users.
// Used by TimelineService for privilege checks.
func (r *TimelineRepo) GetUserRoleCode(ctx context.Context, userID string) (string, error) {
	var code string
	err := r.pool.QueryRow(ctx,
		`SELECT role_code FROM public.users WHERE id = $1`, userID,
	).Scan(&code)
	if err != nil {
		return "", fmt.Errorf("timelineRepo.GetUserRoleCode: %w", err)
	}
	return code, nil
}

// trimString is a lightweight strings.TrimSpace without importing strings.
func trimString(s string) string {
	// Use a byte loop to avoid an extra import — only trims ASCII whitespace.
	start, end := 0, len(s)
	for start < end && isSpace(s[start]) {
		start++
	}
	for end > start && isSpace(s[end-1]) {
		end--
	}
	return s[start:end]
}

func isSpace(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r'
}
