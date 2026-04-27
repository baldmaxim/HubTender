package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// InsuranceRow mirrors public.tender_insurance columns consumed by the
// FinancialIndicators / Admin/Insurance pages.
type InsuranceRow struct {
	JudicialPct      float64 `json:"judicial_pct"`
	TotalPct         float64 `json:"total_pct"`
	AptPriceM2       float64 `json:"apt_price_m2"`
	AptArea          float64 `json:"apt_area"`
	ParkingPriceM2   float64 `json:"parking_price_m2"`
	ParkingArea      float64 `json:"parking_area"`
	StoragePriceM2   float64 `json:"storage_price_m2"`
	StorageArea      float64 `json:"storage_area"`
}

// InsuranceRepo handles tender_insurance reads + upserts.
type InsuranceRepo struct {
	pool *pgxpool.Pool
}

// NewInsuranceRepo creates an InsuranceRepo.
func NewInsuranceRepo(pool *pgxpool.Pool) *InsuranceRepo {
	return &InsuranceRepo{pool: pool}
}

// Get returns the insurance row for the tender. Returns (nil, nil) when
// no row exists (the page treats this as "all zeros").
func (r *InsuranceRepo) Get(ctx context.Context, tenderID string) (*InsuranceRow, error) {
	var row InsuranceRow
	err := r.pool.QueryRow(ctx, `
		SELECT
			COALESCE(judicial_pct, 0),
			COALESCE(total_pct, 0),
			COALESCE(apt_price_m2, 0),
			COALESCE(apt_area, 0),
			COALESCE(parking_price_m2, 0),
			COALESCE(parking_area, 0),
			COALESCE(storage_price_m2, 0),
			COALESCE(storage_area, 0)
		FROM public.tender_insurance
		WHERE tender_id = $1
	`, tenderID).Scan(
		&row.JudicialPct,
		&row.TotalPct,
		&row.AptPriceM2,
		&row.AptArea,
		&row.ParkingPriceM2,
		&row.ParkingArea,
		&row.StoragePriceM2,
		&row.StorageArea,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("insuranceRepo.Get: %w", err)
	}
	return &row, nil
}

// Upsert inserts a new row or updates the existing one for the tender.
// Conflict target is tender_id (unique). Returns the persisted row.
func (r *InsuranceRepo) Upsert(ctx context.Context, tenderID string, in InsuranceRow) (*InsuranceRow, error) {
	var out InsuranceRow
	err := r.pool.QueryRow(ctx, `
		INSERT INTO public.tender_insurance (
			tender_id,
			judicial_pct, total_pct,
			apt_price_m2, apt_area,
			parking_price_m2, parking_area,
			storage_price_m2, storage_area
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (tender_id) DO UPDATE SET
			judicial_pct = EXCLUDED.judicial_pct,
			total_pct = EXCLUDED.total_pct,
			apt_price_m2 = EXCLUDED.apt_price_m2,
			apt_area = EXCLUDED.apt_area,
			parking_price_m2 = EXCLUDED.parking_price_m2,
			parking_area = EXCLUDED.parking_area,
			storage_price_m2 = EXCLUDED.storage_price_m2,
			storage_area = EXCLUDED.storage_area
		RETURNING
			COALESCE(judicial_pct, 0),
			COALESCE(total_pct, 0),
			COALESCE(apt_price_m2, 0),
			COALESCE(apt_area, 0),
			COALESCE(parking_price_m2, 0),
			COALESCE(parking_area, 0),
			COALESCE(storage_price_m2, 0),
			COALESCE(storage_area, 0)
	`,
		tenderID,
		in.JudicialPct, in.TotalPct,
		in.AptPriceM2, in.AptArea,
		in.ParkingPriceM2, in.ParkingArea,
		in.StoragePriceM2, in.StorageArea,
	).Scan(
		&out.JudicialPct,
		&out.TotalPct,
		&out.AptPriceM2,
		&out.AptArea,
		&out.ParkingPriceM2,
		&out.ParkingArea,
		&out.StoragePriceM2,
		&out.StorageArea,
	)
	if err != nil {
		return nil, fmt.Errorf("insuranceRepo.Upsert: %w", err)
	}
	return &out, nil
}
