package repository

import (
	"context"
	"fmt"
	"time"
)

// ---------------------------------------------------------------------------
// Write input types
// ---------------------------------------------------------------------------

// CreateTenderInput holds validated fields for inserting a new tender.
type CreateTenderInput struct {
	TenderNumber       string
	Title              string
	ClientName         string
	HousingClass       *string
	ConstructionScope  *string
	USDRate            *float64
	EURRate            *float64
	CNYRate            *float64
	SubmissionDeadline *time.Time
	Description        *string
	CreatedBy          string // auth.users UUID
}

// UpdateTenderInput holds validated fields for patching a tender.
// Only non-nil pointer fields are applied so callers distinguish
// "not provided" from "set to empty string".
type UpdateTenderInput struct {
	TenderNumber       *string
	Title              *string
	ClientName         *string
	HousingClass       *string
	ConstructionScope  *string
	USDRate            *float64
	EURRate            *float64
	CNYRate            *float64
	SubmissionDeadline *time.Time
	Description        *string
}

// ---------------------------------------------------------------------------
// Shared column list for TenderRow scans
// ---------------------------------------------------------------------------

const tenderScanCols = `
	id::text, tender_number, title, client_name,
	housing_class::text, construction_scope::text,
	is_archived, cached_grand_total,
	usd_rate, eur_rate, cny_rate,
	COALESCE(created_at,NOW()), COALESCE(updated_at,NOW())
`

func scanTenderRow(row interface{ Scan(...any) error }) (*TenderRow, error) {
	var t TenderRow
	if err := row.Scan(
		&t.ID, &t.TenderNumber, &t.Title, &t.ClientName,
		&t.HousingClass, &t.ConstructionScope,
		&t.IsArchived, &t.CachedGrandTotal,
		&t.USDRate, &t.EURRate, &t.CNYRate,
		&t.CreatedAt, &t.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &t, nil
}

// GetTenderByID fetches a single TenderRow by primary key.
func (r *TenderRepo) GetTenderByID(ctx context.Context, id string) (*TenderRow, error) {
	q := "SELECT " + tenderScanCols + " FROM public.tenders WHERE id = $1"
	t, err := scanTenderRow(r.pool.QueryRow(ctx, q, id))
	if err != nil {
		return nil, fmt.Errorf("tenderRepo.GetTenderByID: scan: %w", err)
	}
	return t, nil
}

// CreateTender inserts a new tender and returns the created row.
func (r *TenderRepo) CreateTender(ctx context.Context, in CreateTenderInput) (*TenderRow, error) {
	q := `
		INSERT INTO public.tenders
		    (tender_number, title, client_name, housing_class, construction_scope,
		     usd_rate, eur_rate, cny_rate, submission_deadline, description, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING ` + tenderScanCols
	t, err := scanTenderRow(r.pool.QueryRow(ctx, q,
		in.TenderNumber, in.Title, in.ClientName,
		in.HousingClass, in.ConstructionScope,
		in.USDRate, in.EURRate, in.CNYRate,
		in.SubmissionDeadline, in.Description,
		in.CreatedBy,
	))
	if err != nil {
		return nil, fmt.Errorf("tenderRepo.CreateTender: scan: %w", err)
	}
	return t, nil
}

// UpdateTender applies non-nil fields from in to the tender row and returns
// the updated row. Optimistic concurrency (If-Match) is enforced by the
// handler before this method is called.
func (r *TenderRepo) UpdateTender(ctx context.Context, id string, in UpdateTenderInput) (*TenderRow, error) {
	args := []any{}
	argN := 1
	setClauses := ""

	set := func(col string, val any) {
		if setClauses != "" {
			setClauses += ", "
		}
		setClauses += fmt.Sprintf("%s = $%d", col, argN)
		args = append(args, val)
		argN++
	}

	if in.TenderNumber != nil {
		set("tender_number", *in.TenderNumber)
	}
	if in.Title != nil {
		set("title", *in.Title)
	}
	if in.ClientName != nil {
		set("client_name", *in.ClientName)
	}
	if in.HousingClass != nil {
		set("housing_class", *in.HousingClass)
	}
	if in.ConstructionScope != nil {
		set("construction_scope", *in.ConstructionScope)
	}
	if in.USDRate != nil {
		set("usd_rate", *in.USDRate)
	}
	if in.EURRate != nil {
		set("eur_rate", *in.EURRate)
	}
	if in.CNYRate != nil {
		set("cny_rate", *in.CNYRate)
	}
	if in.SubmissionDeadline != nil {
		set("submission_deadline", *in.SubmissionDeadline)
	}
	if in.Description != nil {
		set("description", *in.Description)
	}

	if setClauses == "" {
		return r.GetTenderByID(ctx, id)
	}

	setClauses += ", updated_at = NOW()"
	args = append(args, id)

	q := fmt.Sprintf("UPDATE public.tenders SET %s WHERE id = $%d RETURNING "+tenderScanCols,
		setClauses, argN)
	t, err := scanTenderRow(r.pool.QueryRow(ctx, q, args...))
	if err != nil {
		return nil, fmt.Errorf("tenderRepo.UpdateTender: scan: %w", err)
	}
	return t, nil
}
