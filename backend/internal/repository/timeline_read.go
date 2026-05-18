package repository

import (
	"context"
	"fmt"
	"time"
)

// ---------------------------------------------------------------------------
// Read-side shapes for the TenderTimeline page (replacing the nested
// supabase.from() selects in useTenders / useTenderGroups / useTenderIterations).
// The heavy normalisation/scoring stays client-side; these endpoints only
// move the data fetch off PostgREST.
// ---------------------------------------------------------------------------

// TimelineIterationWithRefs is one tender_iterations row plus its user and
// manager refs (mirrors the user:/manager: PostgREST embeds).
type TimelineIterationWithRefs struct {
	TenderIterationRow
	User    *TimelineUserRef `json:"user"`
	Manager *TimelineUserRef `json:"manager"`
}

// TimelineGroupMember mirrors a tender_group_members row + embedded user.
type TimelineGroupMember struct {
	ID        string           `json:"id"`
	GroupID   string           `json:"group_id"`
	UserID    string           `json:"user_id"`
	CreatedAt time.Time        `json:"created_at"`
	User      *TimelineUserRef `json:"user"`
}

// TimelineGroupIterShort is the iteration subset used for group status.
type TimelineGroupIterShort struct {
	ID              string `json:"id"`
	UserID          string `json:"user_id"`
	ApprovalStatus  string `json:"approval_status"`
	IterationNumber int    `json:"iteration_number"`
}

// TimelineGroupWithRelations is a tender_groups row + members + iter subset.
type TimelineGroupWithRelations struct {
	TenderGroupRow
	TenderGroupMembers []TimelineGroupMember    `json:"tender_group_members"`
	TenderIterations   []TimelineGroupIterShort `json:"tender_iterations"`
}

// TimelineRegistryRow is the tender_registry subset the timeline list needs.
type TimelineRegistryRow struct {
	ID             string     `json:"id"`
	Title          string     `json:"title"`
	TenderNumber   *string    `json:"tender_number"`
	SubmissionDate *time.Time `json:"submission_date"`
	SortOrder      int        `json:"sort_order"`
	IsArchived     bool       `json:"is_archived"`
}

// TimelineTenderIterShort is the iteration subset used for tender scoring.
type TimelineTenderIterShort struct {
	ID                 string     `json:"id"`
	UserID             string     `json:"user_id"`
	IterationNumber    int        `json:"iteration_number"`
	ApprovalStatus     string     `json:"approval_status"`
	SubmittedAt        time.Time  `json:"submitted_at"`
	ManagerRespondedAt *time.Time `json:"manager_responded_at"`
}

// TimelineTenderGroup is a tender_groups subset with its iteration scores.
type TimelineTenderGroup struct {
	ID               string                    `json:"id"`
	Name             string                    `json:"name"`
	Color            string                    `json:"color"`
	QualityLevel     *int16                    `json:"quality_level"`
	TenderIterations []TimelineTenderIterShort `json:"tender_iterations"`
}

// TimelineTender is the tenders subset with nested groups/iterations.
type TimelineTender struct {
	ID                 string                `json:"id"`
	Title              string                `json:"title"`
	TenderNumber       string                `json:"tender_number"`
	SubmissionDeadline *time.Time            `json:"submission_deadline"`
	IsArchived         *bool                 `json:"is_archived"`
	Version            *int                  `json:"version"`
	CreatedAt          time.Time             `json:"created_at"`
	TenderGroups       []TimelineTenderGroup `json:"tender_groups"`
}

// TimelineTendersPayload is the GET /api/v1/timeline/tenders response.
type TimelineTendersPayload struct {
	Registry []TimelineRegistryRow `json:"registry"`
	Tenders  []TimelineTender      `json:"tenders"`
}

