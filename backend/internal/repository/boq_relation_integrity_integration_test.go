package repository

import (
	"context"
	"strings"
	"testing"
)

// PostgreSQL integration tests for stage 2.4 (§8/§18.14-17): составные FK
// закрывают cross-tender/cross-position связи BOQ на уровне БД.
// COMPILED + SKIPPED без HUBTENDER_TEST_DATABASE_URL.

// §18.14: BOQ item с позицией другого тендера отклоняется БД.
func TestBoqRelationIntegrity_CrossTenderPositionRejected(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	tenderA, _ := seedSourceTender(t, pool, "RI-A1")
	_, posB := seedSourceTender(t, pool, "RI-A2")
	workNameID, _ := ensureTestNames(t, pool)

	_, err := pool.Exec(ctx, `
		INSERT INTO public.boq_items
			(tender_id, client_position_id, boq_item_type, description, unit_code,
			 quantity, unit_rate, currency_type, work_name_id)
		VALUES ($1::uuid, $2::uuid, 'раб', 'cross-tender', 'м2', 1, 1, 'RUB', $3::uuid)`,
		tenderA, posB, workNameID)
	if err == nil {
		t.Fatal("cross-tender position insert must be rejected by composite FK")
	}
	if !strings.Contains(err.Error(), "boq_items_position_scope_fkey") {
		t.Fatalf("want composite FK violation, got: %v", err)
	}
}

// §18.15-16: parent из другого тендера/позиции отклоняется; §18.17: валидный
// parent той же позиции разрешён.
func TestBoqRelationIntegrity_ParentScope(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	tenderA, posA := seedSourceTender(t, pool, "RI-B1")
	tenderB, posB := seedSourceTender(t, pool, "RI-B2")
	workNameID, matNameID := ensureTestNames(t, pool)

	insertWork := func(tenderID, posID string) string {
		var id string
		if err := pool.QueryRow(ctx, `
			INSERT INTO public.boq_items
				(tender_id, client_position_id, boq_item_type, description, unit_code,
				 quantity, unit_rate, currency_type, work_name_id)
			VALUES ($1::uuid, $2::uuid, 'раб', 'работа', 'м2', 1, 1, 'RUB', $3::uuid)
			RETURNING id::text`, tenderID, posID, workNameID).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	workA := insertWork(tenderA, posA)
	workB := insertWork(tenderB, posB)

	insertChild := func(tenderID, posID, parentID string) error {
		_, err := pool.Exec(ctx, `
			INSERT INTO public.boq_items
				(tender_id, client_position_id, boq_item_type, material_type, description,
				 unit_code, quantity, unit_rate, currency_type, parent_work_item_id, material_name_id)
			VALUES ($1::uuid, $2::uuid, 'мат', 'основн.', 'материал', 'шт', 1, 1, 'RUB', $3::uuid, $4::uuid)`,
			tenderID, posID, parentID, matNameID)
		return err
	}

	// §18.15: parent из другого тендера.
	if err := insertChild(tenderA, posA, workB); err == nil {
		t.Fatal("cross-tender parent must be rejected")
	} else if !strings.Contains(err.Error(), "boq_items_parent_scope_fkey") {
		t.Fatalf("want parent scope FK, got: %v", err)
	}

	// §18.16: parent из другой позиции того же тендера.
	var posA2 string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.client_positions (tender_id, position_number, work_name)
		VALUES ($1::uuid, 777, 'вторая позиция') RETURNING id::text`, tenderA).Scan(&posA2); err != nil {
		t.Fatal(err)
	}
	if err := insertChild(tenderA, posA2, workA); err == nil {
		t.Fatal("cross-position parent must be rejected")
	} else if !strings.Contains(err.Error(), "boq_items_parent_scope_fkey") {
		t.Fatalf("want parent scope FK, got: %v", err)
	}

	// §18.17: валидный parent (тот же tender + та же позиция) разрешён.
	if err := insertChild(tenderA, posA, workA); err != nil {
		t.Fatalf("valid parent must be allowed: %v", err)
	}

	// Dangling parent невозможен: удаление работы каскадно удаляет ребёнка.
	if _, err := pool.Exec(ctx, `DELETE FROM public.boq_items WHERE id=$1::uuid`, workA); err != nil {
		t.Fatalf("delete parent: %v", err)
	}
	var orphans int
	_ = pool.QueryRow(ctx, `
		SELECT count(*) FROM public.boq_items WHERE parent_work_item_id=$1::uuid`, workA).Scan(&orphans)
	if orphans != 0 {
		t.Fatalf("cascade must remove children: %d", orphans)
	}
}
