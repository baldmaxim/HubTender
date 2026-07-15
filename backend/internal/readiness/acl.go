package readiness

import (
	"context"
	"fmt"
	"sort"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Этап 2.4 (§12): read-only верификация retired SQL-объектов и грантов.
// Ничего не отзывается автоматически. Статусы:
//   - CONFIRMED_SAFE — проверено и безопасно;
//   - CONFIRMED_RISK — проверено и опасно (blocker);
//   - UNKNOWN        — установить из БД нельзя → обязательный ручной пункт
//     pre-deploy checklist.

// ACLFinding — результат одной ACL-проверки.
type ACLFinding struct {
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	Status  string   `json:"status"` // CONFIRMED_SAFE | CONFIRMED_RISK | UNKNOWN
	Count   int      `json:"count"`
	Details []string `json:"details,omitempty"`
}

// retiredRPCNames — функции, отключённые этапами 0-*/1.x (см. incremental
// 2026_07_retire_*.sql): тело обязано содержать retired-маркер, EXECUTE у
// PUBLIC/не-owner отсутствовать.
var retiredRPCNames = []string{
	"bulk_update_boq_items_commercial_costs",
	"save_redistribution_results",
	"recalculate_tender_grand_total",
}

// AuditACL — §12: retired RPC, grand-total триггеры, прямые UPDATE-гранты.
func AuditACL(ctx context.Context, pool *pgxpool.Pool) ([]ACLFinding, error) {
	var out []ACLFinding

	// 1. Retired RPC: маркер + SECURITY INVOKER + отсутствие PUBLIC/чужих EXECUTE.
	rpc := ACLFinding{ID: "retired_rpc", Title: "Retired RPC: маркер, INVOKER, без PUBLIC/non-owner EXECUTE", Status: "CONFIRMED_SAFE"}
	rows, err := pool.Query(ctx, `
		SELECT p.proname,
		       COALESCE(pg_get_functiondef(p.oid) ILIKE '%retired%', false) AS has_marker,
		       p.prosecdef AS is_definer,
		       COALESCE(bool_or(a.grantee = 0), false) AS public_exec,
		       COALESCE(bool_or(a.grantee <> p.proowner AND a.grantee <> 0), false) AS foreign_exec
		FROM pg_proc p
		JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
		LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
		       ON a.privilege_type = 'EXECUTE'
		WHERE p.proname = ANY($1)
		GROUP BY p.proname, p.oid, p.prosecdef, p.proowner
		ORDER BY p.proname`, retiredRPCNames)
	if err != nil {
		return nil, fmt.Errorf("acl retired rpc: %w", err)
	}
	found := map[string]bool{}
	for rows.Next() {
		var name string
		var marker, definer, publicExec, foreignExec bool
		if err := rows.Scan(&name, &marker, &definer, &publicExec, &foreignExec); err != nil {
			rows.Close()
			return nil, err
		}
		found[name] = true
		switch {
		case !marker:
			rpc.Status = "CONFIRMED_RISK"
			rpc.Details = append(rpc.Details, name+": нет retired-маркера в теле")
		case definer:
			rpc.Status = "CONFIRMED_RISK"
			rpc.Details = append(rpc.Details, name+": SECURITY DEFINER")
		case publicExec:
			rpc.Status = "CONFIRMED_RISK"
			rpc.Details = append(rpc.Details, name+": PUBLIC EXECUTE")
		case foreignExec:
			rpc.Details = append(rpc.Details, name+": EXECUTE у не-owner роли (проверить вручную)")
			if rpc.Status == "CONFIRMED_SAFE" {
				rpc.Status = "UNKNOWN"
			}
		}
		rpc.Count++
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, n := range retiredRPCNames {
		if !found[n] {
			rpc.Details = append(rpc.Details, n+": функция отсутствует (retire-миграция не применялась?) — проверить вручную")
			if rpc.Status == "CONFIRMED_SAFE" {
				rpc.Status = "UNKNOWN"
			}
		}
	}
	out = append(out, rpc)

	// 2. Grand-total триггеры на boq_items отсутствуют.
	trg := ACLFinding{ID: "grand_total_triggers", Title: "Per-row grand-total триггеры на boq_items отсутствуют", Status: "CONFIRMED_SAFE"}
	tRows, err := queryStrings(ctx, pool, `
		SELECT tgname FROM pg_trigger
		WHERE tgrelid = 'public.boq_items'::regclass AND NOT tgisinternal
		  AND (tgname ILIKE '%grand%' OR tgname ILIKE '%total%')
		ORDER BY tgname`)
	if err != nil {
		return nil, fmt.Errorf("acl triggers: %w", err)
	}
	for _, r0 := range tRows {
		trg.Status = "CONFIRMED_RISK"
		trg.Count++
		trg.Details = append(trg.Details, r0[0].(string))
	}
	out = append(out, trg)

	// 3. Прямые UPDATE-гранты на критические таблицы у не-owner ролей.
	grants := ACLFinding{ID: "direct_table_grants", Title: "Прямые UPDATE-гранты (boq_items/tenders/redistribution/memory)", Status: "CONFIRMED_SAFE"}
	gRows, err := queryStrings(ctx, pool, `
		SELECT g.table_name || ' → ' || g.grantee || ' [' || g.privilege_type || ']'
		FROM information_schema.role_table_grants g
		JOIN pg_tables t ON t.schemaname = g.table_schema AND t.tablename = g.table_name
		WHERE g.table_schema = 'public'
		  AND g.table_name IN ('boq_items', 'tenders', 'cost_redistribution_results',
		                       'boq_import_mapping_profiles', 'nomenclature_import_aliases')
		  AND g.privilege_type IN ('UPDATE', 'INSERT', 'DELETE')
		  AND g.grantee NOT IN (t.tableowner, 'postgres')
		ORDER BY 1`)
	if err != nil {
		return nil, fmt.Errorf("acl grants: %w", err)
	}
	for _, r0 := range gRows {
		grants.Count++
		grants.Details = append(grants.Details, r0[0].(string))
	}
	if grants.Count > 0 {
		// Кто эти роли — из БД не установить (может быть легитимный app-логин):
		// обязательный ручной пункт (§12).
		grants.Status = "UNKNOWN"
	}
	out = append(out, grants)

	// 4. PostgREST/Supabase exposure — в Yandex Managed PG таких ролей быть не
	// должно; наличие anon/authenticated/service_role = UNKNOWN (ручная проверка).
	exposure := ACLFinding{ID: "postgrest_exposure", Title: "PostgREST/Supabase роли (anon/authenticated/service_role)", Status: "CONFIRMED_SAFE"}
	eRows, err := queryStrings(ctx, pool, `
		SELECT rolname FROM pg_roles
		WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator')
		ORDER BY 1`)
	if err != nil {
		return nil, fmt.Errorf("acl exposure: %w", err)
	}
	for _, r0 := range eRows {
		exposure.Count++
		exposure.Details = append(exposure.Details, r0[0].(string))
	}
	if exposure.Count > 0 {
		exposure.Status = "UNKNOWN"
	}
	out = append(out, exposure)

	sort.SliceStable(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	for i := range out {
		sort.Strings(out[i].Details)
	}
	return out, nil
}
