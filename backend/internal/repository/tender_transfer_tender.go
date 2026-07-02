package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

type sourceTenderRow struct {
	ID, Title, ClientName, TenderNumber string
	Description, SubmissionDeadline     *string
	Version                             *int
	AreaClient, AreaSP                  *float64
	USDRate, EURRate, CNYRate           *float64
	UploadFolder, BSMLink               *string
	TZLink, QAFormLink                  *string
	MarkupTacticID                      *string
	ApplySubcontractWorksGrowth         *bool
	ApplySubcontractMatsGrowth          *bool
	HousingClass, ConstructionScope     *string
	ProjectFolderLink, VolumeTitle      *string
	IsArchived                          bool
}

// createNextTenderVersion runs Steps 2-4 of the version transfer: fetches the
// source tender (404 via ErrVersionTransfer if missing), computes the next
// version (409 if it already exists) and inserts the new tender row as a copy
// of the source. Returns the new tender id + version.
func createNextTenderVersion(
	ctx context.Context,
	tx pgx.Tx,
	sourceTenderID string,
) (string, int, error) {
	// Step 2: Fetch source tender — 404 if missing.
	const fetchSourceQ = `
		SELECT
			id::text, title, description, client_name, tender_number,
			submission_deadline::text, version,
			area_client, area_sp, usd_rate, eur_rate, cny_rate,
			upload_folder, bsm_link, tz_link, qa_form_link,
			markup_tactic_id::text,
			apply_subcontract_works_growth, apply_subcontract_materials_growth,
			housing_class::text, construction_scope::text, project_folder_link,
			is_archived, volume_title
		FROM public.tenders
		WHERE id = $1::uuid
	`

	var src sourceTenderRow
	if err := tx.QueryRow(ctx, fetchSourceQ, sourceTenderID).Scan(
		&src.ID, &src.Title, &src.Description, &src.ClientName, &src.TenderNumber,
		&src.SubmissionDeadline, &src.Version,
		&src.AreaClient, &src.AreaSP, &src.USDRate, &src.EURRate, &src.CNYRate,
		&src.UploadFolder, &src.BSMLink, &src.TZLink, &src.QAFormLink,
		&src.MarkupTacticID,
		&src.ApplySubcontractWorksGrowth, &src.ApplySubcontractMatsGrowth,
		&src.HousingClass, &src.ConstructionScope, &src.ProjectFolderLink,
		&src.IsArchived, &src.VolumeTitle,
	); err != nil {
		if err == pgx.ErrNoRows {
			return "", 0, &ErrVersionTransfer{
				HTTPStatus: 404,
				Message:    fmt.Sprintf("source tender %s not found", sourceTenderID),
			}
		}
		return "", 0, fmt.Errorf("transferRepo: fetch source tender: %w", err)
	}

	// Step 3: Compute next version — 409 if already exists.
	currentVersion := 0
	if src.Version != nil {
		currentVersion = *src.Version
	}
	newVersion := currentVersion + 1

	var versionExists bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM public.tenders
			WHERE tender_number = $1 AND version = $2
		)
	`, src.TenderNumber, newVersion).Scan(&versionExists); err != nil {
		return "", 0, fmt.Errorf("transferRepo: check version existence: %w", err)
	}
	if versionExists {
		return "", 0, &ErrVersionTransfer{
			HTTPStatus: 409,
			Message: fmt.Sprintf(
				"tender %s version %d already exists", src.TenderNumber, newVersion,
			),
		}
	}

	// Step 4: Insert new tender (copy of source, incremented version).
	const insertTenderQ = `
		INSERT INTO public.tenders (
			title, description, client_name, tender_number,
			submission_deadline, version, area_client, area_sp,
			usd_rate, eur_rate, cny_rate,
			upload_folder, bsm_link, tz_link, qa_form_link,
			markup_tactic_id,
			apply_subcontract_works_growth, apply_subcontract_materials_growth,
			housing_class, construction_scope, project_folder_link,
			is_archived, volume_title
		) VALUES (
			$1, $2, $3, $4,
			$5::timestamptz, $6, $7, $8,
			$9, $10, $11,
			$12, $13, $14, $15,
			$16::uuid,
			$17, $18,
			$19::public.housing_class_type, $20::public.construction_scope_type, $21,
			$22, $23
		)
		RETURNING id::text
	`

	var newTenderID string
	if err := tx.QueryRow(ctx, insertTenderQ,
		src.Title, src.Description, src.ClientName, src.TenderNumber,
		src.SubmissionDeadline, newVersion, src.AreaClient, src.AreaSP,
		src.USDRate, src.EURRate, src.CNYRate,
		src.UploadFolder, src.BSMLink, src.TZLink, src.QAFormLink,
		src.MarkupTacticID,
		src.ApplySubcontractWorksGrowth, src.ApplySubcontractMatsGrowth,
		src.HousingClass, src.ConstructionScope, src.ProjectFolderLink,
		src.IsArchived, src.VolumeTitle,
	).Scan(&newTenderID); err != nil {
		return "", 0, fmt.Errorf("transferRepo: insert new tender: %w", err)
	}

	return newTenderID, newVersion, nil
}
