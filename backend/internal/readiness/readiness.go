// Package readiness — этап 2.4 (§10): read-only production-readiness аудит
// legacy-данных ДО деплоя/миграций.
//
// Жёсткие границы:
//   - НИЧЕГО не изменяет: без enqueue, без recalc, без миграций, без
//     авто-repair повреждённых строк;
//   - вывод redacted: tender UUID + коды + счётчики + округлённые дельты;
//     без названий заказчиков, описаний BOQ и цен;
//   - детерминированный JSON (стабильная сортировка) + fingerprint отчёта.
package readiness

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/calc"
)

// Статусы проверки.
const (
	StatusOK      = "ok"
	StatusWarning = "warning"
	StatusBlocker = "blocker"
	StatusUnknown = "unknown" // обязательный ручной пункт pre-deploy checklist (§12)
)

const moneyTolerance = 0.01 // как в internal/quality

// Check — одна проверка отчёта.
type Check struct {
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	Status  string   `json:"status"`
	Count   int      `json:"count"`
	Details []string `json:"details,omitempty"` // redacted, отсортировано, ≤ limit
}

// Options — параметры аудита (§10).
type Options struct {
	TenderID           string        // фильтр по одному тендеру ("" = все)
	BatchSize          int           // предел details на проверку
	CalculatingTimeout time.Duration // порог «застрявшего» calculating
	FailOnWarning      bool
	IncludeMarkup      bool // §11: markup backfill impact report
	IncludeACL         bool // §12: ACL verification
}

// Report — итоговый отчёт.
type Report struct {
	SchemaVersion int           `json:"schema_version"`
	GeneratedAt   string        `json:"generated_at"`
	TenderFilter  string        `json:"tender_filter,omitempty"`
	Checks        []Check       `json:"checks"`
	Markup        *MarkupImpact `json:"markup_backfill_impact,omitempty"`
	ACL           []ACLFinding  `json:"acl,omitempty"`
	Blockers      int           `json:"blockers"`
	Warnings      int           `json:"warnings"`
	Unknowns      int           `json:"unknowns"`
	// Fingerprint — sha256 канонического JSON БЕЗ generated_at: два запуска на
	// одинаковых данных дают одинаковый fingerprint (§18.28).
	Fingerprint string `json:"report_fingerprint"`
}

// ExitCode: 0 — чисто; 1 — blockers (или warnings при FailOnWarning); 2 — unknown при FailOnWarning.
func (r *Report) ExitCode(failOnWarning bool) int {
	if r.Blockers > 0 {
		return 1
	}
	if failOnWarning && (r.Warnings > 0 || r.Unknowns > 0) {
		return 1
	}
	return 0
}