// ListGroupIterations returns iterations for (groupID, userID) ordered by
// iteration_number, each with user and manager refs.
func (r *TimelineRepo) ListGroupIterations(
	ctx context.Context,
	groupID, userID string,
) ([]TimelineIterationWithRefs, error) {
	q := `
		SELECT ` + iterScanColsPrefixed("ti") + `,
		       u.id::text, u.full_name, u.role_code,
		       m.id::text, m.full_name, m.role_code
		FROM public.tender_iterations ti
		LEFT JOIN public.users u ON u.id = ti.user_id
		LEFT JOIN public.users m ON m.id = ti.manager_id
		WHERE ti.group_id = $1 AND ti.user_id = $2
		ORDER BY ti.iteration_number ASC
	`
	rows, err := r.pool.Query(ctx, q, groupID, userID)
	if err != nil {
		return nil, fmt.Errorf("timelineRepo.ListGroupIterations: %w", err)
	}
	defer rows.Close()

	out := make([]TimelineIterationWithRefs, 0)
	for rows.Next() {
		var it TenderIterationRow
		var uID, uName, uRole *string
		var mID, mName, mRole *string
		if err := rows.Scan(
			&it.ID, &it.GroupID, &it.UserID, &it.IterationNumber,
			&it.UserComment, &it.UserAmount,
			&it.ManagerID, &it.ManagerComment, &it.ManagerRespondedAt, &it.ApprovalStatus,
			&it.SubmittedAt, &it.CreatedAt, &it.UpdatedAt,
			&uID, &uName, &uRole,
			&mID, &mName, &mRole,
		); err != nil {
			return nil, fmt.Errorf("timelineRepo.ListGroupIterations scan: %w", err)
		}
		rec := TimelineIterationWithRefs{TenderIterationRow: it}
		if uID != nil {
			rec.User = &TimelineUserRef{ID: *uID, FullName: derefStr(uName), RoleCode: derefStr(uRole)}
		}
		if mID != nil {
			rec.Manager = &TimelineUserRef{ID: *mID, FullName: derefStr(mName), RoleCode: derefStr(mRole)}
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("timelineRepo.ListGroupIterations rows: %w", err)
	}
	return out, nil
}

// ListTenderGroups returns the groups for a tender (ordered by sort_order),
// each with its members (+user) and an iteration subset for status.
func (r *TimelineRepo) ListTenderGroups(
	ctx context.Context,
	tenderID string,
) ([]TimelineGroupWithRelations, error) {
	groupRows, err := r.pool.Query(ctx,
		`SELECT `+groupScanCols+` FROM public.tender_groups WHERE tender_id = $1 ORDER BY sort_order ASC`,
		tenderID,
	)
	if err != nil {
		return nil, fmt.Errorf("timelineRepo.ListTenderGroups: groups: %w", err)
	}
	defer groupRows.Close()

	out := make([]TimelineGroupWithRelations, 0)
	byID := make(map[string]int) // group id -> index in out
	groupIDs := make([]string, 0)
	for groupRows.Next() {
		g, scanErr := scanGroupRow(groupRows)
		if scanErr != nil {
			return nil, fmt.Errorf("timelineRepo.ListTenderGroups scan: %w", scanErr)
		}
		byID[g.ID] = len(out)
		groupIDs = append(groupIDs, g.ID)
		out = append(out, TimelineGroupWithRelations{
			TenderGroupRow:     *g,
			TenderGroupMembers: []TimelineGroupMember{},
			TenderIterations:   []TimelineGroupIterShort{},
		})
	}
	if err := groupRows.Err(); err != nil {
		return nil, fmt.Errorf("timelineRepo.ListTenderGroups groups rows: %w", err)
	}
	if len(out) == 0 {
		return out, nil
	}

	memberRows, err := r.pool.Query(ctx, `
		SELECT tgm.id::text, tgm.group_id::text, tgm.user_id::text, tgm.created_at,
		       u.id::text, u.full_name, u.role_code
		FROM public.tender_group_members tgm
		LEFT JOIN public.users u ON u.id = tgm.user_id
		WHERE tgm.group_id = ANY($1::uuid[])
	`, groupIDs)
	if err != nil {
		return nil, fmt.Errorf("timelineRepo.ListTenderGroups: members: %w", err)
	}
	for memberRows.Next() {
		var m TimelineGroupMember
		var uID, uName, uRole *string
		if err := memberRows.Scan(&m.ID, &m.GroupID, &m.UserID, &m.CreatedAt,
			&uID, &uName, &uRole); err != nil {
			memberRows.Close()
			return nil, fmt.Errorf("timelineRepo.ListTenderGroups members scan: %w", err)
		}
		if uID != nil {
			m.User = &TimelineUserRef{ID: *uID, FullName: derefStr(uName), RoleCode: derefStr(uRole)}
		}
		if idx, ok := byID[m.GroupID]; ok {
			out[idx].TenderGroupMembers = append(out[idx].TenderGroupMembers, m)
		}
	}
	if err := memberRows.Err(); err != nil {
		memberRows.Close()
		return nil, fmt.Errorf("timelineRepo.ListTenderGroups members rows: %w", err)
	}
	memberRows.Close()

	iterRows, err := r.pool.Query(ctx, `
		SELECT id::text, group_id::text, user_id::text, approval_status, iteration_number
		FROM public.tender_iterations
		WHERE group_id = ANY($1::uuid[])
	`, groupIDs)
	if err != nil {
		return nil, fmt.Errorf("timelineRepo.ListTenderGroups: iters: %w", err)
	}
	defer iterRows.Close()
	for iterRows.Next() {
		var groupID string
		var it TimelineGroupIterShort
		if err := iterRows.Scan(&it.ID, &groupID, &it.UserID, &it.ApprovalStatus, &it.IterationNumber); err != nil {
			return nil, fmt.Errorf("timelineRepo.ListTenderGroups iters scan: %w", err)
		}
		if idx, ok := byID[groupID]; ok {
			out[idx].TenderIterations = append(out[idx].TenderIterations, it)
		}
	}
	if err := iterRows.Err(); err != nil {
		return nil, fmt.Errorf("timelineRepo.ListTenderGroups iters rows: %w", err)
	}
	return out, nil
}

// ListTimelineTenders returns the tender_registry list plus every tender
// (whose tender_number appears in the registry) with nested groups and
// iteration scores. All normalisation/scoring stays client-side.
func (r *TimelineRepo) ListTimelineTenders(ctx context.Context) (*TimelineTendersPayload, error) {
	out := &TimelineTendersPayload{
		Registry: []TimelineRegistryRow{},
		Tenders:  []TimelineTender{},
	}

	regRows, err := r.pool.Query(ctx, `
		SELECT id::text, title, tender_number, submission_date, sort_order, is_archived
		FROM public.tender_registry
		ORDER BY sort_order ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("timelineRepo.ListTimelineTenders: registry: %w", err)
	}
	numberSet := make(map[string]struct{})
	for regRows.Next() {
		var rr TimelineRegistryRow
		if err := regRows.Scan(&rr.ID, &rr.Title, &rr.TenderNumber,
			&rr.SubmissionDate, &rr.SortOrder, &rr.IsArchived); err != nil {
			regRows.Close()
			return nil, fmt.Errorf("timelineRepo.ListTimelineTenders registry scan: %w", err)
		}
		if rr.TenderNumber != nil && *rr.TenderNumber != "" {
			numberSet[*rr.TenderNumber] = struct{}{}
		}
		out.Registry = append(out.Registry, rr)
	}
	if err := regRows.Err(); err != nil {
		regRows.Close()
		return nil, fmt.Errorf("timelineRepo.ListTimelineTenders registry rows: %w", err)
	}
	regRows.Close()

	if len(numberSet) == 0 {
		return out, nil
	}
	numbers := make([]string, 0, len(numberSet))
	for n := range numberSet {
		numbers = append(numbers, n)
	}

	tenderRows, err := r.pool.Query(ctx, `
		SELECT id::text, title, tender_number, submission_deadline,
		       is_archived, version, created_at
		FROM public.tenders
		WHERE tender_number = ANY($1::text[])
	`, numbers)
	if err != nil {
		return nil, fmt.Errorf("timelineRepo.ListTimelineTenders: tenders: %w", err)
	}
	tenderIdx := make(map[string]int)
	for tenderRows.Next() {
		var t TimelineTender
		if err := tenderRows.Scan(&t.ID, &t.Title, &t.TenderNumber,
			&t.SubmissionDeadline, &t.IsArchived, &t.Version, &t.CreatedAt); err != nil {
			tenderRows.Close()
			return nil, fmt.Errorf("timelineRepo.ListTimelineTenders tenders scan: %w", err)
		}
		t.TenderGroups = []TimelineTenderGroup{}
		tenderIdx[t.ID] = len(out.Tenders)
		out.Tenders = append(out.Tenders, t)
	}
	if err := tenderRows.Err(); err != nil {
		tenderRows.Close()
		return nil, fmt.Errorf("timelineRepo.ListTimelineTenders tenders rows: %w", err)
	}
	tenderRows.Close()

	if len(out.Tenders) == 0 {
		return out, nil
	}
	tenderIDs := make([]string, 0, len(out.Tenders))
	for _, t := range out.Tenders {
		tenderIDs = append(tenderIDs, t.ID)
	}

	groupRows, err := r.pool.Query(ctx, `
		SELECT id::text, tender_id::text, name, color, quality_level
		FROM public.tender_groups
		WHERE tender_id = ANY($1::uuid[])
	`, tenderIDs)
	if err != nil {
		return nil, fmt.Errorf("timelineRepo.ListTimelineTenders: groups: %w", err)
	}
	groupTender := make(map[string]string) // group id -> tender id
	groupSlot := make(map[string]int)      // group id -> index in tender's TenderGroups
	for groupRows.Next() {
		var gID, tID string
		var g TimelineTenderGroup
		if err := groupRows.Scan(&gID, &tID, &g.Name, &g.Color, &g.QualityLevel); err != nil {
			groupRows.Close()
			return nil, fmt.Errorf("timelineRepo.ListTimelineTenders groups scan: %w", err)
		}
		g.ID = gID
		g.TenderIterations = []TimelineTenderIterShort{}
		if idx, ok := tenderIdx[tID]; ok {
			groupTender[gID] = tID
			groupSlot[gID] = len(out.Tenders[idx].TenderGroups)
			out.Tenders[idx].TenderGroups = append(out.Tenders[idx].TenderGroups, g)
		}
	}
	if err := groupRows.Err(); err != nil {
		groupRows.Close()
		return nil, fmt.Errorf("timelineRepo.ListTimelineTenders groups rows: %w", err)
	}
	groupRows.Close()

	if len(groupTender) == 0 {
		return out, nil
	}
	groupIDs := make([]string, 0, len(groupTender))
	for gID := range groupTender {
		groupIDs = append(groupIDs, gID)
	}

	iterRows, err := r.pool.Query(ctx, `
		SELECT id::text, group_id::text, user_id::text, iteration_number,
		       approval_status, submitted_at, manager_responded_at
		FROM public.tender_iterations
		WHERE group_id = ANY($1::uuid[])
	`, groupIDs)
	if err != nil {
		return nil, fmt.Errorf("timelineRepo.ListTimelineTenders: iters: %w", err)
	}
	defer iterRows.Close()
	for iterRows.Next() {
		var gID string
		var it TimelineTenderIterShort
		if err := iterRows.Scan(&it.ID, &gID, &it.UserID, &it.IterationNumber,
			&it.ApprovalStatus, &it.SubmittedAt, &it.ManagerRespondedAt); err != nil {
			return nil, fmt.Errorf("timelineRepo.ListTimelineTenders iters scan: %w", err)
		}
		tID, ok := groupTender[gID]
		if !ok {
			continue
		}
		tIdx := tenderIdx[tID]
		gSlot := groupSlot[gID]
		out.Tenders[tIdx].TenderGroups[gSlot].TenderIterations =
			append(out.Tenders[tIdx].TenderGroups[gSlot].TenderIterations, it)
	}
	if err := iterRows.Err(); err != nil {
		return nil, fmt.Errorf("timelineRepo.ListTimelineTenders iters rows: %w", err)
	}
	return out, nil
}

// iterScanColsPrefixed returns iterScanCols with every column prefixed by the
// given table alias (the shared iterScanCols is unqualified).
func iterScanColsPrefixed(alias string) string {
	return alias + `.id::text, ` + alias + `.group_id::text, ` + alias + `.user_id::text, ` +
		alias + `.iteration_number, ` + alias + `.user_comment, ` + alias + `.user_amount, ` +
		alias + `.manager_id::text, ` + alias + `.manager_comment, ` + alias + `.manager_responded_at, ` +
		alias + `.approval_status, ` + alias + `.submitted_at, ` +
		`COALESCE(` + alias + `.created_at, NOW()), COALESCE(` + alias + `.updated_at, NOW())`
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
