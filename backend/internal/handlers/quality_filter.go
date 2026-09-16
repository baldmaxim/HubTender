package handlers

import (
	"strings"

	"github.com/su10/hubtender/backend/internal/repository"
)

// reportFilter — сужение отчёта о находках для внешнего агента.
type reportFilter struct {
	OnlyNew  bool
	OpenOnly bool
	Rules    map[string]bool
}

func (f reportFilter) empty() bool { return !f.OnlyNew && !f.OpenOnly && len(f.Rules) == 0 }

func splitRules(raw string) map[string]bool {
	out := map[string]bool{}
	for _, code := range strings.Split(raw, ",") {
		if c := strings.TrimSpace(code); c != "" {
			out[strings.ToUpper(c)] = true
		}
	}
	return out
}

// filterReport возвращает копию отчёта с отобранными находками. Исходный отчёт
// лежит в кэше сервиса и отдаётся другим пользователям — менять его нельзя.
func filterReport(rep *repository.QualityReport, f reportFilter) *repository.QualityReport {
	if rep == nil || f.empty() {
		return rep
	}
	out := *rep
	out.Findings = make([]repository.Finding, 0, len(rep.Findings))
	for _, fd := range rep.Findings {
		if f.OnlyNew && !fd.IsNew {
			continue
		}
		if f.OpenOnly && fd.Verdict != nil && *fd.Verdict == "accepted" {
			continue
		}
		if len(f.Rules) > 0 && !f.Rules[strings.ToUpper(fd.RuleCode)] {
			continue
		}
		out.Findings = append(out.Findings, fd)
	}
	return &out
}
