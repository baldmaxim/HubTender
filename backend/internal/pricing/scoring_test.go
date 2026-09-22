package pricing

import (
	"strings"
	"testing"
	"time"
)

func TestScoreCandidateExact(t *testing.T) {
	now := time.Now().UTC()
	unit := "шт"
	c := ArchiveCandidate{ItemName: "Мобильный пресс-компактор", PositionName: "Технологическое оборудование", UnitCode: &unit, TenderDate: now.Add(-30 * 24 * time.Hour)}
	score, level, _, ok := ScoreCandidate("Мобильный пресс-компактор", "шт", "", "", "", c, now)
	if !ok || level != "exact" || score < 0.95 {
		t.Fatalf("unexpected match: ok=%v level=%s score=%f", ok, level, score)
	}
}

func TestScoreCandidateRejectsFurnitureWorkForCompactor(t *testing.T) {
	now := time.Now().UTC()
	unit := "шт"
	c := ArchiveCandidate{ItemName: "Монтаж мебели", PositionName: "Мобильный пресс-компактор", UnitCode: &unit, TenderDate: now}
	if _, _, _, ok := ScoreCandidate("Пресскомпактор", "шт", "", "", "", c, now); ok {
		t.Fatal("furniture installation must never match a compactor")
	}
}

func TestScoreCandidateAllowsReviewedEquipmentAnalog(t *testing.T) {
	now := time.Now().UTC()
	unit, category := "шт", "cat-1"
	c := ArchiveCandidate{ItemName: "Монтаж технологического оборудования", PositionName: "Мобильный пресскомпактор", UnitCode: &unit, DetailCostCategoryID: &category, TenderDate: now}
	score, level, _, ok := ScoreCandidate("Пресскомпактор", "шт", category, "", "", c, now)
	if !ok || level != "review" || score < 0.70 {
		t.Fatalf("expected review analog, got ok=%v level=%s score=%f", ok, level, score)
	}
}

func TestScoreCandidateFlagsStaleSource(t *testing.T) {
	now := time.Now().UTC()
	unit := "шт"
	c := ArchiveCandidate{ItemName: "Колесоотбойник", UnitCode: &unit, TenderDate: now.Add(-400 * 24 * time.Hour)}
	_, _, warnings, ok := ScoreCandidate("Колесоотбойник", "шт", "", "", "", c, now)
	if !ok || len(warnings) == 0 || !strings.Contains(warnings[0], "180") {
		t.Fatalf("expected stale warning: %#v", warnings)
	}
}

func TestApplyOutlierWarnings(t *testing.T) {
	a, b, c := 100.0, 105.0, 300.0
	rows := ApplyOutlierWarnings([]ArchiveCandidate{{HistoricalRUBUnitRate: &a}, {HistoricalRUBUnitRate: &b}, {HistoricalRUBUnitRate: &c}})
	if len(rows[2].Warnings) == 0 {
		t.Fatal("expected >50% median outlier warning")
	}
}
