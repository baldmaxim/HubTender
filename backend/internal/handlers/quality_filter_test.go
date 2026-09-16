package handlers

import (
	"testing"

	"github.com/su10/hubtender/backend/internal/repository"
)

func TestFilterReport(t *testing.T) {
	accepted, errV := "accepted", "error"
	rep := &repository.QualityReport{Findings: []repository.Finding{
		{RuleCode: "U", IsNew: true},
		{RuleCode: "U", Verdict: &accepted},
		{RuleCode: "V", IsNew: true, Verdict: &errV},
		{RuleCode: "Q"},
	}}

	if got := filterReport(rep, reportFilter{}); got != rep {
		t.Fatal("без фильтров отчёт должен отдаваться как есть")
	}
	if got := filterReport(rep, reportFilter{OnlyNew: true}); len(got.Findings) != 2 {
		t.Fatalf("only_new: %d", len(got.Findings))
	}
	if got := filterReport(rep, reportFilter{OpenOnly: true}); len(got.Findings) != 3 {
		t.Fatalf("open_only: %d", len(got.Findings))
	}
	if got := filterReport(rep, reportFilter{Rules: splitRules(" u, v ")}); len(got.Findings) != 3 {
		t.Fatalf("rule=u,v: %d", len(got.Findings))
	}
	got := filterReport(rep, reportFilter{OnlyNew: true, OpenOnly: true, Rules: splitRules("V")})
	if len(got.Findings) != 1 || got.Findings[0].RuleCode != "V" {
		t.Fatalf("комбинация фильтров: %+v", got.Findings)
	}
	if len(rep.Findings) != 4 {
		t.Fatal("фильтр изменил кэшированный отчёт")
	}
}
