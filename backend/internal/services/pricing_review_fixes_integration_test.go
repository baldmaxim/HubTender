//go:build integration

package services

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/su10/hubtender/backend/internal/actorctx"
	"github.com/su10/hubtender/backend/internal/pricing"
	"github.com/su10/hubtender/backend/internal/repository"
)

func TestMCPPricingReviewRenameInvalidatesConsent(t *testing.T) {
	ctx, pool, svc, p, in := checksFixture(t)
	created, err := svc.ApplyDirectPrice(ctx, p, in)
	if err != nil {
		t.Fatal(err)
	}
	q := 5.0
	update := DirectPricingInput{TenderID: checksTender, TargetPositionID: checksPosition, TargetItemID: &created.ItemID, SourceKind: "current", Quantity: &q, ExpectedETag: &created.ETag, ExpectedRevision: 1, RequestKey: "fixed-review-name-001", Confirm: true}
	before, err := svc.PreviewDirectPrice(ctx, p, update)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE public.work_names SET name='Changed nomenclature meaning' WHERE id=$1`, checksWorkName); err != nil {
		t.Fatal(err)
	}
	after, err := svc.PreviewDirectPrice(ctx, p, update)
	if err != nil {
		t.Fatal(err)
	}
	if before.Name == after.Name || before.Checks.Fingerprint == after.Checks.Fingerprint {
		t.Fatal("renamed nomenclature is not bound to consent")
	}
	update.ExpectedChecksFingerprint = before.Checks.Fingerprint
	if _, err := svc.ApplyDirectPrice(ctx, p, update); err == nil || !strings.Contains(err.Error(), "CHECKS_CHANGED") {
		t.Fatalf("old name consent accepted: %v", err)
	}
	update.ExpectedChecksFingerprint = after.Checks.Fingerprint
	if _, err := svc.ApplyDirectPrice(ctx, p, update); err != nil {
		t.Fatal(err)
	}
}

// otherEngineer is a second approved engineer with an active grant of the same
// OAuth client.
func otherEngineer(t *testing.T, ctx context.Context, pool *pgxpool.Pool, p pricing.Principal) pricing.Principal {
	t.Helper()
	other := p
	other.UserID = "dddddddd-9000-0000-0000-000000000099"
	must := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO auth.users(id,email) VALUES($1,'authorship-other@example.test') ON CONFLICT (id) DO NOTHING`, other.UserID)
	must(`INSERT INTO public.users(id,full_name,email,access_status,access_enabled,role_code,allowed_pages) VALUES($1,'Other engineer','authorship-other@example.test','approved',true,'engineer','["/positions","/library"]') ON CONFLICT (id) DO NOTHING`, other.UserID)
	must(`INSERT INTO app_auth.oauth_grants(user_id,client_id,scopes) VALUES($1,$2,$3) ON CONFLICT (user_id,client_id) DO UPDATE SET revoked_at=NULL`, other.UserID, p.ClientID, p.Scopes)
	t.Cleanup(func() {
		must(`DELETE FROM public.mcp_direct_pricing_requests WHERE actor_id=$1`, other.UserID)
		must(`DELETE FROM public.boq_items_audit WHERE changed_by=$1`, other.UserID)
		must(`DELETE FROM public.client_position_gp_audit WHERE changed_by=$1`, other.UserID)
		must(`DELETE FROM app_auth.oauth_grants WHERE user_id=$1`, other.UserID)
		must(`DELETE FROM public.users WHERE id=$1`, other.UserID)
		must(`DELETE FROM auth.users WHERE id=$1`, other.UserID)
	})
	return other
}

func requireNotAuthor(t *testing.T, err error, author string) {
	t.Helper()
	if err == nil || !strings.Contains(err.Error(), "MCP_NOT_AUTHOR") || !strings.Contains(err.Error(), author) {
		t.Fatalf("expected MCP_NOT_AUTHOR naming %q, got %v", author, err)
	}
}

