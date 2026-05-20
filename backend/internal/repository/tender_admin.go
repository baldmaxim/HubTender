package repository

import (
	"context"
	"fmt"
	"time"
)

// AdminTenderPatch is the admin-modal patch shape (no ETag check, all fields).
type AdminTenderPatch struct {
	Title              *string    `json:"title"`
	Description        *string    `json:"description"`
	ClientName         *string    `json:"client_name"`
	TenderNumber       *string    `json:"tender_number"`
	SubmissionDeadline *time.Time `json:"submission_deadline"`
	Version            *int       `json:"version"`
	AreaClient         *float64   `json:"area_client"`
	AreaSP             *float64   `json:"area_sp"`
	USDRate            *float64   `json:"usd_rate"`
	EURRate            *float64   `json:"eur_rate"`
	CNYRate            *float64   `json:"cny_rate"`
	UploadFolder       *string    `json:"upload_folder"`
	BSMLink            *string    `json:"bsm_link"`
	TZLink             *string    `json:"tz_link"`
	QAFormLink         *string    `json:"qa_form_link"`
	ProjectFolderLink  *string    `json:"project_folder_link"`
	HousingClass       *string    `json:"housing_class"`
	ConstructionScope  *string    `json:"construction_scope"`
	IsArchived         *bool      `json:"is_archived"`
	MarkupTacticID     *string    `json:"markup_tactic_id"`
	VolumeTitle        *string    `json:"volume_title"`
}

// AdminPatchTender applies the non-nil fields. Used by the admin tenders page
// (no optimistic concurrency check — the existing PATCH with ETag remains for
// other callers).
func (r *TenderRepo) AdminPatchTender(ctx context.Context, id string, p AdminTenderPatch) error {
	args := []any{}
	setClauses := ""
	add := func(col string, val any) {
		if setClauses != "" {
			setClauses += ", "
		}
		setClauses += fmt.Sprintf("%s = $%d", col, len(args)+1)
		args = append(args, val)
	}
	if p.Title != nil {
		add("title", *p.Title)
	}
	if p.Description != nil {
		add("description", *p.Description)
	}
	if p.ClientName != nil {
		add("client_name", *p.ClientName)
	}
	if p.TenderNumber != nil {
		add("tender_number", *p.TenderNumber)
	}
	if p.SubmissionDeadline != nil {
		add("submission_deadline", *p.SubmissionDeadline)
	}
	if p.Version != nil {
		add("version", *p.Version)
	}
	if p.AreaClient != nil {
		add("area_client", *p.AreaClient)
	}
	if p.AreaSP != nil {
		add("area_sp", *p.AreaSP)
	}
	if p.USDRate != nil {
		add("usd_rate", *p.USDRate)
	}
	if p.EURRate != nil {
		add("eur_rate", *p.EURRate)
	}
	if p.CNYRate != nil {
		add("cny_rate", *p.CNYRate)
	}
	if p.UploadFolder != nil {
		add("upload_folder", *p.UploadFolder)
	}
	if p.BSMLink != nil {
		add("bsm_link", *p.BSMLink)
	}
	if p.TZLink != nil {
		add("tz_link", *p.TZLink)
	}
	if p.QAFormLink != nil {
		add("qa_form_link", *p.QAFormLink)
	}
	if p.ProjectFolderLink != nil {
		add("project_folder_link", *p.ProjectFolderLink)
	}
	if p.HousingClass != nil {
		add("housing_class", *p.HousingClass)
	}
	if p.ConstructionScope != nil {
		add("construction_scope", *p.ConstructionScope)
	}
	if p.IsArchived != nil {
		add("is_archived", *p.IsArchived)
	}
	if p.MarkupTacticID != nil {
		add("markup_tactic_id", *p.MarkupTacticID)
	}
	if p.VolumeTitle != nil {
		add("volume_title", *p.VolumeTitle)
	}
	if setClauses == "" {
		return nil
	}
	setClauses += ", updated_at = NOW()"
	args = append(args, id)
	q := fmt.Sprintf(`UPDATE public.tenders SET %s WHERE id = $%d`, setClauses, len(args))
	if _, err := r.pool.Exec(ctx, q, args...); err != nil {
		return fmt.Errorf("tenderRepo.AdminPatchTender: %w", err)
	}
	return nil
}

// DeleteTender removes the tender (cascade is handled by FKs).
func (r *TenderRepo) DeleteTender(ctx context.Context, id string) error {
	if _, err := r.pool.Exec(ctx, `DELETE FROM public.tenders WHERE id = $1`, id); err != nil {
		return fmt.Errorf("tenderRepo.DeleteTender: %w", err)
	}
	return nil
}
