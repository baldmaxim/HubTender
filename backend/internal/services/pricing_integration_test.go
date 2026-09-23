//go:build integration

package services

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/su10/hubtender/backend/internal/mcpauth"
	"github.com/su10/hubtender/backend/internal/pricing"
	"github.com/su10/hubtender/backend/internal/repository"
)

const (
	evalUser         = "eeeeeeee-9000-0000-0000-000000000001"
	evalClient       = "mcp-evaluation-client"
	targetTender     = "eeeeeeee-3000-0000-0000-000000000001"
	targetPosition   = "eeeeeeee-4000-0000-0000-000000000001"
	templatePosition = "eeeeeeee-4000-0000-0000-000000000099"
	fxTender         = "eeeeeeee-3000-0000-0000-000000000098"
	fxPosition       = "eeeeeeee-4000-0000-0000-000000000098"
	sourceMaterial   = "eeeeeeee-5000-0000-0000-000000000001"
	sourceWork       = "eeeeeeee-5000-0000-0000-000000000002"
	furnitureWork    = "eeeeeeee-5000-0000-0000-000000000003"
)

func TestPricingDraftIntegrationAtomicAndIdempotent(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	seedPricingActor(t, ctx, pool)
	defer cleanupPricingActor(ctx, pool)
	pricingRepo := repository.NewPricingRepo(pool)
	userRepo := repository.NewUserRepo(pool)
	libraryRepo := repository.NewLibraryRepo(pool)
	grantRepo := mcpauth.NewRepository(pool)
	svc := NewPricingService(pricingRepo, userRepo, libraryRepo, grantRepo, PricingFeatures{WriteEnabled: true, TemplateWriteEnabled: false})
	p := pricing.Principal{UserID: evalUser, Email: "mcp-eval@example.com", RoleCode: "engineer", ClientID: evalClient, Scopes: []string{mcpauth.ScopeTendersRead, mcpauth.ScopeArchiveRead, mcpauth.ScopeLibraryRead, mcpauth.ScopePricingDraft, mcpauth.ScopePricingApply}}

	candidates, _, err := svc.SearchArchive(ctx, p, pricing.ArchiveSearchInput{Query: "Мобильный пресс-компактор", Kind: "material", UnitCode: "шт", Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, c := range candidates {
		if c.ItemID == sourceMaterial {
			found = true
		}
		if c.ItemID == furnitureWork {
			t.Fatal("furniture work leaked into compatible material candidates")
		}
	}
	if !found {
		t.Fatal("exact compactor source not found")
	}
	workCandidates, _, err := svc.SearchArchive(ctx, p, pricing.ArchiveSearchInput{Query: "Мобильный пресс-компактор", Kind: "work", UnitCode: "шт", DetailCostCategoryID: "eeeeeeee-0000-0000-0000-000000000002", Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	foundEquipmentWork := false
	for _, c := range workCandidates {
		if c.ItemID == sourceWork {
			foundEquipmentWork = true
		}
		if c.ItemID == furnitureWork {
			t.Fatal("unit-only furniture work was accepted for a compactor")
		}
	}
	if !foundEquipmentWork {
		t.Fatal("compatible general equipment-installation work not found")
	}

	draft, err := svc.CreateDraft(ctx, p, targetTender)
	if err != nil {
		t.Fatal(err)
	}
	q := 2.0
	if _, err = svc.AddArchivePrice(ctx, p, AddArchivePriceInput{DraftID: draft.ID, SourceItemID: sourceMaterial, TargetPositionID: targetPosition, Quantity: &q}); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.AddArchivePrice(ctx, p, AddArchivePriceInput{DraftID: draft.ID, SourceItemID: sourceWork, TargetPositionID: targetPosition}); err != nil {
		t.Fatal(err)
	}
	validation, err := svc.ValidateDraft(ctx, p, draft.ID)
	if err != nil {
		t.Fatal(err)
	}
	if validation.Status != "ready" || len(validation.BlockingErrors) > 0 {
		t.Fatalf("validation: %+v", validation)
	}
	if validation.AfterDirectTotal != 4142000 {
		t.Fatalf("after total=%v", validation.AfterDirectTotal)
	}
	applyStarted := time.Now()
	result, err := svc.ApplyDraft(ctx, p, draft.ID, validation.ValidationHash)
	if err != nil {
		t.Fatal(err)
	}
	if result.CreatedItems != 2 || result.UpdatedItems != 0 {
		t.Fatalf("apply result: %+v", result)
	}
	if elapsed := time.Since(applyStarted); elapsed > 30*time.Second {
		t.Fatalf("draft apply took %s", elapsed)
	} else {
		t.Logf("draft_apply=%s", elapsed)
	}
	var revision int64
	if err := pool.QueryRow(ctx, `SELECT financial_input_revision FROM public.tenders WHERE id=$1`, targetTender).Scan(&revision); err != nil {
		t.Fatal(err)
	}
	if revision != 1 {
		t.Fatalf("financial_input_revision=%d, want 1", revision)
	}
	again, err := svc.ApplyDraft(ctx, p, draft.ID, validation.ValidationHash)
	if err != nil {
		t.Fatal(err)
	}
	if again.CreatedItems != 2 {
		t.Fatalf("idempotent result: %+v", again)
	}
	var itemCount, sourceCount, auditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.boq_items WHERE client_position_id=$1`, targetPosition).Scan(&itemCount); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.boq_item_pricing_sources s JOIN public.boq_items b ON b.id=s.boq_item_id WHERE b.client_position_id=$1`, targetPosition).Scan(&sourceCount); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.boq_items_audit a JOIN public.boq_items b ON b.id=a.boq_item_id WHERE b.client_position_id=$1 AND a.operation_type='INSERT'`, targetPosition).Scan(&auditCount); err != nil {
		t.Fatal(err)
	}
	if itemCount != 2 || sourceCount != 2 || auditCount != 2 {
		t.Fatalf("counts items=%d sources=%d audit=%d", itemCount, sourceCount, auditCount)
	}
	qa, err := svc.QAReport(ctx, p, targetTender)
	if err != nil {
		t.Fatal(err)
	}
	if !qa.ReadyForReview || qa.DirectTotal != 4142000 {
		t.Fatalf("qa: %+v", qa)
	}

	if _, err := pool.Exec(ctx, `INSERT INTO public.tenders(id,title,client_name,tender_number,version,is_archived,created_at,updated_at) VALUES ($1,'MCP FX Missing','Eval','EVAL-FX-MISSING',1,false,now(),now())`, fxTender); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO public.client_positions(id,tender_id,position_number,unit_code,volume,work_name,hierarchy_level) VALUES ($1,$2,1,'шт',5,'Автоматизированное рабочее место охраны',0)`, fxPosition, fxTender); err != nil {
		t.Fatal(err)
	}
	fxDraft, err := svc.CreateDraft(ctx, p, fxTender)
	if err != nil {
		t.Fatal(err)
	}
	fxQty := 5.0
	if _, err = svc.AddArchivePrice(ctx, p, AddArchivePriceInput{DraftID: fxDraft.ID, SourceItemID: "eeeeeeee-5000-0000-0000-000000000005", TargetPositionID: fxPosition, Quantity: &fxQty}); err != nil {
		t.Fatal(err)
	}
	fxValidation, err := svc.ValidateDraft(ctx, p, fxDraft.ID)
	if err != nil {
		t.Fatal(err)
	}
	if fxValidation.Status == "ready" || len(fxValidation.BlockingErrors) == 0 {
		t.Fatalf("missing USD rate was not blocked: %+v", fxValidation)
	}

	if _, err := pool.Exec(ctx, `INSERT INTO public.client_positions(id,tender_id,position_number,unit_code,volume,manual_volume,work_name,hierarchy_level) VALUES ($1,$2,2,'шт',10,10,'Колесоотбойник',0)`, templatePosition, targetTender); err != nil {
		t.Fatal(err)
	}
	templateDraft, err := svc.CreateDraft(ctx, p, targetTender)
	if err != nil {
		t.Fatal(err)
	}
	templateOps, err := svc.AddTemplate(ctx, p, AddTemplateInput{DraftID: templateDraft.ID, TemplateID: "eeeeeeee-7000-0000-0000-000000000001", TargetPositionID: templatePosition})
	if err != nil {
		t.Fatal(err)
	}
	if len(templateOps) != 2 || templateOps[1].ParentOperationID == nil {
		t.Fatalf("template operations: %+v", templateOps)
	}
	templateValidation, err := svc.ValidateDraft(ctx, p, templateDraft.ID)
	if err != nil || templateValidation.Status != "ready" {
		t.Fatalf("template validation: %+v err=%v", templateValidation, err)
	}
	templateResult, err := svc.ApplyDraft(ctx, p, templateDraft.ID, templateValidation.ValidationHash)
	if err != nil {
		t.Fatal(err)
	}
	if templateResult.CreatedItems != 2 {
		t.Fatalf("template result: %+v", templateResult)
	}
	var linked int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.boq_items WHERE client_position_id=$1 AND boq_item_type='мат' AND parent_work_item_id IS NOT NULL`, templatePosition).Scan(&linked); err != nil {
		t.Fatal(err)
	}
	if linked != 1 {
		t.Fatalf("linked template materials=%d", linked)
	}
	if err := pool.QueryRow(ctx, `SELECT financial_input_revision FROM public.tenders WHERE id=$1`, targetTender).Scan(&revision); err != nil {
		t.Fatal(err)
	}
	if revision != 2 {
		t.Fatalf("template revision=%d", revision)
	}

	// Build a two-update draft, then stale the second row. The first update must
	// roll back together with every audit/provenance write.
	var materialID, workID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM public.boq_items WHERE client_position_id=$1 AND boq_item_type='мат'`, targetPosition).Scan(&materialID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT id::text FROM public.boq_items WHERE client_position_id=$1 AND boq_item_type='раб'`, targetPosition).Scan(&workID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `UPDATE public.boq_items SET unit_rate=2000000,total_amount=4000000,updated_at=now()-interval '2 seconds' WHERE id=$1`, materialID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `UPDATE public.boq_items SET unit_rate=500,total_amount=1000,updated_at=now()-interval '2 seconds' WHERE id=$1`, workID); err != nil {
		t.Fatal(err)
	}
	staleDraft, err := svc.CreateDraft(ctx, p, targetTender)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.AddArchivePrice(ctx, p, AddArchivePriceInput{DraftID: staleDraft.ID, SourceItemID: sourceMaterial, TargetPositionID: targetPosition, TargetItemID: &materialID}); err != nil {
		t.Fatal(err)
	}
	if _, err = svc.AddArchivePrice(ctx, p, AddArchivePriceInput{DraftID: staleDraft.ID, SourceItemID: sourceWork, TargetPositionID: targetPosition, TargetItemID: &workID}); err != nil {
		t.Fatal(err)
	}
	staleValidation, err := svc.ValidateDraft(ctx, p, staleDraft.ID)
	if err != nil || staleValidation.Status != "ready" {
		t.Fatalf("stale validation: %+v err=%v", staleValidation, err)
	}
	if _, err = pool.Exec(ctx, `UPDATE public.boq_items SET updated_at=now() WHERE id=$1`, workID); err != nil {
		t.Fatal(err)
	}
	_, err = svc.ApplyDraft(ctx, p, staleDraft.ID, staleValidation.ValidationHash)
	if !errors.Is(err, repository.ErrDraftStale) {
		t.Fatalf("want stale, got %v", err)
	}
	var materialRate float64
	if err := pool.QueryRow(ctx, `SELECT unit_rate FROM public.boq_items WHERE id=$1`, materialID).Scan(&materialRate); err != nil {
		t.Fatal(err)
	}
	if materialRate != 2000000 {
		t.Fatalf("first update was not rolled back: %v", materialRate)
	}
	if err := pool.QueryRow(ctx, `SELECT financial_input_revision FROM public.tenders WHERE id=$1`, targetTender).Scan(&revision); err != nil {
		t.Fatal(err)
	}
	if revision != 2 {
		t.Fatalf("stale apply changed financial revision: %d", revision)
	}
	loaded, err := svc.GetDraft(ctx, p, staleDraft.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Status != "stale" {
		t.Fatalf("draft status=%s", loaded.Status)
	}
}

func seedPricingActor(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	scopes := []string{mcpauth.ScopeTendersRead, mcpauth.ScopeArchiveRead, mcpauth.ScopeLibraryRead, mcpauth.ScopePricingDraft, mcpauth.ScopePricingApply}
	statements := []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO public.roles(code,name,allowed_pages) VALUES ('engineer','Инженер','["/positions","/library","/library/templates"]') ON CONFLICT (code) DO NOTHING`, nil},
		{`INSERT INTO auth.users(id,email) VALUES ($1,'mcp-eval@example.com') ON CONFLICT (id) DO NOTHING`, []any{evalUser}},
		{`INSERT INTO public.users(id,full_name,email,access_status,access_enabled,role_code,allowed_pages) VALUES ($1,'MCP Eval','mcp-eval@example.com','approved',true,'engineer','["/positions","/library","/library/templates"]') ON CONFLICT (id) DO UPDATE SET access_status='approved',access_enabled=true`, []any{evalUser}},
		{`INSERT INTO app_auth.oauth_clients(client_id,client_name,redirect_uris,allowed_scopes) VALUES ($1,'MCP Evaluation','["http://127.0.0.1/callback"]',$2) ON CONFLICT (client_id) DO NOTHING`, []any{evalClient, scopes}},
		{`INSERT INTO app_auth.oauth_grants(user_id,client_id,scopes) VALUES ($1,$2,$3) ON CONFLICT (user_id,client_id) DO UPDATE SET revoked_at=NULL,scopes=EXCLUDED.scopes`, []any{evalUser, evalClient, scopes}},
		{`DELETE FROM public.boq_items WHERE client_position_id IN ($1,$2)`, []any{targetPosition, templatePosition}},
		{`DELETE FROM public.boq_items_audit WHERE changed_by=$1`, []any{evalUser}},
		{`DELETE FROM public.pricing_drafts WHERE tender_id=$1`, []any{targetTender}},
		{`DELETE FROM public.pricing_drafts WHERE tender_id=$1`, []any{fxTender}},
		{`DELETE FROM public.client_positions WHERE id=$1`, []any{templatePosition}},
		{`DELETE FROM public.client_positions WHERE id=$1`, []any{fxPosition}},
		{`DELETE FROM public.tenders WHERE id=$1`, []any{fxTender}},
		{`UPDATE public.tenders SET financial_input_revision=0,financial_calculation_revision=0,updated_at='2026-09-01' WHERE id=$1`, []any{targetTender}},
	}
	for _, st := range statements {
		if _, err := pool.Exec(ctx, st.sql, st.args...); err != nil {
			t.Fatal(err)
		}
	}
}

