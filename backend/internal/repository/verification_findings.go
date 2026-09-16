package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/su10/hubtender/backend/internal/quality"
)

// findingBatch — находки прогона в колоночном виде для unnest.
type findingBatch struct {
	codes, types, entities, prints, sevs, details []string
	money, posNums                                []*float64
	itemNos                                       []*string
}

func newFindingBatch(n int) findingBatch {
	return findingBatch{
		codes: make([]string, n), types: make([]string, n), entities: make([]string, n),
		prints: make([]string, n), sevs: make([]string, n), details: make([]string, n),
		money: make([]*float64, n), posNums: make([]*float64, n), itemNos: make([]*string, n),
	}
}

// upsertFindingsSQL приводит состояние находок к прогону одной командой.
//
// Находка «открывается заново», если была закрыта или у неё сменился отпечаток:
// данные изменились, прежний вердикт уже не действует, и для проверяющего это
// новая проблема — first_seen сдвигается на этот прогон. Выражения в SET видят
// старую строку, поэтому CASE сравнивает прежние значения с EXCLUDED.
//
// client_position_id для строк BOQ берётся джойном: он нужен для группировки по
// разделам и адресации автору правки, а в контракте правила его нет.
const upsertFindingsSQL = `
WITH incoming AS (
	SELECT x.rule_code, x.entity_type, x.entity_id, x.fingerprint, x.severity,
	       x.detail, x.money_delta, x.position_number, x.item_no,
	       CASE x.entity_type
	            WHEN 'client_position' THEN x.entity_id
	            WHEN 'boq_item' THEN b.client_position_id
	       END AS client_position_id
	FROM unnest($3::text[], $4::text[], $5::uuid[], $6::text[], $7::text[],
	            $8::text[], $9::numeric[], $10::numeric[], $11::text[])
	     AS x(rule_code, entity_type, entity_id, fingerprint, severity,
	          detail, money_delta, position_number, item_no)
	LEFT JOIN public.boq_items b
	       ON x.entity_type = 'boq_item' AND b.id = x.entity_id
),
up AS (
	INSERT INTO public.verification_findings AS f
		(tender_id, source, rule_code, entity_type, entity_id, client_position_id,
		 position_number, item_no, severity, detail, money_delta, fingerprint,
		 first_seen_run_id, last_seen_run_id, first_seen_at, last_seen_at)
	SELECT $1::uuid, 'rules', rule_code, entity_type, entity_id, client_position_id,
	       position_number, item_no, severity, detail, money_delta, fingerprint,
	       $2::uuid, $2::uuid, now(), now()
	FROM incoming
	ON CONFLICT (tender_id, source, rule_code, entity_type, entity_id) DO UPDATE
	SET reopen_count = f.reopen_count +
	        CASE WHEN f.resolved_at IS NOT NULL OR f.fingerprint <> EXCLUDED.fingerprint
	             THEN 1 ELSE 0 END,
	    first_seen_at = CASE WHEN f.resolved_at IS NOT NULL OR f.fingerprint <> EXCLUDED.fingerprint
	                         THEN now() ELSE f.first_seen_at END,
	    first_seen_run_id = CASE WHEN f.resolved_at IS NOT NULL OR f.fingerprint <> EXCLUDED.fingerprint
	                             THEN EXCLUDED.first_seen_run_id ELSE f.first_seen_run_id END,
	    fingerprint = EXCLUDED.fingerprint,
	    severity = EXCLUDED.severity,
	    detail = EXCLUDED.detail,
	    money_delta = EXCLUDED.money_delta,
	    position_number = EXCLUDED.position_number,
	    item_no = EXCLUDED.item_no,
	    client_position_id = EXCLUDED.client_position_id,
	    last_seen_run_id = EXCLUDED.last_seen_run_id,
	    last_seen_at = now(),
	    resolved_at = NULL
	RETURNING f.id, f.rule_code, f.entity_type, f.entity_id::text, f.first_seen_at,
	          f.fingerprint, COALESCE(f.first_seen_run_id = $2::uuid, false) AS changed, (xmax = 0) AS inserted
),
ev AS (
	INSERT INTO public.verification_finding_events (finding_id, event_type, fingerprint, run_id)
	SELECT id, CASE WHEN inserted THEN 'opened' ELSE 'reopened' END, fingerprint, $2::uuid
	FROM up
	WHERE changed
)
SELECT id::text, rule_code, entity_type, entity_id, first_seen_at, changed, inserted FROM up`