func TestMCPAuthorshipForeignRowsAreReadOnlyThroughMCP(t *testing.T) {
	ctx, pool, svc, p, in := checksFixture(t)
	created, err := svc.ApplyDirectPrice(ctx, p, in)
	if err != nil {
		t.Fatal(err)
	}
	other := otherEngineer(t, ctx, pool, p)
	q := 5.0
	update := DirectPricingInput{TenderID: checksTender, TargetPositionID: checksPosition, TargetItemID: &created.ItemID, SourceKind: "current", Quantity: &q, ExpectedETag: &created.ETag, ExpectedRevision: 1, RequestKey: "authorship-other-001", Confirm: true}
	_, err = svc.PreviewDirectPrice(ctx, other, update)
	requireNotAuthor(t, err, "MCP Eval")
	_, err = svc.ApplyDirectPrice(ctx, other, update)
	requireNotAuthor(t, err, "MCP Eval")
	_, err = svc.ApplyDirectDelete(ctx, other, DirectDeleteInput{TenderID: checksTender, ItemID: created.ItemID, ExpectedETag: created.ETag, ExpectedRevision: 1, RequestKey: "authorship-other-del-01"})
	requireNotAuthor(t, err, "MCP Eval")
	var count int
	var revision int64
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM public.boq_items WHERE tender_id=$1),financial_input_revision FROM public.tenders WHERE id=$1`, checksTender).Scan(&count, &revision); err != nil || count != 1 || revision != 1 {
		t.Fatalf("rejected MCP writes changed state: %d %d %v", count, revision, err)
	}

	// The portal is not restricted; its edit makes the other engineer the last author.
	q2 := 7.0
	edited, err := repository.NewBoqRepo(pool).UpdateBoqItem(actorctx.WithUserID(ctx, other.UserID), created.ItemID, repository.BoqItemPatch{Quantity: &q2, ChangedBy: other.UserID})
	if err != nil {
		t.Fatalf("portal edit of a foreign row must stay allowed: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT financial_input_revision FROM public.tenders WHERE id=$1`, checksTender).Scan(&revision); err != nil {
		t.Fatal(err)
	}
	_, etag, err := svc.repo.GetCurrentBoqItem(ctx, edited.ID)
	if err != nil {
		t.Fatal(err)
	}
	update.ExpectedETag, update.ExpectedRevision, update.RequestKey = &etag, revision, "authorship-owner-after-portal"
	_, err = svc.ApplyDirectPrice(ctx, p, update)
	requireNotAuthor(t, err, "Other engineer")
	update.RequestKey = "authorship-other-after-portal"
	if _, err := svc.ApplyDirectPrice(ctx, other, update); err != nil {
		t.Fatalf("last author must be able to change the row: %v", err)
	}
}

func TestMCPAuthorshipRowWithoutAuthorIsReadOnlyButPositionAcceptsNewRows(t *testing.T) {
	ctx, pool, svc, p, in := checksFixture(t)
	// A row copied into a version or written by a system job has no author.
	var itemID string
	if err := pool.QueryRow(ctx, `INSERT INTO public.boq_items(tender_id,client_position_id,boq_item_type,work_name_id,unit_code,quantity,unit_rate,currency_type,total_amount,detail_cost_category_id) VALUES($1,$2,'суб-раб',$3,'шт',10,100,'RUB',1000,'eeeeeeee-0000-0000-0000-000000000002') RETURNING id::text`, checksTender, checksPosition, checksWorkName).Scan(&itemID); err != nil {
		t.Fatal(err)
	}
	_, etag, err := svc.repo.GetCurrentBoqItem(ctx, itemID)
	if err != nil {
		t.Fatal(err)
	}
	q := 5.0
	_, err = svc.PreviewDirectPrice(ctx, p, DirectPricingInput{TenderID: checksTender, TargetPositionID: checksPosition, TargetItemID: &itemID, SourceKind: "current", Quantity: &q, ExpectedETag: &etag, ExpectedRevision: 0, RequestKey: "authorship-unknown-001", Confirm: true})
	if err == nil || !strings.Contains(err.Error(), "MCP_NOT_AUTHOR") || !strings.Contains(err.Error(), "нет автора") {
		t.Fatalf("row without an author changed through MCP: %v", err)
	}
	in.ExpectedRevision = 0
	if _, err := svc.ApplyDirectPrice(ctx, p, in); err != nil {
		t.Fatalf("adding a row next to someone else's must stay allowed: %v", err)
	}
}

