package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ExpectedGroup is one row in the desired layout for ReconcileTenderGroups.
type ExpectedGroup struct {
	Name      string   `json:"name"`
	Color     string   `json:"color"`
	SortOrder int      `json:"sort_order"`
	UserIDs   []string `json:"user_ids"`
}

// ReconcileTenderGroups applies the expected layout for the given tender in
// one transaction: upserts each group, cleans iteration/membership rows for
// excludedUserIDs, adds missing members and removes ones not in the expected
// set (iteration owners are protected from removal).
//
// The set of groups touched is exactly the names in expected — other groups
// for the tender are left untouched (legacy behaviour).
func (r *TimelineRepo) ReconcileTenderGroups(
	ctx context.Context, tenderID string, excludedUserIDs []string, expected []ExpectedGroup,
) error {
	if tenderID == "" {
		return errors.New("timelineRepo.ReconcileTenderGroups: tender_id required")
	}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("timelineRepo.ReconcileTenderGroups: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Existing groups for the tender, keyed by name.
	type existing struct {
		ID        string
		Color     string
		SortOrder int
	}
	groupRows, err := tx.Query(ctx, `
		SELECT id::text, name, color, sort_order
		FROM public.tender_groups
		WHERE tender_id = $1
	`, tenderID)
	if err != nil {
		return fmt.Errorf("timelineRepo.ReconcileTenderGroups: load groups: %w", err)
	}
	existingByName := make(map[string]existing)
	func() {
		defer groupRows.Close()
		for groupRows.Next() {
			var id, name, color string
			var sortOrder int
			if err = groupRows.Scan(&id, &name, &color, &sortOrder); err != nil {
				return
			}
			existingByName[name] = existing{ID: id, Color: color, SortOrder: sortOrder}
		}
		err = groupRows.Err()
	}()
	if err != nil {
		return fmt.Errorf("timelineRepo.ReconcileTenderGroups: scan groups: %w", err)
	}

	for _, exp := range expected {
		var groupID string
		if cur, ok := existingByName[exp.Name]; ok {
			groupID = cur.ID
			if cur.Color != exp.Color || cur.SortOrder != exp.SortOrder {
				if _, err := tx.Exec(ctx, `
					UPDATE public.tender_groups
					   SET color = $1, sort_order = $2, updated_at = NOW()
					 WHERE id = $3
				`, exp.Color, exp.SortOrder, cur.ID); err != nil {
					return fmt.Errorf("timelineRepo.ReconcileTenderGroups: update group: %w", err)
				}
			}
		} else {
			if err := tx.QueryRow(ctx, `
				INSERT INTO public.tender_groups (tender_id, name, color, sort_order)
				VALUES ($1, $2, $3, $4)
				RETURNING id::text
			`, tenderID, exp.Name, exp.Color, exp.SortOrder).Scan(&groupID); err != nil {
				return fmt.Errorf("timelineRepo.ReconcileTenderGroups: insert group: %w", err)
			}
		}

		// Cleanup excluded users from iterations + members.
		if len(excludedUserIDs) > 0 {
			if _, err := tx.Exec(ctx, `
				DELETE FROM public.tender_iterations
				 WHERE group_id = $1 AND user_id = ANY($2::uuid[])
			`, groupID, excludedUserIDs); err != nil {
				return fmt.Errorf("timelineRepo.ReconcileTenderGroups: delete iterations: %w", err)
			}
			if _, err := tx.Exec(ctx, `
				DELETE FROM public.tender_group_members
				 WHERE group_id = $1 AND user_id = ANY($2::uuid[])
			`, groupID, excludedUserIDs); err != nil {
				return fmt.Errorf("timelineRepo.ReconcileTenderGroups: delete excluded members: %w", err)
			}
		}

		// Current state after cleanup.
		var currentMemberIDs []string
		mRows, err := tx.Query(ctx,
			`SELECT user_id::text FROM public.tender_group_members WHERE group_id = $1`, groupID)
		if err != nil {
			return fmt.Errorf("timelineRepo.ReconcileTenderGroups: load members: %w", err)
		}
		func() {
			defer mRows.Close()
			for mRows.Next() {
				var uid string
				if err = mRows.Scan(&uid); err != nil {
					return
				}
				currentMemberIDs = append(currentMemberIDs, uid)
			}
			err = mRows.Err()
		}()
		if err != nil {
			return fmt.Errorf("timelineRepo.ReconcileTenderGroups: scan members: %w", err)
		}

		var iterationUserIDs []string
		iRows, err := tx.Query(ctx,
			`SELECT DISTINCT user_id::text FROM public.tender_iterations WHERE group_id = $1`, groupID)
		if err != nil {
			return fmt.Errorf("timelineRepo.ReconcileTenderGroups: load iter users: %w", err)
		}
		func() {
			defer iRows.Close()
			for iRows.Next() {
				var uid string
				if err = iRows.Scan(&uid); err != nil {
					return
				}
				iterationUserIDs = append(iterationUserIDs, uid)
			}
			err = iRows.Err()
		}()
		if err != nil {
			return fmt.Errorf("timelineRepo.ReconcileTenderGroups: scan iter users: %w", err)
		}

		expectedSet := make(map[string]bool, len(exp.UserIDs))
		for _, uid := range exp.UserIDs {
			expectedSet[uid] = true
		}
		currentSet := make(map[string]bool, len(currentMemberIDs))
		for _, uid := range currentMemberIDs {
			currentSet[uid] = true
		}
		protectedSet := make(map[string]bool, len(iterationUserIDs))
		for _, uid := range iterationUserIDs {
			protectedSet[uid] = true
		}

		var toAdd, toRemove []string
		for _, uid := range exp.UserIDs {
			if !currentSet[uid] {
				toAdd = append(toAdd, uid)
			}
		}
		for _, uid := range currentMemberIDs {
			if !expectedSet[uid] && !protectedSet[uid] {
				toRemove = append(toRemove, uid)
			}
		}

		if len(toAdd) > 0 {
			batch := &pgx.Batch{}
			for _, uid := range toAdd {
				batch.Queue(`
					INSERT INTO public.tender_group_members (group_id, user_id)
					VALUES ($1, $2)
					ON CONFLICT (group_id, user_id) DO NOTHING
				`, groupID, uid)
			}
			br := tx.SendBatch(ctx, batch)
			for range toAdd {
				if _, err := br.Exec(); err != nil {
					_ = br.Close()
					return fmt.Errorf("timelineRepo.ReconcileTenderGroups: insert member: %w", err)
				}
			}
			if err := br.Close(); err != nil {
				return fmt.Errorf("timelineRepo.ReconcileTenderGroups: close add batch: %w", err)
			}
		}

		if len(toRemove) > 0 {
			if _, err := tx.Exec(ctx, `
				DELETE FROM public.tender_group_members
				 WHERE group_id = $1 AND user_id = ANY($2::uuid[])
			`, groupID, toRemove); err != nil {
				return fmt.Errorf("timelineRepo.ReconcileTenderGroups: delete unwanted: %w", err)
			}
		}
	}

	return tx.Commit(ctx)
}
