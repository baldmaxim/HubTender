package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CloneResult mirrors the JSONB returned by
// public.clone_tender_as_new_version. Field names are verbatim from the
// SQL function's jsonb_build_object.
type CloneResult struct {
	TenderID                    string `json:"tenderId"`
	Version                     int    `json:"version"`
	PositionsCopied             int    `json:"positionsCopied"`
	PositionParentLinksRestored int    `json:"positionParentLinksRestored"`
	BoqItemsCopied              int    `json:"boqItemsCopied"`
	ParentLinksRestored         int    `json:"parentLinksRestored"`
	CostVolumesCopied           int    `json:"costVolumesCopied"`
	InsuranceRowsCopied         int    `json:"insuranceRowsCopied"`
	SubcontractExclusionsCopied int    `json:"subcontractExclusionsCopied"`
	PricingDistributionCopied   int    `json:"pricingDistributionCopied"`
	MarkupPercentageCopied      int    `json:"markupPercentageCopied"`
	DocumentsCopied             int    `json:"documentsCopied"`
	NotesCopied                 int    `json:"notesCopied"`
	GroupsCopied                int    `json:"groupsCopied"`
}

// ErrClone is a typed error carrying an HTTP status so the handler can
// dispatch 404 vs 500 without string matching at the handler layer.
type ErrClone struct {
	HTTPStatus int
	Message    string
}

func (e *ErrClone) Error() string { return e.Message }

// CloneRepo invokes the public.clone_tender_as_new_version SQL function.
// The whole clone runs atomically inside that function (single statement).
type CloneRepo struct {
	pool *pgxpool.Pool
}

// NewCloneRepo creates a CloneRepo.
func NewCloneRepo(pool *pgxpool.Pool) *CloneRepo {
	return &CloneRepo{pool: pool}
}

// CloneTender calls public.clone_tender_as_new_version(p_source_tender_id)
// and decodes its JSONB result. A missing source tender surfaces as the
// function's RAISE EXCEPTION ('Source tender % not found') → mapped to 404.
func (r *CloneRepo) CloneTender(ctx context.Context, sourceTenderID string) (*CloneResult, error) {
	var raw []byte
	err := r.pool.QueryRow(ctx,
		`SELECT public.clone_tender_as_new_version($1::uuid)`,
		sourceTenderID,
	).Scan(&raw)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			if strings.Contains(strings.ToLower(pgErr.Message), "not found") {
				return nil, &ErrClone{HTTPStatus: 404, Message: pgErr.Message}
			}
			return nil, &ErrClone{HTTPStatus: 500, Message: pgErr.Message}
		}
		return nil, fmt.Errorf("cloneRepo.CloneTender: %w", err)
	}

	var res CloneResult
	if err := json.Unmarshal(raw, &res); err != nil {
		return nil, fmt.Errorf("cloneRepo.CloneTender: decode result: %w", err)
	}
	return &res, nil
}
