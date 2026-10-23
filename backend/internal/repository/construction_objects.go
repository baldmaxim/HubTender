package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrConstructionObjectNotFound — строки с таким id нет в construction_objects.
var ErrConstructionObjectNotFound = errors.New("construction object not found")

// ConstructionObjectsRepo — CRUD таблицы «Объекты» (public.construction_objects).
type ConstructionObjectsRepo struct {
	pool *pgxpool.Pool
}

// NewConstructionObjectsRepo creates a ConstructionObjectsRepo.
func NewConstructionObjectsRepo(pool *pgxpool.Pool) *ConstructionObjectsRepo {
	return &ConstructionObjectsRepo{pool: pool}
}

// ConstructionObjectRow — объект строительства в ответе API.
type ConstructionObjectRow struct {
	ID                string    `json:"id"`
	Name              string    `json:"name"`
	Area              *float64  `json:"area"`
	Address           string    `json:"address"`
	Latitude          *float64  `json:"latitude"`
	Longitude         *float64  `json:"longitude"`
	Status            string    `json:"status"`
	ProjectID         *string   `json:"project_id"`
	ProjectName       *string   `json:"project_name"`
	CommissioningDate *string   `json:"commissioning_date"`
	SortOrder         int       `json:"sort_order"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// ConstructionObjectInput — уже проверенные и подрезанные поля для записи.
type ConstructionObjectInput struct {
	Name              string
	Area              *float64
	Address           string
	Latitude          *float64
	Longitude         *float64
	Status            string
	ProjectID         *string
	CommissioningDate *string
}

// Список полей Obj поверх алиаса o (строка таблицы) и LEFT JOIN projects p.
const constructionObjectCols = `
	o.id::text, o.name, o.area::float8, o.address, o.latitude, o.longitude,
	o.status, o.project_id::text, p.name,
	to_char(o.commissioning_date, 'YYYY-MM-DD'),
	o.sort_order, o.created_at, o.updated_at`

func scanConstructionObject(row pgx.Row) (*ConstructionObjectRow, error) {
	var o ConstructionObjectRow
	if err := row.Scan(
		&o.ID, &o.Name, &o.Area, &o.Address, &o.Latitude, &o.Longitude,
		&o.Status, &o.ProjectID, &o.ProjectName, &o.CommissioningDate,
		&o.SortOrder, &o.CreatedAt, &o.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &o, nil
}

// List возвращает все объекты: сначала текущие, затем по sort_order и названию.
func (r *ConstructionObjectsRepo) List(ctx context.Context) ([]ConstructionObjectRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+constructionObjectCols+`
		FROM public.construction_objects o
		LEFT JOIN public.projects p ON p.id = o.project_id
		ORDER BY (o.status = 'current') DESC, o.sort_order, o.name
	`)
	if err != nil {
		return nil, fmt.Errorf("constructionObjectsRepo.List: %w", err)
	}
	defer rows.Close()
	out := make([]ConstructionObjectRow, 0)
	for rows.Next() {
		o, err := scanConstructionObject(rows)
		if err != nil {
			return nil, fmt.Errorf("constructionObjectsRepo.List scan: %w", err)
		}
		out = append(out, *o)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("constructionObjectsRepo.List rows: %w", err)
	}
	return out, nil
}

// Create вставляет объект в конец списка (sort_order = max + 1).
func (r *ConstructionObjectsRepo) Create(ctx context.Context, in ConstructionObjectInput, createdBy *string) (*ConstructionObjectRow, error) {
	o, err := scanConstructionObject(r.pool.QueryRow(ctx, `
		WITH ins AS (
			INSERT INTO public.construction_objects (
				name, area, address, latitude, longitude, status,
				project_id, commissioning_date, sort_order, created_by
			) VALUES (
				$1, $2::numeric, $3, $4, $5, $6,
				$7::uuid, $8::date,
				(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.construction_objects),
				$9::uuid
			)
			RETURNING *
		)
		SELECT `+constructionObjectCols+`
		FROM ins o
		LEFT JOIN public.projects p ON p.id = o.project_id
	`,
		in.Name, in.Area, in.Address, in.Latitude, in.Longitude, in.Status,
		in.ProjectID, in.CommissioningDate, createdBy,
	))
	if err != nil {
		return nil, fmt.Errorf("constructionObjectsRepo.Create: %w", err)
	}
	return o, nil
}

// Update полностью заменяет поля Input; нет строки — ErrConstructionObjectNotFound.
func (r *ConstructionObjectsRepo) Update(ctx context.Context, id string, in ConstructionObjectInput) (*ConstructionObjectRow, error) {
	o, err := scanConstructionObject(r.pool.QueryRow(ctx, `
		WITH upd AS (
			UPDATE public.construction_objects
			SET name               = $1,
			    area               = $2::numeric,
			    address            = $3,
			    latitude           = $4,
			    longitude          = $5,
			    status             = $6,
			    project_id         = $7::uuid,
			    commissioning_date = $8::date
			WHERE id = $9::uuid
			RETURNING *
		)
		SELECT `+constructionObjectCols+`
		FROM upd o
		LEFT JOIN public.projects p ON p.id = o.project_id
	`,
		in.Name, in.Area, in.Address, in.Latitude, in.Longitude, in.Status,
		in.ProjectID, in.CommissioningDate, id,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrConstructionObjectNotFound
		}
		return nil, fmt.Errorf("constructionObjectsRepo.Update: %w", err)
	}
	return o, nil
}

// Delete удаляет объект; нет строки — ErrConstructionObjectNotFound.
func (r *ConstructionObjectsRepo) Delete(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM public.construction_objects WHERE id = $1::uuid`, id)
	if err != nil {
		return fmt.Errorf("constructionObjectsRepo.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrConstructionObjectNotFound
	}
	return nil
}
