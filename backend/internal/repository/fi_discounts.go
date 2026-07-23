package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FIDiscountRule is one «итерация снижения» on the Financial Indicators page:
// вычесть Amount рублей коммерческой стоимости с позиций PositionIDs.
//
// Хранятся ТОЛЬКО параметры — никаких посчитанных сумм. Дельты по прямым
// затратам фронт пересчитывает на загрузке из каскада наценок тендера, тот же
// принцип, что и у redistribution_rules.position_adjustments.
// См. docs/CALCULATION_SOURCE_OF_TRUTH.md.
type FIDiscountRule struct {
	Amount      float64  `json:"amount"`
	PositionIDs []string `json:"positionIds"`
}

// FIDiscountsRow mirrors public.tender_fi_discounts.
//
// Enabled=false (дефолт, и он же для тендера без строки в таблице) означает
// «считать ровно как раньше»; Rules при этом сохраняются, чтобы выключение
// тумблера не стирало настроенные итерации.
type FIDiscountsRow struct {
	Enabled bool             `json:"enabled"`
	Rules   []FIDiscountRule `json:"rules"`
}

// FIDiscountsRepo handles tender_fi_discounts reads + upserts.
type FIDiscountsRepo struct {
	pool *pgxpool.Pool
}

// NewFIDiscountsRepo creates an FIDiscountsRepo.
func NewFIDiscountsRepo(pool *pgxpool.Pool) *FIDiscountsRepo {
	return &FIDiscountsRepo{pool: pool}
}

// Get returns the discount settings for the tender. Returns a zero-value row
// (enabled=false, empty rules) when no row exists — «снижение не настроено» и
// «снижение выключено» для страницы неразличимы, поэтому отдельный nil-случай
// вызывающему не нужен.
func (r *FIDiscountsRepo) Get(ctx context.Context, tenderID string) (*FIDiscountsRow, error) {
	var (
		enabled  bool
		rawRules []byte
	)
	err := r.pool.QueryRow(ctx, `
		SELECT enabled, rules
		FROM public.tender_fi_discounts
		WHERE tender_id = $1
	`, tenderID).Scan(&enabled, &rawRules)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &FIDiscountsRow{Enabled: false, Rules: []FIDiscountRule{}}, nil
		}
		return nil, fmt.Errorf("fiDiscountsRepo.Get: %w", err)
	}

	rules, err := decodeRules(rawRules)
	if err != nil {
		return nil, fmt.Errorf("fiDiscountsRepo.Get: %w", err)
	}
	return &FIDiscountsRow{Enabled: enabled, Rules: rules}, nil
}

// Upsert writes the settings for the tender. Conflict target is tender_id
// (uq_tender_fi_discounts_tender). created_by выставляется только при вставке —
// на UPDATE сохраняется автор первоначальной настройки.
func (r *FIDiscountsRepo) Upsert(
	ctx context.Context,
	tenderID string,
	in FIDiscountsRow,
	userID string,
) (*FIDiscountsRow, error) {
	rules := in.Rules
	if rules == nil {
		rules = []FIDiscountRule{}
	}
	encoded, err := json.Marshal(rules)
	if err != nil {
		return nil, fmt.Errorf("fiDiscountsRepo.Upsert marshal: %w", err)
	}

	// Пустая строка userID → NULL, иначе FK на auth.users(id) отвалится.
	var createdBy any
	if userID != "" {
		createdBy = userID
	}

	var (
		outEnabled bool
		outRules   []byte
	)
	err = r.pool.QueryRow(ctx, `
		INSERT INTO public.tender_fi_discounts (tender_id, enabled, rules, created_by)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (tender_id) DO UPDATE SET
			enabled = EXCLUDED.enabled,
			rules   = EXCLUDED.rules
		RETURNING enabled, rules
	`, tenderID, in.Enabled, encoded, createdBy).Scan(&outEnabled, &outRules)
	if err != nil {
		return nil, fmt.Errorf("fiDiscountsRepo.Upsert: %w", err)
	}

	persisted, err := decodeRules(outRules)
	if err != nil {
		return nil, fmt.Errorf("fiDiscountsRepo.Upsert: %w", err)
	}
	return &FIDiscountsRow{Enabled: outEnabled, Rules: persisted}, nil
}

// decodeRules unmarshals the rules jsonb column, normalising SQL NULL and the
// empty payload to an empty slice so the JSON response never carries `null`
// where the frontend expects an array.
func decodeRules(raw []byte) ([]FIDiscountRule, error) {
	if len(raw) == 0 {
		return []FIDiscountRule{}, nil
	}
	var rules []FIDiscountRule
	if err := json.Unmarshal(raw, &rules); err != nil {
		return nil, fmt.Errorf("decode rules: %w", err)
	}
	if rules == nil {
		return []FIDiscountRule{}, nil
	}
	return rules, nil
}
