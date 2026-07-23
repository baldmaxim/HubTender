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
// «считать ровно как раньше»; Rules/ZeroedPositionIDs при этом сохраняются,
// чтобы выключение тумблера или смена режима не стирали настройки.
//
// Mode — активный режим корректировки: "discount" (снижение суммой) или
// "zeroing" (полное обнуление строк). Режимы взаимоисключающие: применяется
// только активный, но наборы обоих хранятся.
type FIDiscountsRow struct {
	Enabled           bool             `json:"enabled"`
	Mode              string           `json:"mode"`
	Rules             []FIDiscountRule `json:"rules"`
	ZeroedPositionIDs []string         `json:"zeroedPositionIds"`
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
		enabled   bool
		mode      string
		rawRules  []byte
		rawZeroed []byte
	)
	err := r.pool.QueryRow(ctx, `
		SELECT enabled, mode, rules, zeroed_position_ids
		FROM public.tender_fi_discounts
		WHERE tender_id = $1
	`, tenderID).Scan(&enabled, &mode, &rawRules, &rawZeroed)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &FIDiscountsRow{Enabled: false, Mode: "discount", Rules: []FIDiscountRule{}, ZeroedPositionIDs: []string{}}, nil
		}
		return nil, fmt.Errorf("fiDiscountsRepo.Get: %w", err)
	}

	rules, err := decodeRules(rawRules)
	if err != nil {
		return nil, fmt.Errorf("fiDiscountsRepo.Get: %w", err)
	}
	zeroed, err := decodeStringArray(rawZeroed)
	if err != nil {
		return nil, fmt.Errorf("fiDiscountsRepo.Get: %w", err)
	}
	return &FIDiscountsRow{Enabled: enabled, Mode: mode, Rules: rules, ZeroedPositionIDs: zeroed}, nil
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
	zeroed := in.ZeroedPositionIDs
	if zeroed == nil {
		zeroed = []string{}
	}
	encodedZeroed, err := json.Marshal(zeroed)
	if err != nil {
		return nil, fmt.Errorf("fiDiscountsRepo.Upsert marshal zeroed: %w", err)
	}
	mode := in.Mode
	if mode != "zeroing" {
		mode = "discount"
	}

	// Пустая строка userID → NULL, иначе FK на auth.users(id) отвалится.
	var createdBy any
	if userID != "" {
		createdBy = userID
	}

	var (
		outEnabled bool
		outMode    string
		outRules   []byte
		outZeroed  []byte
	)
	err = r.pool.QueryRow(ctx, `
		INSERT INTO public.tender_fi_discounts (tender_id, enabled, mode, rules, zeroed_position_ids, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (tender_id) DO UPDATE SET
			enabled             = EXCLUDED.enabled,
			mode                = EXCLUDED.mode,
			rules               = EXCLUDED.rules,
			zeroed_position_ids = EXCLUDED.zeroed_position_ids
		RETURNING enabled, mode, rules, zeroed_position_ids
	`, tenderID, in.Enabled, mode, encoded, encodedZeroed, createdBy).Scan(&outEnabled, &outMode, &outRules, &outZeroed)
	if err != nil {
		return nil, fmt.Errorf("fiDiscountsRepo.Upsert: %w", err)
	}

	persisted, err := decodeRules(outRules)
	if err != nil {
		return nil, fmt.Errorf("fiDiscountsRepo.Upsert: %w", err)
	}
	persistedZeroed, err := decodeStringArray(outZeroed)
	if err != nil {
		return nil, fmt.Errorf("fiDiscountsRepo.Upsert: %w", err)
	}
	return &FIDiscountsRow{Enabled: outEnabled, Mode: outMode, Rules: persisted, ZeroedPositionIDs: persistedZeroed}, nil
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

// decodeStringArray unmarshals a jsonb array of strings (обнулённые позиции),
// нормализуя SQL NULL/пустоту в пустой слайс.
func decodeStringArray(raw []byte) ([]string, error) {
	if len(raw) == 0 {
		return []string{}, nil
	}
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("decode string array: %w", err)
	}
	if out == nil {
		return []string{}, nil
	}
	return out, nil
}