// Run выполняет все проверки. Только SELECT'ы.
func Run(ctx context.Context, pool *pgxpool.Pool, opts Options) (*Report, error) {
	if opts.BatchSize <= 0 {
		opts.BatchSize = 20
	}
	if opts.CalculatingTimeout <= 0 {
		opts.CalculatingTimeout = 10 * time.Minute
	}
	rep := &Report{SchemaVersion: 1, GeneratedAt: time.Now().UTC().Format(time.RFC3339), TenderFilter: opts.TenderID}

	add := func(c Check) {
		sort.Strings(c.Details)
		if len(c.Details) > opts.BatchSize {
			c.Details = c.Details[:opts.BatchSize]
		}
		rep.Checks = append(rep.Checks, c)
	}

	type sqlCheck struct {
		id, title, status, q string
	}
	tf := opts.TenderID
	checks := []sqlCheck{
		{"stale_tenders", "Tenders со статусом stale (требуют пересчёта)", StatusWarning, `
			SELECT id::text FROM public.tenders
			WHERE financial_calculation_status = 'stale' AND ($1 = '' OR id::text = $1) ORDER BY id`},
		{"stuck_calculating", "Tenders в calculating старше timeout", StatusBlocker, `
			SELECT id::text FROM public.tenders
			WHERE financial_calculation_status = 'calculating'
			  AND financial_calculation_started_at < NOW() - make_interval(secs => $2)
			  AND ($1 = '' OR id::text = $1) ORDER BY id`},
		{"approved_not_current", "Approved tender с неактуальным расчётом", StatusBlocker, `
			SELECT id::text FROM public.tenders
			WHERE financial_approved
			  AND (financial_calculation_status <> 'calculated'
			       OR financial_calculation_revision <> financial_input_revision)
			  AND ($1 = '' OR id::text = $1) ORDER BY id`},
		{"failed_calculations", "Tenders со статусом failed", StatusWarning, `
			SELECT id::text || ' [' || COALESCE(financial_calculation_error_code, '?') || ']'
			FROM public.tenders
			WHERE financial_calculation_status = 'failed' AND ($1 = '' OR id::text = $1) ORDER BY id`},
		{"missing_fx", "BOQ в валюте без курса тендера", StatusBlocker, `
			SELECT DISTINCT t.id::text || ' [' || b.currency_type::text || ']'
			FROM public.tenders t JOIN public.boq_items b ON b.tender_id = t.id
			WHERE ((b.currency_type = 'USD' AND t.usd_rate IS NULL)
			    OR (b.currency_type = 'EUR' AND t.eur_rate IS NULL)
			    OR (b.currency_type = 'CNY' AND t.cny_rate IS NULL))
			  AND ($1 = '' OR t.id::text = $1) ORDER BY 1`},
		{"cross_tender_position", "BOQ item с позицией другого тендера", StatusBlocker, `
			SELECT b.id::text FROM public.boq_items b
			JOIN public.client_positions cp ON cp.id = b.client_position_id
			WHERE cp.tender_id <> b.tender_id AND ($1 = '' OR b.tender_id::text = $1) ORDER BY 1`},
		{"cross_scope_parent", "Parent из другого тендера/позиции", StatusBlocker, `
			SELECT b.id::text FROM public.boq_items b
			JOIN public.boq_items p ON p.id = b.parent_work_item_id
			WHERE (p.tender_id <> b.tender_id OR p.client_position_id <> b.client_position_id)
			  AND ($1 = '' OR b.tender_id::text = $1) ORDER BY 1`},
		{"self_parent", "Self-parent BOQ items", StatusBlocker, `
			SELECT id::text FROM public.boq_items
			WHERE parent_work_item_id = id AND ($1 = '' OR tender_id::text = $1) ORDER BY 1`},
		{"parent_non_work", "Parent не является работой", StatusBlocker, `
			SELECT b.id::text FROM public.boq_items b
			JOIN public.boq_items p ON p.id = b.parent_work_item_id
			WHERE p.boq_item_type::text NOT IN ('раб', 'суб-раб')
			  AND ($1 = '' OR b.tender_id::text = $1) ORDER BY 1`},
		{"legacy_redistribution", "Redistribution snapshot без server-метаданных ревизии", StatusWarning, `
			SELECT DISTINCT tender_id::text FROM public.cost_redistribution_results
			WHERE (redistribution_rules IS NULL
			       OR redistribution_rules -> 'server_metadata' ->> 'financial_input_revision' IS NULL)
			  AND ($1 = '' OR tender_id::text = $1) ORDER BY 1`},
		{"alias_targets", "Import-memory aliases с недоступной целью", StatusWarning, `
			SELECT a.id::text FROM public.nomenclature_import_aliases a
			LEFT JOIN public.material_names mn ON mn.id = a.material_name_id
			LEFT JOIN public.work_names wn ON wn.id = a.work_name_id
			WHERE a.is_active AND mn.id IS NULL AND wn.id IS NULL ORDER BY 1`},
	}
	for _, c := range checks {
		var rows [][]any
		var err error
		switch c.id {
		case "stuck_calculating":
			rows, err = queryStrings(ctx, pool, c.q, tf, opts.CalculatingTimeout.Seconds())
		case "alias_targets": // aliases не tender-scoped — запрос без $1
			rows, err = queryStrings(ctx, pool, c.q)
		default:
			rows, err = queryStrings(ctx, pool, c.q, tf)
		}
		if err != nil {
			return nil, fmt.Errorf("readiness %s: %w", c.id, err)
		}
		details := make([]string, 0, len(rows))
		for _, r0 := range rows {
			details = append(details, r0[0].(string))
		}
		status := StatusOK
		if len(details) > 0 {
			status = c.status
		}
		add(Check{ID: c.id, Title: c.title, Status: status, Count: len(details), Details: details})
	}

	// §10.6-8/17: пересчётные сверки существующим calc-движком (read-only).
	mismatch, err := auditTotals(ctx, pool, tf, opts.BatchSize)
	if err != nil {
		return nil, err
	}
	for _, c := range mismatch {
		add(c)
	}

	// §10.14-16 / §12: legacy SQL objects + ACL.
	if opts.IncludeACL {
		acl, err := AuditACL(ctx, pool)
		if err != nil {
			return nil, err
		}
		rep.ACL = acl
		for _, f := range acl {
			st := StatusOK
			switch f.Status {
			case "CONFIRMED_RISK":
				st = StatusBlocker
			case "UNKNOWN":
				st = StatusUnknown
			}
			add(Check{ID: "acl:" + f.ID, Title: f.Title, Status: st, Count: f.Count, Details: f.Details})
		}
	}

	// §11: markup backfill impact.
	if opts.IncludeMarkup {
		mi, err := BuildMarkupImpact(ctx, pool)
		if err != nil {
			return nil, err
		}
		rep.Markup = mi
		st := StatusOK
		if len(mi.AffectedTactics) > 0 {
			st = StatusWarning // deployment gate: owner-reviewed список (§11)
		}
		add(Check{ID: "markup_backfill_affected", Title: "Markup-тактики без multiplyFormat (backfill затронет)",
			Status: st, Count: len(mi.AffectedTactics)})
	}

	sort.SliceStable(rep.Checks, func(i, j int) bool { return rep.Checks[i].ID < rep.Checks[j].ID })
	for _, c := range rep.Checks {
		switch c.Status {
		case StatusBlocker:
			rep.Blockers++
		case StatusWarning:
			rep.Warnings++
		case StatusUnknown:
			rep.Unknowns++
		}
	}
	rep.Fingerprint = fingerprint(rep)
	return rep, nil
}

