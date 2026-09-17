package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/su10/hubtender/backend/internal/ai/triage"
)

// AICandidates — открытые находки тендера, которые ещё не разобраны ИИ при текущих
// данных и версии промпта и по которым инженер не поставил вердикт. Первыми идут
// ошибки и находки с большим денежным эффектом.
//
// Разбираются только находки по строкам и позициям: у находок по справочнику и
// тендеру нет позиции, контекст которой можно показать модели.
func (r *VerificationAIRepo) AICandidates(
	ctx context.Context, tenderID string, activeRules []string, promptVersion string, limit int,
) ([]triage.Finding, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT vf.id::text, vf.rule_code, vf.detail, vf.entity_type, vf.entity_id::text,
		       vf.client_position_id::text, vf.fingerprint
		FROM public.verification_findings vf
		WHERE vf.tender_id = $1
		  AND vf.resolved_at IS NULL
		  AND vf.entity_type IN ('boq_item', 'client_position')
		  AND vf.client_position_id IS NOT NULL
		  AND vf.rule_code = ANY($2::text[])
		  AND NOT EXISTS (
		      SELECT 1 FROM public.quality_acknowledgements qa
		      WHERE qa.tender_id = vf.tender_id AND qa.rule_code = vf.rule_code
		        AND qa.entity_id = vf.entity_id AND qa.fingerprint = vf.fingerprint)
		  AND NOT EXISTS (
		      SELECT 1 FROM public.verification_ai_assessments a
		      WHERE a.finding_id = vf.id AND a.fingerprint = vf.fingerprint
		        AND a.prompt_version = $3)
		ORDER BY CASE vf.severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
		         abs(COALESCE(vf.money_delta, 0)) DESC,
		         vf.position_number NULLS LAST, vf.id
		LIMIT $4`, tenderID, activeRules, promptVersion, limit)
	if err != nil {
		return nil, fmt.Errorf("verificationAI.AICandidates: %w", err)
	}
	defer rows.Close()
	var out []triage.Finding
	for rows.Next() {
		var f triage.Finding
		if err := rows.Scan(&f.ID, &f.RuleCode, &f.Detail, &f.EntityType, &f.EntityID,
			&f.PositionID, &f.Fingerprint); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// PositionsContext — позиции с расчётом для модели. Числа — через trim_scale, как
// их видит инженер, без хвостовых нулей.
func (r *VerificationAIRepo) PositionsContext(ctx context.Context, tenderID string, positionIDs []string) (map[string]*triage.Position, error) {
	out := make(map[string]*triage.Position, len(positionIDs))
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, COALESCE(item_no, ''), work_name, COALESCE(unit_code, ''),
		       COALESCE(trim_scale(volume)::text, ''), COALESCE(trim_scale(manual_volume)::text, ''),
		       COALESCE(manual_note, ''), COALESCE(client_note, '')
		FROM public.client_positions
		WHERE tender_id = $1 AND id = ANY($2::uuid[])`, tenderID, positionIDs)
	if err != nil {
		return nil, fmt.Errorf("verificationAI.PositionsContext: positions: %w", err)
	}
	for rows.Next() {
		p := &triage.Position{}
		if err := rows.Scan(&p.ID, &p.ItemNo, &p.CustomerName, &p.Unit, &p.CustomerVolume, &p.GPVolume,
			&p.GPNote, &p.ClientNote); err != nil {
			rows.Close()
			return nil, err
		}
		out[p.ID] = p
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows, err = r.pool.Query(ctx, `
		SELECT b.client_position_id::text, b.id::text, b.boq_item_type::text,
		       COALESCE(wn.name, mn.name, ''), COALESCE(b.unit_code, ''),
		       COALESCE(trim_scale(b.quantity)::text, ''),
		       COALESCE(trim_scale(b.conversion_coefficient)::text, ''),
		       COALESCE(trim_scale(b.consumption_coefficient)::text, ''),
		       COALESCE(trim_scale(b.unit_rate)::text, ''),
		       COALESCE(b.currency_type::text, ''),
		       COALESCE(trim_scale(round(b.total_amount, 2))::text, ''),
		       COALESCE(b.parent_work_item_id::text, ''),
		       COALESCE(concat_ws(' / ', cc.name, dcc.name, NULLIF(dcc.location, '')), ''),
		       COALESCE(b.description, '')
		FROM public.boq_items b
		LEFT JOIN public.work_names wn ON wn.id = b.work_name_id
		LEFT JOIN public.material_names mn ON mn.id = b.material_name_id
		LEFT JOIN public.detail_cost_categories dcc ON dcc.id = b.detail_cost_category_id
		LEFT JOIN public.cost_categories cc ON cc.id = dcc.cost_category_id
		WHERE b.tender_id = $1 AND b.client_position_id = ANY($2::uuid[])
		ORDER BY b.client_position_id, b.sort_number, b.created_at, b.id`, tenderID, positionIDs)
	if err != nil {
		return nil, fmt.Errorf("verificationAI.PositionsContext: rows: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var posID string
		var row triage.Row
		if err := rows.Scan(&posID, &row.ID, &row.Type, &row.Name, &row.Unit, &row.Quantity,
			&row.ConversionCoefficient, &row.ConsumptionCoefficient, &row.UnitRate, &row.Currency,
			&row.Total, &row.ParentWorkID, &row.CostCategory, &row.Description); err != nil {
			return nil, err
		}
		if p, ok := out[posID]; ok {
			p.Rows = append(p.Rows, row)
		}
	}
	return out, rows.Err()
}

// SaveAssessments записывает оценки пакета: одна текущая оценка на находку.
func (r *VerificationAIRepo) SaveAssessments(
	ctx context.Context, tenderID, requestID, modelID, promptVersion string,
	findings map[string]triage.Finding, assessments []triage.Assessment,
) error {
	if len(assessments) == 0 {
		return nil
	}
	ids, codes, prints, labels, reasons, evidence := make([]string, 0, len(assessments)),
		make([]string, 0, len(assessments)), make([]string, 0, len(assessments)),
		make([]string, 0, len(assessments)), make([]string, 0, len(assessments)), make([]string, 0, len(assessments))
	downgraded := make([]bool, 0, len(assessments))
	for _, a := range assessments {
		f, ok := findings[a.FindingID]
		if !ok {
			continue
		}
		ev := a.Evidence
		if ev == nil {
			ev = []triage.Evidence{}
		}
		js, err := json.Marshal(ev)
		if err != nil {
			return fmt.Errorf("verificationAI.SaveAssessments: evidence: %w", err)
		}
		ids = append(ids, a.FindingID)
		codes = append(codes, f.RuleCode)
		prints = append(prints, f.Fingerprint)
		labels = append(labels, a.Label)
		reasons = append(reasons, a.Reason)
		evidence = append(evidence, string(js))
		downgraded = append(downgraded, a.Downgraded)
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.verification_ai_assessments
			(finding_id, tender_id, rule_code, fingerprint, prompt_version, model_id, label, reason,
			 evidence, downgraded, request_id)
		SELECT x.finding_id, $1::uuid, x.rule_code, x.fingerprint, $2, $3, x.label, x.reason,
		       x.evidence::jsonb, x.downgraded, $4::uuid
		FROM unnest($5::uuid[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::boolean[])
		     AS x(finding_id, rule_code, fingerprint, label, reason, evidence, downgraded)
		ON CONFLICT (finding_id) DO UPDATE
		SET rule_code = EXCLUDED.rule_code, fingerprint = EXCLUDED.fingerprint,
		    prompt_version = EXCLUDED.prompt_version, model_id = EXCLUDED.model_id,
		    label = EXCLUDED.label, reason = EXCLUDED.reason, evidence = EXCLUDED.evidence,
		    downgraded = EXCLUDED.downgraded, request_id = EXCLUDED.request_id, created_at = now()`,
		tenderID, promptVersion, modelID, requestID, ids, codes, prints, labels, reasons, evidence, downgraded)
	if err != nil {
		return fmt.Errorf("verificationAI.SaveAssessments: %w", err)
	}
	return nil
}

// AIAssessmentView — оценка для страницы и API.
type AIAssessmentView struct {
	FindingID string            `json:"finding_id"`
	RuleCode  string            `json:"rule_code"`
	Label     string            `json:"label"`
	Reason    string            `json:"reason"`
	Evidence  []triage.Evidence `json:"evidence"`
	// Current — данные находки с оценки не менялись и промпт тот же.
	Current   bool      `json:"current"`
	ModelID   string    `json:"model_id"`
	CreatedAt time.Time `json:"created_at"`
}

// ListAssessments — оценки открытых находок тендера.
func (r *VerificationAIRepo) ListAssessments(ctx context.Context, tenderID, promptVersion string) ([]AIAssessmentView, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT a.finding_id::text, a.rule_code, a.label, a.reason, a.evidence::text,
		       a.fingerprint = vf.fingerprint AND a.prompt_version = $2, a.model_id, a.created_at
		FROM public.verification_ai_assessments a
		JOIN public.verification_findings vf ON vf.id = a.finding_id
		WHERE a.tender_id = $1 AND vf.resolved_at IS NULL
		ORDER BY a.created_at DESC`, tenderID, promptVersion)
	if err != nil {
		return nil, fmt.Errorf("verificationAI.ListAssessments: %w", err)
	}
	defer rows.Close()
	out := []AIAssessmentView{}
	for rows.Next() {
		var v AIAssessmentView
		var ev string
		if err := rows.Scan(&v.FindingID, &v.RuleCode, &v.Label, &v.Reason, &ev, &v.Current, &v.ModelID,
			&v.CreatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(ev), &v.Evidence); err != nil {
			v.Evidence = []triage.Evidence{}
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// AIAgreement — совпадение оценок ИИ с вердиктами инженеров на тех же данных.
type AIAgreement struct {
	ErrorAgreed int `json:"error_agreed"` // ИИ: ошибка, инженер: ошибка
	ErrorMissed int `json:"error_missed"` // ИИ: ошибка, инженер: норма
	OKAgreed    int `json:"ok_agreed"`    // ИИ: норма, инженер: норма
	OKMissed    int `json:"ok_missed"`    // ИИ: норма, инженер: ошибка — самое опасное
	Unsure      int `json:"unsure"`
}

func (r *VerificationAIRepo) Agreement(ctx context.Context) (*AIAgreement, error) {
	a := &AIAgreement{}
	err := r.pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE a.label = 'likely_error' AND qa.verdict = 'error'),
		       count(*) FILTER (WHERE a.label = 'likely_error' AND qa.verdict = 'accepted'),
		       count(*) FILTER (WHERE a.label = 'likely_ok' AND qa.verdict = 'accepted'),
		       count(*) FILTER (WHERE a.label = 'likely_ok' AND qa.verdict = 'error'),
		       count(*) FILTER (WHERE a.label = 'unsure')
		FROM public.verification_ai_assessments a
		JOIN public.verification_findings vf ON vf.id = a.finding_id
		JOIN public.quality_acknowledgements qa
		  ON qa.tender_id = vf.tender_id AND qa.rule_code = vf.rule_code
		 AND qa.entity_id = vf.entity_id AND qa.fingerprint = a.fingerprint`).
		Scan(&a.ErrorAgreed, &a.ErrorMissed, &a.OKAgreed, &a.OKMissed, &a.Unsure)
	if err != nil {
		return nil, fmt.Errorf("verificationAI.Agreement: %w", err)
	}
	return a, nil
}