func TestMCPAuthorshipIgnoresDerivedRecalculation(t *testing.T) {
	ctx, pool, svc, p, in := checksFixture(t)
	created, err := svc.ApplyDirectPrice(ctx, p, in)
	if err != nil {
		t.Fatal(err)
	}
	other := otherEngineer(t, ctx, pool, p)
	// A recalculation by another user touches only derived fields.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `SELECT set_config('app.user_id',$1,true)`, other.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE public.boq_items SET total_amount=total_amount+1, sort_number=sort_number+1 WHERE id=$1`, created.ItemID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var author string
	if err := pool.QueryRow(ctx, `SELECT changed_by::text FROM public.boq_item_last_authorship($1)`, created.ItemID).Scan(&author); err != nil || author != p.UserID {
		t.Fatalf("derived recalculation transferred authorship: %s %v", author, err)
	}
}

func TestMCPDeleteRemovesOwnWorkWithLinkedMaterials(t *testing.T) {
	ctx, pool, svc, p, in := checksFixture(t)
	work, err := svc.ApplyDirectPrice(ctx, p, in)
	if err != nil {
		t.Fatal(err)
	}
	var materialID string
	if err := pool.QueryRow(ctx, `INSERT INTO public.material_names(name,unit) VALUES('Authorship linked material','шт') RETURNING id::text`).Scan(&materialID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM public.material_names WHERE id=$1`, materialID) })
	// The linked material is written by the same engineer in the portal.
	child, err := repository.NewBoqRepo(pool).CreateBoqItem(actorctx.WithUserID(ctx, p.UserID), repository.CreateBoqItemInput{
		TenderID: checksTender, ClientPositionID: checksPosition, BoqItemType: "суб-мат", MaterialNameID: &materialID,
		UnitCode: stringPtr("шт"), ConversionCoefficient: f64(1), ConsumptionCoefficient: f64(1),
		UnitRate: f64(10), CurrencyType: stringPtr("RUB"), ParentWorkItemID: &work.ItemID,
		DetailCostCategoryID: stringPtr("eeeeeeee-0000-0000-0000-000000000002"), CreatedBy: p.UserID,
	})
	if err != nil {
		t.Fatal(err)
	}
	var revision int64
	if err := pool.QueryRow(ctx, `SELECT financial_input_revision FROM public.tenders WHERE id=$1`, checksTender).Scan(&revision); err != nil {
		t.Fatal(err)
	}
	_, etag, err := svc.repo.GetCurrentBoqItem(ctx, work.ItemID)
	if err != nil {
		t.Fatal(err)
	}
	del := DirectDeleteInput{TenderID: checksTender, ItemID: work.ItemID, ExpectedETag: etag, ExpectedRevision: revision, RequestKey: "authorship-delete-work-01"}
	preview, err := svc.PreviewDirectDelete(ctx, p, del)
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.Deleted) != 2 || preview.Deleted[1].ItemID != child.ID || preview.Context == nil || preview.Context.Position == "" {
		t.Fatalf("preview must list the work and its linked material: %+v", preview)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.boq_items WHERE tender_id=$1`, checksTender).Scan(&count); err != nil || count != 2 {
		t.Fatalf("preview deleted rows: %d %v", count, err)
	}
	out, err := svc.ApplyDirectDelete(ctx, p, del)
	if err != nil {
		t.Fatal(err)
	}
	var audits int
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM public.boq_items WHERE tender_id=$1),
		(SELECT count(*) FROM public.boq_items_audit WHERE operation_type='DELETE' AND changed_by=$2 AND boq_item_id IN ($3,$4))`,
		checksTender, p.UserID, work.ItemID, child.ID).Scan(&count, &audits); err != nil || count != 0 || audits != 2 {
		t.Fatalf("delete: rows=%d audits=%d err=%v", count, audits, err)
	}
	again, err := svc.ApplyDirectDelete(ctx, p, del)
	if err != nil || !again.Replayed || again.ItemID != out.ItemID {
		t.Fatalf("receipt replay: %+v %v", again, err)
	}
}

func TestMCPDeleteRejectsWorkWithForeignLinkedMaterial(t *testing.T) {
	ctx, pool, svc, p, in := checksFixture(t)
	work, err := svc.ApplyDirectPrice(ctx, p, in)
	if err != nil {
		t.Fatal(err)
	}
	other := otherEngineer(t, ctx, pool, p)
	var materialID string
	if err := pool.QueryRow(ctx, `INSERT INTO public.material_names(name,unit) VALUES('Authorship foreign material','шт') RETURNING id::text`).Scan(&materialID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM public.material_names WHERE id=$1`, materialID) })
	if _, err := repository.NewBoqRepo(pool).CreateBoqItem(actorctx.WithUserID(ctx, other.UserID), repository.CreateBoqItemInput{
		TenderID: checksTender, ClientPositionID: checksPosition, BoqItemType: "суб-мат", MaterialNameID: &materialID,
		UnitCode: stringPtr("шт"), ConversionCoefficient: f64(1), ConsumptionCoefficient: f64(1),
		UnitRate: f64(10), CurrencyType: stringPtr("RUB"), ParentWorkItemID: &work.ItemID, CreatedBy: other.UserID,
	}); err != nil {
		t.Fatal(err)
	}
	var revision int64
	if err := pool.QueryRow(ctx, `SELECT financial_input_revision FROM public.tenders WHERE id=$1`, checksTender).Scan(&revision); err != nil {
		t.Fatal(err)
	}
	_, etag, err := svc.repo.GetCurrentBoqItem(ctx, work.ItemID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = svc.ApplyDirectDelete(ctx, p, DirectDeleteInput{TenderID: checksTender, ItemID: work.ItemID, ExpectedETag: etag, ExpectedRevision: revision, RequestKey: "authorship-delete-foreign-1"})
	requireNotAuthor(t, err, "Other engineer")
	// A work quantity change would recalculate the foreign material too.
	q := 20.0
	_, err = svc.PreviewDirectPrice(ctx, p, DirectPricingInput{TenderID: checksTender, TargetPositionID: checksPosition, TargetItemID: &work.ItemID, SourceKind: "current", Quantity: &q, ExpectedETag: &etag, ExpectedRevision: revision, RequestKey: "authorship-work-qty-foreign", Confirm: true})
	requireNotAuthor(t, err, "Other engineer")
}

