package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	ia "github.com/su10/hubtender/backend/internal/importanalysis"
)

// ImportAnalysisRepo — батч-загрузка точных справочников для анализа импорта
// (этап 2.1 §2C): БЕЗ N+1 — фиксированные 5 запросов в одной READ ONLY tx.
type ImportAnalysisRepo struct {
	pool *pgxpool.Pool
}

// NewImportAnalysisRepo creates an ImportAnalysisRepo.
func NewImportAnalysisRepo(pool *pgxpool.Pool) *ImportAnalysisRepo {
	return &ImportAnalysisRepo{pool: pool}
}

func normRefText(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(s))), " ")
}

// LoadRefs — units, номенклатура (work/material), детальные категории и
// позиции тендера как exact-нормализованные индексы.
func (r *ImportAnalysisRepo) LoadRefs(ctx context.Context, tenderID string) (ia.Refs, error) {
	refs := ia.Refs{
		Units:          map[string]string{},
		Currencies:     map[string]string{},
		BoqTypes:       map[string]string{},
		WorkNames:      map[string][]string{},
		MaterialNames:  map[string][]string{},
		DetailCats:     map[string][]string{},
		Positions:      map[string]string{},
		PositionLabels: map[string]string{},
	}
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return refs, fmt.Errorf("importAnalysisRepo: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Тендер существует?
	var exists bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM public.tenders WHERE id = $1::uuid)`, tenderID).Scan(&exists); err != nil {
		return refs, fmt.Errorf("importAnalysisRepo: tender: %w", err)
	}
	if !exists {
		return refs, ErrQualityTenderNotFound
	}

	// Units.
	rows, err := tx.Query(ctx, `SELECT code FROM public.units`)
	if err != nil {
		return refs, fmt.Errorf("importAnalysisRepo: units: %w", err)
	}
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			rows.Close()
			return refs, err
		}
		refs.Units[normRefText(code)] = code
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return refs, err
	}

	// Номенклатура работ/материалов.
	load := func(table string, into map[string][]string) error {
		rows, err := tx.Query(ctx, `SELECT id::text, name FROM public.`+table)
		if err != nil {
			return fmt.Errorf("importAnalysisRepo: %s: %w", table, err)
		}
		defer rows.Close()
		for rows.Next() {
			var id, name string
			if err := rows.Scan(&id, &name); err != nil {
				return err
			}
			key := normRefText(name)
			into[key] = append(into[key], id)
		}
		return rows.Err()
	}
	if err := load("work_names", refs.WorkNames); err != nil {
		return refs, err
	}
	if err := load("material_names", refs.MaterialNames); err != nil {
		return refs, err
	}

	// Детальные категории: name и name|location.
	rows, err = tx.Query(ctx, `
		SELECT dcc.id::text, dcc.name, COALESCE(dcc.location, '')
		FROM public.detail_cost_categories dcc`)
	if err != nil {
		return refs, fmt.Errorf("importAnalysisRepo: detail cats: %w", err)
	}
	for rows.Next() {
		var id, name, loc string
		if err := rows.Scan(&id, &name, &loc); err != nil {
			rows.Close()
			return refs, err
		}
		refs.DetailCats[normRefText(name)] = append(refs.DetailCats[normRefText(name)], id)
		if loc != "" {
			k := normRefText(name + "|" + loc)
			refs.DetailCats[k] = append(refs.DetailCats[k], id)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return refs, err
	}

	// Позиции тендера: по номеру и item_no.
	rows, err = tx.Query(ctx, `
		SELECT id::text, position_number, COALESCE(item_no, ''), COALESCE(work_name, '')
		FROM public.client_positions WHERE tender_id = $1::uuid`, tenderID)
	if err != nil {
		return refs, fmt.Errorf("importAnalysisRepo: positions: %w", err)
	}
	for rows.Next() {
		var id, itemNo, workName string
		var num float64
		if err := rows.Scan(&id, &num, &itemNo, &workName); err != nil {
			rows.Close()
			return refs, err
		}
		numKey := strings.TrimSuffix(strings.TrimSuffix(fmt.Sprintf("%.2f", num), "0"), "0")
		numKey = strings.TrimSuffix(numKey, ".")
		refs.Positions[normRefText(numKey)] = id
		if itemNo != "" {
			refs.Positions[normRefText(itemNo)] = id
		}
		label := "№" + numKey
		if workName != "" {
			label += " " + workName
		}
		refs.PositionLabels[id] = label
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return refs, err
	}

	if err := tx.Commit(ctx); err != nil {
		return refs, fmt.Errorf("importAnalysisRepo: commit: %w", err)
	}
	return refs, nil
}

var _ = errors.Is // keep errors import stable