// fingerprint — sha256 канонического JSON без generated_at.
func fingerprint(r *Report) string {
	clone := *r
	clone.GeneratedAt = ""
	clone.Fingerprint = ""
	b, _ := json.Marshal(clone)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func queryStrings(ctx context.Context, pool *pgxpool.Pool, q string, args ...any) ([][]any, error) {
	rows, err := pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out [][]any
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		out = append(out, vals)
	}
	return out, rows.Err()
}

// auditTotals — сверка persisted-итогов СУЩЕСТВУЮЩИМ calc-движком:
//   - boq_items.total_amount против calc.CalculateBoqItemTotalAmount;
//   - client_positions.total_amount_* против суммы строк;
//   - tenders.cached_grand_total против суммы commercial-итогов.
func auditTotals(ctx context.Context, pool *pgxpool.Pool, tenderFilter string, limit int) ([]Check, error) {
	boqCheck := Check{ID: "boq_total_mismatch", Title: "BOQ total_amount расходится с пересчётом", Status: StatusOK}
	rows, err := pool.Query(ctx, `
		SELECT b.id::text, b.boq_item_type::text,
		       b.quantity, b.unit_rate, b.currency_type::text,
		       COALESCE(b.delivery_price_type::text, ''), b.delivery_amount,
		       b.consumption_coefficient, b.parent_work_item_id::text,
		       b.total_amount, t.usd_rate, t.eur_rate, t.cny_rate
		FROM public.boq_items b JOIN public.tenders t ON t.id = b.tender_id
		WHERE ($1 = '' OR b.tender_id::text = $1)`, tenderFilter)
	if err != nil {
		return nil, fmt.Errorf("readiness boq totals: %w", err)
	}
	for rows.Next() {
		var id, typ, cur, dt string
		var parentID *string
		var qty, rate, da, consumption, total, usd, eur, cny *float64
		if err := rows.Scan(&id, &typ, &qty, &rate, &cur, &dt, &da, &consumption, &parentID, &total, &usd, &eur, &cny); err != nil {
			rows.Close()
			return nil, err
		}
		in := calc.BoqItemAmountInput{
			BoqItemType: typ,
			Quantity:    qty, UnitRate: rate, CurrencyType: cur,
			DeliveryPriceType: dt, DeliveryAmount: da,
			ConsumptionCoefficient: consumption, ParentWorkItemID: parentID,
			TotalAmount: total,
		}
		expected, cerr := calc.CalculateBoqItemTotalAmount(in, calc.CurrencyRates{USDRate: usd, EURRate: eur, CNYRate: cny})
		if cerr != nil {
			continue // missing FX уже отдельный blocker-чек
		}
		stored := 0.0
		if total != nil {
			stored = *total
		}
		if math.Abs(expected-stored) > moneyTolerance {
			boqCheck.Count++
			if len(boqCheck.Details) < limit {
				boqCheck.Details = append(boqCheck.Details,
					fmt.Sprintf("%s delta=%.2f", id, expected-stored))
			}
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if boqCheck.Count > 0 {
		boqCheck.Status = StatusWarning // расхождение чинится recalc'ом, не миграцией
	}

	posCheck := Check{ID: "position_total_mismatch", Title: "Итог позиции расходится с суммой строк", Status: StatusOK}
	posRows, err := queryStrings(ctx, pool, `
		SELECT cp.id::text,
		       ROUND((COALESCE(cp.total_material, 0) + COALESCE(cp.total_works, 0)
		            - COALESCE(s.total, 0))::numeric, 2)::float8
		FROM public.client_positions cp
		LEFT JOIN (SELECT client_position_id, SUM(COALESCE(total_amount, 0)) AS total
		           FROM public.boq_items GROUP BY client_position_id) s
		       ON s.client_position_id = cp.id
		WHERE ABS(COALESCE(cp.total_material, 0) + COALESCE(cp.total_works, 0)
		        - COALESCE(s.total, 0)) > $2
		  AND ($1 = '' OR cp.tender_id::text = $1)
		ORDER BY 1`, tenderFilter, moneyTolerance)
	if err != nil {
		return nil, fmt.Errorf("readiness position totals: %w", err)
	}
	for _, r0 := range posRows {
		posCheck.Count++
		if len(posCheck.Details) < limit {
			posCheck.Details = append(posCheck.Details, fmt.Sprintf("%s delta=%.2f", r0[0], r0[1]))
		}
	}
	if posCheck.Count > 0 {
		posCheck.Status = StatusWarning
	}

	grandCheck := Check{ID: "cached_grand_total_mismatch", Title: "cached_grand_total расходится с суммой commercial-итогов", Status: StatusOK}
	gtRows, err := queryStrings(ctx, pool, `
		SELECT t.id::text,
		       ROUND((COALESCE(t.cached_grand_total, 0) - COALESCE(s.total, 0))::numeric, 2)::float8,
		       (t.financial_input_revision = 0 AND t.financial_calculation_revision = 0)
		FROM public.tenders t
		LEFT JOIN (SELECT tender_id,
		                  SUM(COALESCE(total_commercial_material_cost, 0)
		                    + COALESCE(total_commercial_work_cost, 0)) AS total
		           FROM public.boq_items GROUP BY tender_id) s ON s.tender_id = t.id
		WHERE ABS(COALESCE(t.cached_grand_total, 0) - COALESCE(s.total, 0)) > $2
		  AND ($1 = '' OR t.id::text = $1)
		ORDER BY 1`, tenderFilter, moneyTolerance)
	if err != nil {
		return nil, fmt.Errorf("readiness grand total: %w", err)
	}
	legacyZero := Check{ID: "legacy_zero_revision_inconsistent",
		Title: "Тендеры с revision 0/0 (migration default), но неконсистентными итогами", Status: StatusOK}
	for _, r0 := range gtRows {
		grandCheck.Count++
		if len(grandCheck.Details) < limit {
			grandCheck.Details = append(grandCheck.Details, fmt.Sprintf("%s delta=%.2f", r0[0], r0[1]))
		}
		if r0[2].(bool) { // §10.17
			legacyZero.Count++
			if len(legacyZero.Details) < limit {
				legacyZero.Details = append(legacyZero.Details, r0[0].(string))
			}
		}
	}
	if grandCheck.Count > 0 {
		grandCheck.Status = StatusWarning
	}
	if legacyZero.Count > 0 {
		legacyZero.Status = StatusWarning
	}
	return []Check{boqCheck, posCheck, grandCheck, legacyZero}, nil
}