func cleanupPricingActor(ctx context.Context, pool *pgxpool.Pool) {
	statements := []struct {
		sql  string
		args []any
	}{
		{`DELETE FROM public.boq_items WHERE client_position_id IN ($1,$2)`, []any{targetPosition, templatePosition}},
		{`DELETE FROM public.boq_items_audit WHERE changed_by=$1`, []any{evalUser}},
		{`DELETE FROM public.pricing_drafts WHERE tender_id=$1`, []any{targetTender}},
		{`DELETE FROM public.pricing_drafts WHERE tender_id=$1`, []any{fxTender}},
		{`DELETE FROM public.client_positions WHERE id=$1`, []any{templatePosition}},
		{`DELETE FROM public.client_positions WHERE id=$1`, []any{fxPosition}},
		{`DELETE FROM public.tenders WHERE id=$1`, []any{fxTender}},
		{`DELETE FROM app_auth.oauth_grants WHERE user_id=$1`, []any{evalUser}},
		{`DELETE FROM app_auth.oauth_clients WHERE client_id=$1`, []any{evalClient}},
		{`DELETE FROM public.users WHERE id=$1`, []any{evalUser}},
		{`DELETE FROM auth.users WHERE id=$1`, []any{evalUser}},
	}
	for _, st := range statements {
		_, _ = pool.Exec(ctx, st.sql, st.args...)
	}
}
