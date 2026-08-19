package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ErrArchivePositionNotFound — запрошенной исторической позиции нет.
var ErrArchivePositionNotFound = errors.New("archive position not found")

// ArchiveTenderContext — контекст тендера-источника. Курсы отдаются намеренно:
// потребитель должен видеть, по какому курсу считалась историческая цена, хотя
// при переносе применяются курсы ЦЕЛЕВОГО тендера.
type ArchiveTenderContext struct {
	ID                 string   `json:"id"`
	TenderNumber       string   `json:"tender_number"`
	Version            int      `json:"version"`
	Title              string   `json:"title"`
	ClientName         string   `json:"client_name"`
	CreatedAt          string   `json:"created_at"`
	SubmissionDeadline *string  `json:"submission_deadline"`
	FinancialApproved  *bool    `json:"financial_approved"`
	IsArchived         bool     `json:"is_archived"`
	USDRate            *float64 `json:"usd_rate"`
	EURRate            *float64 `json:"eur_rate"`
	CNYRate            *float64 `json:"cny_rate"`
	HousingClass       *string  `json:"housing_class"`
	ConstructionScope  *string  `json:"construction_scope"`
	AreaClient         *float64 `json:"area_client"`
	AreaSP             *float64 `json:"area_sp"`
}

// ArchivePositionDetailRow — историческая позиция целиком.
type ArchivePositionDetailRow struct {
	ID                             string          `json:"id"`
	TenderID                       string          `json:"tender_id"`
	PositionNumber                 float64         `json:"position_number"`
	ItemNo                         *string         `json:"item_no"`
	SectionNumber                  *string         `json:"section_number"`
	PositionName                   *string         `json:"position_name"`
	WorkName                       string          `json:"work_name"`
	UnitCode                       *string         `json:"unit_code"`
	Volume                         *float64        `json:"volume"`
	ManualVolume                   *float64        `json:"manual_volume"`
	ClientNote                     *string         `json:"client_note"`
	ManualNote                     *string         `json:"manual_note"`
	HierarchyLevel                 *int            `json:"hierarchy_level"`
	IsAdditional                   *bool           `json:"is_additional"`
	ParentPositionID               *string         `json:"parent_position_id"`
	TotalMaterial                  *float64        `json:"total_material"`
	TotalWorks                     *float64        `json:"total_works"`
	MaterialCostPerUnit            *float64        `json:"material_cost_per_unit"`
	WorkCostPerUnit                *float64        `json:"work_cost_per_unit"`
	TotalCommercialMaterial        *float64        `json:"total_commercial_material"`
	TotalCommercialWork            *float64        `json:"total_commercial_work"`
	TotalCommercialMaterialPerUnit *float64        `json:"total_commercial_material_per_unit"`
	TotalCommercialWorkPerUnit     *float64        `json:"total_commercial_work_per_unit"`
	RichRuns                       json.RawMessage `json:"rich_runs"`
	CreatedAt                      string          `json:"created_at"`
	UpdatedAt                      string          `json:"updated_at"`
}

// ArchivePositionDetail — ответ «историческая позиция целиком»: позиция +
// тендер-источник + все строки BOQ. Один round-trip для машинного клиента.
type ArchivePositionDetail struct {
	Position ArchivePositionDetailRow `json:"position"`
	Tender   ArchiveTenderContext     `json:"tender"`
	Items    []BoqItemFullRow         `json:"items"`
}

const archivePositionDetailSQL = `
SELECT cp.id::text, cp.tender_id::text, cp.position_number,
       cp.item_no, cp.section_number, cp.position_name, cp.work_name,
       cp.unit_code, cp.volume, cp.manual_volume,
       cp.client_note, cp.manual_note, cp.hierarchy_level, cp.is_additional,
       cp.parent_position_id::text,
       cp.total_material, cp.total_works,
       cp.material_cost_per_unit, cp.work_cost_per_unit,
       cp.total_commercial_material, cp.total_commercial_work,
       cp.total_commercial_material_per_unit, cp.total_commercial_work_per_unit,
       cp.rich_runs,
       to_char(cp.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       to_char(cp.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       t.id::text, t.tender_number, COALESCE(t.version, 1),
       t.title, t.client_name,
       to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       to_char(t.submission_deadline AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       t.financial_approved, COALESCE(t.is_archived, false),
       t.usd_rate, t.eur_rate, t.cny_rate,
       t.housing_class::text, t.construction_scope::text,
       t.area_client, t.area_sp
FROM public.client_positions cp
JOIN public.tenders t ON t.id = cp.tender_id
WHERE cp.id = $1
`

// GetArchivePosition возвращает историческую позицию, её тендер и все строки BOQ.
func (r *ArchiveRepo) GetArchivePosition(ctx context.Context, positionID string) (*ArchivePositionDetail, error) {
	var d ArchivePositionDetail
	err := r.pool.QueryRow(ctx, archivePositionDetailSQL, positionID).Scan(
		&d.Position.ID, &d.Position.TenderID, &d.Position.PositionNumber,
		&d.Position.ItemNo, &d.Position.SectionNumber, &d.Position.PositionName, &d.Position.WorkName,
		&d.Position.UnitCode, &d.Position.Volume, &d.Position.ManualVolume,
		&d.Position.ClientNote, &d.Position.ManualNote, &d.Position.HierarchyLevel, &d.Position.IsAdditional,
		&d.Position.ParentPositionID,
		&d.Position.TotalMaterial, &d.Position.TotalWorks,
		&d.Position.MaterialCostPerUnit, &d.Position.WorkCostPerUnit,
		&d.Position.TotalCommercialMaterial, &d.Position.TotalCommercialWork,
		&d.Position.TotalCommercialMaterialPerUnit, &d.Position.TotalCommercialWorkPerUnit,
		&d.Position.RichRuns,
		&d.Position.CreatedAt, &d.Position.UpdatedAt,
		&d.Tender.ID, &d.Tender.TenderNumber, &d.Tender.Version,
		&d.Tender.Title, &d.Tender.ClientName,
		&d.Tender.CreatedAt, &d.Tender.SubmissionDeadline,
		&d.Tender.FinancialApproved, &d.Tender.IsArchived,
		&d.Tender.USDRate, &d.Tender.EURRate, &d.Tender.CNYRate,
		&d.Tender.HousingClass, &d.Tender.ConstructionScope,
		&d.Tender.AreaClient, &d.Tender.AreaSP,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrArchivePositionNotFound
		}
		return nil, fmt.Errorf("archiveRepo.GetArchivePosition: %w", err)
	}

	rows, err := r.pool.Query(ctx, boqItemsFullSelect+`
		WHERE bi.client_position_id = $1
		ORDER BY bi.sort_number, bi.id
	`, positionID)
	if err != nil {
		return nil, fmt.Errorf("archiveRepo.GetArchivePosition: items: %w", err)
	}
	items, err := scanBoqItemsFullRows(rows)
	if err != nil {
		return nil, fmt.Errorf("archiveRepo.GetArchivePosition: %w", err)
	}
	d.Items = items
	return &d, nil
}