func TestMCPPositionGPRulesAndJournal(t *testing.T) {
	ctx, pool, svc, p, _ := checksFixture(t)
	other := otherEngineer(t, ctx, pool, p)
	eleven, twelve := 11.0, 12.0
	gp := PositionGPInput{TenderID: checksTender, PositionID: checksPosition, Quantity: &eleven, ExpectedRevision: 0, RequestKey: "authorship-gp-other-0001"}
	_, err := svc.ApplyPositionGP(ctx, other, gp)
	requireNotAuthor(t, err, "MCP Eval")

	preview, err := svc.PreviewPositionGP(ctx, p, PositionGPInput{TenderID: checksTender, PositionID: checksPosition, Quantity: &eleven, ExpectedRevision: 0, RequestKey: "authorship-gp-owner-0001"})
	if err != nil || preview.PreviousQuantity == nil || *preview.PreviousQuantity != 10 || *preview.Quantity != 11 {
		t.Fatalf("GP preview: %+v %v", preview, err)
	}
	var journal int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.client_position_gp_audit WHERE client_position_id=$1`, checksPosition).Scan(&journal); err != nil || journal != 1 {
		t.Fatalf("preview leaked into the GP journal: %d %v", journal, err)
	}
	written, err := svc.ApplyPositionGP(ctx, p, PositionGPInput{TenderID: checksTender, PositionID: checksPosition, Quantity: &eleven, ExpectedRevision: 0, RequestKey: "authorship-gp-owner-0001"})
	if err != nil {
		t.Fatal(err)
	}
	var before, after float64
	var actor, key string
	if err := pool.QueryRow(ctx, `SELECT old_manual_volume,new_manual_volume,changed_by::text,request_key FROM public.client_position_gp_audit WHERE client_position_id=$1 AND origin='edit' AND request_key IS NOT NULL`, checksPosition).Scan(&before, &after, &actor, &key); err != nil {
		t.Fatal(err)
	}
	if before != 10 || after != 11 || actor != p.UserID || key != "authorship-gp-owner-0001" {
		t.Fatalf("GP journal: %v %v %s %s", before, after, actor, key)
	}
	if again, err := svc.ApplyPositionGP(ctx, p, PositionGPInput{TenderID: checksTender, PositionID: checksPosition, Quantity: &eleven, ExpectedRevision: 0, RequestKey: "authorship-gp-owner-0001"}); err != nil || !again.Replayed {
		t.Fatalf("GP replay: %+v %v", again, err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.client_position_gp_audit WHERE client_position_id=$1`, checksPosition).Scan(&journal); err != nil || journal != 2 {
		t.Fatalf("GP replay duplicated the journal: %d %v", journal, err)
	}

	// An empty note may be filled by anyone; then only its author changes it.
	note := "по чертежу"
	if _, err := svc.ApplyPositionGP(ctx, other, PositionGPInput{TenderID: checksTender, PositionID: checksPosition, Note: &note, ExpectedRevision: written.FinancialInputRevision, RequestKey: "authorship-gp-note-other1"}); err != nil {
		t.Fatalf("filling an empty note: %v", err)
	}
	changed := "по спецификации"
	_, err = svc.ApplyPositionGP(ctx, p, PositionGPInput{TenderID: checksTender, PositionID: checksPosition, Note: &changed, ExpectedRevision: written.FinancialInputRevision + 1, RequestKey: "authorship-gp-note-owner1"})
	requireNotAuthor(t, err, "Other engineer")
	if _, err := svc.ApplyPositionGP(ctx, p, PositionGPInput{TenderID: checksTender, PositionID: checksPosition, Quantity: &twelve, ExpectedRevision: written.FinancialInputRevision + 1, RequestKey: "authorship-gp-qty-owner-2"}); err != nil {
		t.Fatalf("quantity author must keep changing the quantity: %v", err)
	}
}

