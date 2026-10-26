package services

import (
	"context"

	"github.com/su10/hubtender/backend/internal/ai/triage"
)

// ExternalAssessment — оценка находки, присланная внешним скриптом (офисный ПК).
// Поля уже проверены и обрезаны хендлером.
type ExternalAssessment struct {
	FindingID   string
	Fingerprint string
	Label       string
	Reason      string
	Evidence    []triage.Evidence
}

// ExternalAssessmentsResult — сколько оценок записано и сколько пропущено.
type ExternalAssessmentsResult struct {
	Saved   int `json:"saved"`
	Skipped int `json:"skipped"`
}

// SaveExternalAssessments записывает внешние оценки находок тендера. Пропускает
// оценки находок, которых нет у этого тендера, закрытых находок и оценок с
// устаревшим отпечатком (данные изменились, пока скрипт думал). Если одна находка
// встретилась в пакете несколько раз, записывается последняя оценка, остальные
// считаются пропущенными. Остальное пишется как у серверного разбора, но без
// запроса в журнале (request_id пустой) и с версией промпта скрипта «ext:…».
func (s *VerificationAIService) SaveExternalAssessments(
	ctx context.Context, tenderID, modelID, promptVersion string, items []ExternalAssessment,
) (*ExternalAssessmentsResult, error) {
	last := make(map[string]int, len(items))
	ids := make([]string, 0, len(items))
	for i, it := range items {
		if _, dup := last[it.FindingID]; !dup {
			ids = append(ids, it.FindingID)
		}
		last[it.FindingID] = i
	}
	found, err := s.repo.FindingsByIDs(ctx, tenderID, ids)
	if err != nil {
		return nil, err
	}
	refs := make(map[string]triage.Finding, len(found))
	open := make(map[string]string, len(found)) // id → отпечаток открытой находки
	for _, f := range found {
		if f.Open {
			open[f.ID] = f.Fingerprint
			refs[f.ID] = triage.Finding{ID: f.ID, RuleCode: f.RuleCode, Fingerprint: f.Fingerprint}
		}
	}
	byID := make(map[string]triage.Finding, len(items))
	assessments := make([]triage.Assessment, 0, len(items))
	for id, i := range last {
		it := items[i]
		if fp, ok := open[id]; !ok || fp != it.Fingerprint {
			continue
		}
		byID[id] = refs[id]
		ev := it.Evidence
		if ev == nil {
			ev = []triage.Evidence{}
		}
		assessments = append(assessments, triage.Assessment{
			FindingID: id, Label: it.Label, Reason: it.Reason, Evidence: ev,
		})
	}
	if len(assessments) > 0 {
		if err := s.repo.SaveAssessments(ctx, tenderID, "", modelID, promptVersion, byID, assessments); err != nil {
			return nil, err
		}
	}
	return &ExternalAssessmentsResult{Saved: len(assessments), Skipped: len(items) - len(assessments)}, nil
}