func upsertFindings(
	ctx context.Context,
	tx pgx.Tx,
	tenderID, runID string,
	batch findingBatch,
	report *QualityReport,
) (opened, reopened int, err error) {
	if len(batch.codes) == 0 {
		return 0, 0, nil
	}
	rows, err := tx.Query(ctx, upsertFindingsSQL, tenderID, runID,
		batch.codes, batch.types, batch.entities, batch.prints, batch.sevs,
		batch.details, batch.money, batch.posNums, batch.itemNos)
	if err != nil {
		return 0, 0, fmt.Errorf("verification_findings upsert: %w", err)
	}
	defer rows.Close()

	firstSeen := make(map[string]struct {
		id string
		at time.Time
	}, len(batch.codes))
	for rows.Next() {
		var id, code, etype, entity string
		var at time.Time
		var changed, inserted bool
		if err := rows.Scan(&id, &code, &etype, &entity, &at, &changed, &inserted); err != nil {
			return 0, 0, fmt.Errorf("verification_findings upsert scan: %w", err)
		}
		if changed {
			if inserted {
				opened++
			} else {
				reopened++
			}
		}
		firstSeen[findingKey(code, etype, entity)] = struct {
			id string
			at time.Time
		}{id, at}
	}
	if err := rows.Err(); err != nil {
		return 0, 0, fmt.Errorf("verification_findings upsert rows: %w", err)
	}

	// Поля истории проставляются всем находкам, включая дубли по ключу: они
	// указывают на ту же сохранённую запись.
	for i := range report.Findings {
		f := &report.Findings[i]
		if fs, ok := firstSeen[findingKey(f.RuleCode, f.EntityType, f.EntityID)]; ok {
			id, at := fs.id, fs.at
			f.FindingID = &id
			f.FirstSeenAt = &at
		}
	}
	return opened, reopened, nil
}

// resolveMissing закрывает находки, которые правило в этом прогоне не выдало.
// Только для правил, отработавших без ошибки: упавшее правило ничего не
// выдало не потому, что проблем нет. Находки правил, выключенных или удалённых из
// каталога, закрываются тоже — иначе они висят открытыми навсегда (так было с G и Q
// после замены на GA и QA).
func resolveMissing(ctx context.Context, tx pgx.Tx, tenderID, runID string, okRules []string) (int, error) {
	if len(okRules) == 0 {
		return 0, nil
	}
	var resolved int
	if err := tx.QueryRow(ctx, `
		WITH res AS (
			UPDATE public.verification_findings
			SET resolved_at = now()
			WHERE tender_id = $1 AND source = 'rules' AND resolved_at IS NULL
			  AND (rule_code = ANY($3::text[]) OR NOT rule_code = ANY($4::text[]))
			  AND last_seen_run_id IS DISTINCT FROM $2::uuid
			RETURNING id, fingerprint
		),
		ev AS (
			INSERT INTO public.verification_finding_events (finding_id, event_type, fingerprint, run_id)
			SELECT id, 'resolved', fingerprint, $2::uuid FROM res
		)
		SELECT count(*) FROM res`,
		tenderID, runID, okRules, activeRuleCodes(),
	).Scan(&resolved); err != nil {
		return 0, fmt.Errorf("verification_findings resolve: %w", err)
	}
	return resolved, nil
}

func activeRuleCodes() []string {
	active := quality.Active()
	codes := make([]string, len(active))
	for i, r := range active {
		codes[i] = r.Code
	}
	return codes
}

// RecordVerdictEvents дописывает вердикты в историю находок. Сохранённой
// находки может ещё не быть (прогон не сохранялся) — тогда события просто нет:
// сам вердикт живёт в quality_acknowledgements и от истории не зависит.
func (r *QualityRepo) RecordVerdictEvents(
	ctx context.Context,
	tenderID string,
	in []VerdictInput,
	actor *string,
) error {
	if len(in) == 0 {
		return nil
	}
	codes, entities := make([]string, len(in)), make([]string, len(in))
	prints, verdicts := make([]string, len(in)), make([]string, len(in))
	notes := make([]*string, len(in))
	sources := make([]string, len(in))
	for i := range in {
		codes[i], entities[i] = in[i].RuleCode, in[i].EntityID
		prints[i], verdicts[i], notes[i] = in[i].Fingerprint, in[i].Verdict, in[i].Note
		sources[i] = in[i].Source
		if sources[i] == "" {
			sources[i] = "ui"
		}
	}
	if _, err := r.pool.Exec(ctx, `
		INSERT INTO public.verification_finding_events
			(finding_id, event_type, fingerprint, actor_user_id, source, note)
		SELECT f.id, x.verdict, x.fingerprint, $7::uuid, x.source, x.note
		FROM unnest($2::text[], $3::uuid[], $4::text[], $5::text[], $6::text[], $8::text[])
		     AS x(rule_code, entity_id, fingerprint, verdict, note, source)
		JOIN public.verification_findings f
		  ON f.tender_id = $1::uuid AND f.source = 'rules'
		 AND f.rule_code = x.rule_code AND f.entity_id = x.entity_id`,
		tenderID, codes, entities, prints, verdicts, notes, actor, sources,
	); err != nil {
		return fmt.Errorf("qualityRepo.RecordVerdictEvents: %w", err)
	}
	return nil
}