func TestMCPPricingReviewGPAuditIsAtomicAndRecordsActor(t *testing.T) {
	ctx, pool, svc, p, in := checksFixture(t)
	gp := 11.0
	in.PositionQuantity = &gp
	if _, err := svc.PreviewDirectPrice(ctx, p, in); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.client_position_gp_audit WHERE client_position_id=$1 AND origin='edit' AND request_key IS NOT NULL`, checksPosition).Scan(&count); err != nil || count != 0 {
		t.Fatalf("preview leaked GP audit: %d %v", count, err)
	}
	written, err := svc.ApplyDirectPrice(ctx, p, in)
	if err != nil {
		t.Fatal(err)
	}
	if written.PreviousPositionQuantity == nil || *written.PreviousPositionQuantity != 10 {
		t.Fatal("old GP missing from receipt")
	}
	var before, after float64
	var actor, key string
	if err := pool.QueryRow(ctx, `SELECT old_manual_volume,new_manual_volume,changed_by::text,request_key FROM public.client_position_gp_audit WHERE client_position_id=$1 AND request_key IS NOT NULL`, checksPosition).Scan(&before, &after, &actor, &key); err != nil {
		t.Fatal(err)
	}
	if before != 10 || after != 11 || actor != p.UserID || key != in.RequestKey {
		t.Fatalf("GP audit: %v %v %s %s", before, after, actor, key)
	}
	if _, err := svc.ApplyDirectPrice(ctx, p, in); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.client_position_gp_audit WHERE client_position_id=$1 AND request_key IS NOT NULL`, checksPosition).Scan(&count); err != nil || count != 1 {
		t.Fatalf("receipt replay duplicated audit: %d %v", count, err)
	}
}
