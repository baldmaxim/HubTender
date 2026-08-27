package repository

import (
	"strings"
	"testing"
	"time"
)

// Машинный список тендеров: ограничение ключа по тендерам попадает в WHERE,
// потолок жёсткий, курсора нет.

func TestBuildTenderBriefQuery_NoFilters(t *testing.T) {
	q, args := buildTenderBriefQuery(TenderBriefParams{})

	if len(args) != 0 {
		t.Fatalf("без фильтров аргументов быть не должно, получено %d", len(args))
	}
	if !strings.Contains(q, "LIMIT 1000") {
		t.Fatal("потерян потолок LIMIT 1000")
	}
	if !strings.Contains(q, "ORDER BY tender_number, version DESC NULLS LAST, id") {
		t.Fatal("потеряна сортировка по номеру тендера и версии")
	}
	for _, leaked := range []string{"cached_grand_total", "usd_rate", "bsm_link", "financial_"} {
		if strings.Contains(q, leaked) {
			t.Fatalf("узкая проекция не должна отдавать %q", leaked)
		}
	}
}

func TestBuildTenderBriefQuery_RestrictedKeyFiltersByIDs(t *testing.T) {
	archived := false
	q, args := buildTenderBriefQuery(TenderBriefParams{
		IsArchived: &archived,
		Search:     "жк",
		IDs:        []string{"t-1", "t-2"},
	})

	if len(args) != 3 {
		t.Fatalf("ожидалось 3 аргумента, получено %d", len(args))
	}
	if !strings.Contains(q, "is_archived = $1") {
		t.Fatalf("фильтр архива должен быть $1, запрос:\n%s", q)
	}
	if !strings.Contains(q, "tender_number ILIKE $2") {
		t.Fatalf("поиск должен идти и по номеру тендера ($2), запрос:\n%s", q)
	}
	if !strings.Contains(q, "id = ANY($3::uuid[])") {
		t.Fatalf("ограничение ключа должно быть ANY($3::uuid[]), запрос:\n%s", q)
	}
	ids, ok := args[2].([]string)
	if !ok || len(ids) != 2 {
		t.Fatalf("третий аргумент — список id ключа, получено %#v", args[2])
	}
}

func TestBuildTenderBriefQuery_EmptyIDsMeansNoRestriction(t *testing.T) {
	q, _ := buildTenderBriefQuery(TenderBriefParams{IDs: []string{}})
	if strings.Contains(q, "ANY(") {
		t.Fatal("пустой список id не должен ограничивать выборку")
	}
}

// Список позиций: производные поля раздела в проекции, курсор и LIMIT не
// съезжают по номерам плейсхолдеров.

func TestBuildPositionListQuery_ProjectsSectionFields(t *testing.T) {
	q, args := buildPositionListQuery(PositionListParams{TenderID: "t-1"})

	for _, col := range []string{
		"AS is_section", "sec.cost_category_id", "sec.cost_category_name",
		"client_note", "section_number", "manual_volume",
	} {
		if !strings.Contains(q, col) {
			t.Fatalf("проекция ListPositions потеряла %q", col)
		}
	}
	if len(args) != 2 || args[1] != 50 {
		t.Fatalf("ожидались tender_id + LIMIT 50 по умолчанию, получено %#v", args)
	}
	if !strings.Contains(q, "LIMIT $2") {
		t.Fatalf("LIMIT должен ссылаться на $2, запрос:\n%s", q)
	}
	if !strings.Contains(q, "COALESCE(n.is_additional, false) = false") {
		t.Fatal("дополнительные позиции должны пропускаться при поиске следующей (как computeLeafPositions)")
	}
}

func TestBuildPositionListQuery_CursorArgOrder(t *testing.T) {
	ts := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	id := "p-9"
	q, args := buildPositionListQuery(PositionListParams{
		TenderID: "t-1", CursorUpdatedAt: &ts, CursorID: &id, Limit: 500,
	})

	if len(args) != 4 {
		t.Fatalf("ожидалось tender_id + 2 курсора + LIMIT, получено %d", len(args))
	}
	if args[3] != 200 {
		t.Fatalf("LIMIT обязан обрезаться до 200, получено %v", args[3])
	}
	if !strings.Contains(q, "(updated_at, id) < ($2, $3)") || !strings.Contains(q, "LIMIT $4") {
		t.Fatalf("курсор $2,$3 и LIMIT $4 обязательны, запрос:\n%s", q)
	}
}
