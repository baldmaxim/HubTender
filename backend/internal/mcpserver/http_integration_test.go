//go:build integration

package mcpserver

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/rs/zerolog"
	"github.com/su10/hubtender/backend/internal/auth"
	"github.com/su10/hubtender/backend/internal/mcpauth"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/pricing"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
)

const httpEvalUser = "eeeeeeee-9000-0000-0000-000000000003"

type bearerTransport struct {
	token string
	base  http.RoundTripper
}

func (b bearerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	clone.Header = req.Header.Clone()
	clone.Header.Set("Authorization", "Bearer "+b.token)
	return b.base.RoundTrip(clone)
}

func TestAuthenticatedHTTPToolCatalogSearchAndGrantRevoke(t *testing.T) {
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
	key, issuer := mcpHTTPTestIssuer(t)
	oauthRepo := mcpauth.NewRepository(pool)
	userRepo := repository.NewUserRepo(pool)
	libraryRepo := repository.NewLibraryRepo(pool)
	pricingRepo := repository.NewPricingRepo(pool)
	clientID := "mcp-http-evaluation"
	scopes := []string{mcpauth.ScopeTendersRead, mcpauth.ScopeArchiveRead, mcpauth.ScopeLibraryRead, mcpauth.ScopePricingWrite, mcpauth.ScopeNomenclatureCreate, mcpauth.ScopeLibraryCreate}
	seedHTTPActor(t, ctx, pool, clientID, scopes)
	defer cleanupHTTPActor(ctx, pool, clientID)
	const directTender = "eeeeeeee-3000-0000-0000-000000000010"
	const directPosition = "eeeeeeee-4000-0000-0000-000000000010"
	if _, err := pool.Exec(ctx, `INSERT INTO public.tenders
		(id,title,client_name,tender_number,version,is_archived,usd_rate,eur_rate,created_at,updated_at)
		VALUES ($1,'MCP HTTP direct test','Eval','EVAL-HTTP-DIRECT',1,false,90,100,now(),now())
		ON CONFLICT (id) DO NOTHING`, directTender); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO public.client_positions
		(id,tender_id,position_number,unit_code,volume,work_name,hierarchy_level)
		VALUES ($1,$2,1,'шт',2,'Мобильный пресс-компактор',0)
		ON CONFLICT (id) DO NOTHING`, directPosition, directTender); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = pool.Exec(ctx, `DELETE FROM public.mcp_catalog_creation_requests WHERE actor_id=$1`, httpEvalUser)
		_, _ = pool.Exec(ctx, `DELETE FROM public.works_library WHERE work_name_id IN (SELECT id FROM public.work_names WHERE name LIKE 'MCP HTTP CATALOG %')`)
		_, _ = pool.Exec(ctx, `DELETE FROM public.work_names WHERE name LIKE 'MCP HTTP CATALOG %'`)
		_, _ = pool.Exec(ctx, `DELETE FROM public.mcp_direct_pricing_requests WHERE actor_id=$1`, httpEvalUser)
		_, _ = pool.Exec(ctx, `DELETE FROM public.boq_items WHERE tender_id=$1`, directTender)
		_, _ = pool.Exec(ctx, `DELETE FROM public.boq_items_audit WHERE changed_by=$1`, httpEvalUser)
		_, _ = pool.Exec(ctx, `DELETE FROM public.client_position_gp_audit WHERE tender_id=$1`, directTender)
		_, _ = pool.Exec(ctx, `DELETE FROM public.client_positions WHERE id=$1`, directPosition)
		_, _ = pool.Exec(ctx, `DELETE FROM public.tenders WHERE id=$1`, directTender)
	}()
	token, err := issuer.IssueDelegatedAccessToken(httpEvalUser, "mcp-http@example.com", "engineer", joinScopes(scopes), clientID)
	if err != nil {
		t.Fatal(err)
	}
	pricingSvc := services.NewPricingService(pricingRepo, userRepo, libraryRepo, oauthRepo, services.PricingFeatures{WriteEnabled: true, CatalogWriteEnabled: true})
	oauthSvc := mcpauth.NewService(oauthRepo, userRepo, mcpauth.ServiceConfig{Issuer: issuer, CodeTTL: 5 * time.Minute, DCR: true})
	oauthHandler := mcpauth.NewHandler(oauthSvc, mcpauth.HandlerConfig{PublicBaseURL: "https://issuer.test", DCR: true})
	mcpHandler := NewHTTPHandler(pricingSvc, Config{MaxRequestBodyBytes: 1 << 20, Logger: zerolog.Nop()})
	verify := middleware.VerifyConfig{AppPublicKey: &key.Private.PublicKey, AppIssuer: "https://issuer.test", AppAudience: "hubtender-mcp"}
	server := httptest.NewServer(middleware.JWTAuthWithChallenge(verify, "https://issuer.test/.well-known/oauth-protected-resource")(oauthHandler.RequireActiveGrant(mcpHandler)))
	defer server.Close()
	httpClient := &http.Client{Transport: bearerTransport{token: token.Token, base: http.DefaultTransport}}
	confirmations := 0
	confirmationMessages := []string{}
	client := mcp.NewClient(&mcp.Implementation{Name: "integration-client", Version: "1.0.0"}, &mcp.ClientOptions{
		ElicitationHandler: func(_ context.Context, request *mcp.ElicitRequest) (*mcp.ElicitResult, error) {
			confirmations++
			confirmationMessages = append(confirmationMessages, request.Params.Message)
			return &mcp.ElicitResult{Action: "accept", Content: map[string]any{"confirm": true}}, nil
		},
	})
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL, HTTPClient: httpClient, DisableStandaloneSSE: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	listed, err := session.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Tools) != 23 {
		t.Fatalf("tool count=%d", len(listed.Tools))
	}
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "tenderhub_search_archive_prices", Arguments: map[string]any{"query": "Мобильный пресс-компактор", "kind": "material", "unit_code": "шт", "limit": 5}})
	if err != nil {
		t.Fatal(err)
	}
	if result.IsError {
		t.Fatalf("tool error: %+v", result.Content)
	}
	selected, err := pricingRepo.GetArchiveItem(ctx, "eeeeeeee-5000-0000-0000-000000000001")
	if err != nil {
		t.Fatal(err)
	}
	directArgs := map[string]any{
		"tender_id": directTender, "target_position_id": directPosition,
		"source_kind": "archive", "source_id": "eeeeeeee-5000-0000-0000-000000000001",
		"expected_source_rate": 2070000, "quantity": 2, "position_quantity": 2,
		"expected_source_version": selected.SourceVersion,
		"detail_cost_category_id": "eeeeeeee-0000-0000-0000-000000000002",
		"expected_revision":       0, "request_key": "http-direct-price-create-001",
	}
	for attempt := 0; attempt < 2; attempt++ {
		written, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "tenderhub_price_boq_item", Arguments: directArgs})
		if err != nil || written.IsError {
			t.Fatalf("direct write attempt %d: result=%+v err=%v", attempt, written, err)
		}
	}
	// An identical retry replays the committed receipt without a new window.
	if confirmations != 1 {
		t.Fatalf("confirmations=%d, want 1", confirmations)
	}
	if first := confirmationMessages[0]; !strings.Contains(first, "Тендер: №EVAL-HTTP-DIRECT «MCP HTTP direct test», версия 1") ||
		!strings.Contains(first, "Позиция: №1 «Мобильный пресс-компактор»") || !strings.Contains(first, "Количество ГП: — → 2") {
		t.Fatalf("window does not show where the write goes:\n%s", first)
	}
	var count, revision, receipts int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.boq_items WHERE tender_id=$1`, directTender).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT financial_input_revision FROM public.tenders WHERE id=$1`, directTender).Scan(&revision); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.mcp_direct_pricing_requests WHERE actor_id=$1`, httpEvalUser).Scan(&receipts); err != nil {
		t.Fatal(err)
	}
	if count != 1 || revision != 1 || receipts != 1 {
		t.Fatalf("direct HTTP write/retry: items=%d revision=%d receipts=%d", count, revision, receipts)
	}
	receipt, err := session.CallTool(ctx, &mcp.CallToolParams{
		Name:      "tenderhub_get_direct_pricing_receipt",
		Arguments: map[string]any{"request_key": "http-direct-price-create-001"},
	})
	if err != nil || receipt.IsError {
		t.Fatalf("read committed receipt: result=%+v err=%v", receipt, err)
	}
	callCatalog := func(name string, args map[string]any) pricing.CatalogCreationResult {
		t.Helper()
		r, e := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
		if e != nil || r.IsError {
			t.Fatalf("catalog HTTP tool %s: result=%+v err=%v", name, r, e)
		}
		raw, e := json.Marshal(r.StructuredContent)
		if e != nil {
			t.Fatal(e)
		}
		var created pricing.CatalogCreationResult
		if e := json.Unmarshal(raw, &created); e != nil {
			t.Fatal(e)
		}
		return created
	}
	unit := callCatalog("tenderhub_create_unit", map[string]any{"code": "шт", "name": "Штука", "request_key": "http-catalog-unit-001"})
	if unit.Created || unit.EntityID != "шт" {
		t.Fatalf("existing unit was not reused: %+v", unit)
	}
	name := callCatalog("tenderhub_create_nomenclature_item", map[string]any{"kind": "work", "name": "MCP HTTP CATALOG work", "unit_code": "шт", "request_key": "http-catalog-name-001"})
	if name.NomenclatureItem == nil {
		t.Fatal("typed nomenclature result missing")
	}
	cardArgs := map[string]any{"kind": "work", "name_id": name.EntityID, "expected_name_version": name.NomenclatureItem.Version, "unit_rate": 12345.67, "currency": "RUB", "price_source": "Цена указана пользователем в HTTP тесте", "request_key": "http-catalog-card-001"}
	card := callCatalog("tenderhub_create_library_item", cardArgs)
	if card.LibraryItem == nil || card.LibraryItem.SourceVersion == "" {
		t.Fatal("typed library result missing version")
	}
	if !strings.Contains(confirmationMessages[len(confirmationMessages)-1], "12345.67 RUB") {
		t.Error("confirmation rounded the user-supplied price")
	}
	if _, err := pool.Exec(ctx, `UPDATE public.work_names SET name='MCP HTTP CATALOG renamed' WHERE id=$1`, name.EntityID); err != nil {
		t.Fatal(err)
	}
	replayedCard := callCatalog("tenderhub_create_library_item", cardArgs)
	if !replayedCard.Replayed || replayedCard.EntityID != card.EntityID {
		t.Fatal("HTTP catalog retry created a duplicate")
	}
	_, e := session.CallTool(ctx, &mcp.CallToolParams{Name: "tenderhub_get_catalog_creation_receipt", Arguments: map[string]any{"request_key": "http-catalog-card-001"}})
	if e != nil {
		t.Fatal(e)
	}
	// A client without a confirmation window cannot write: the agent has no
	// way to confirm on the human's behalf.
	noWindowClient := mcp.NewClient(&mcp.Implementation{Name: "no-window", Version: "1"}, nil)
	noWindow, err := noWindowClient.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL, HTTPClient: httpClient, DisableStandaloneSSE: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer noWindow.Close()
	var itemID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM public.boq_items WHERE client_position_id=$1`, directPosition).Scan(&itemID); err != nil {
		t.Fatal(err)
	}
	_, etag, err := pricingRepo.GetCurrentBoqItem(ctx, itemID)
	if err != nil {
		t.Fatal(err)
	}
	warningArgs := map[string]any{"tender_id": directTender, "target_position_id": directPosition, "target_item_id": itemID, "source_kind": "current", "quantity": 3000, "expected_etag": etag, "expected_revision": 1, "request_key": "http-confirm-warning-001"}
	blocked, err := noWindow.CallTool(ctx, &mcp.CallToolParams{Name: "tenderhub_price_boq_item", Arguments: warningArgs})
	if err != nil || !blocked.IsError || !strings.Contains(resultText(blocked), "MCP_CONFIRMATION_UNSUPPORTED") {
		t.Fatalf("client without a window wrote: %+v %v", blocked, err)
	}
	if err := pool.QueryRow(ctx, `SELECT financial_input_revision FROM public.tenders WHERE id=$1`, directTender).Scan(&revision); err != nil || revision != 1 {
		t.Fatalf("rejected write changed revision %d: %v", revision, err)
	}
	// The human sees the S warning and before → after in the window, then approves.
	shown := len(confirmationMessages)
	accepted, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "tenderhub_price_boq_item", Arguments: warningArgs})
	if err != nil || accepted.IsError {
		t.Fatalf("warning approval: %+v %v", accepted, err)
	}
	if len(confirmationMessages) != shown+1 {
		t.Fatal("warning write was not shown to the human")
	}
	if msg := confirmationMessages[shown]; !strings.Contains(msg, "Проверка S [warning]") || !strings.Contains(msg, "станет: количество 3000") || !strings.Contains(msg, "было:   количество 2") {
		t.Fatalf("warning not presented:\n%s", msg)
	}
	if err := pool.QueryRow(ctx, `SELECT financial_input_revision FROM public.tenders WHERE id=$1`, directTender).Scan(&revision); err != nil || revision != 2 {
		t.Fatalf("approved write revision %d: %v", revision, err)
	}

	// Another user's token cannot continue this MCP session.
	otherToken := seedHTTPOtherUser(t, ctx, pool, issuer, clientID, scopes)
	hijack, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL, strings.NewReader(`{"jsonrpc":"2.0","id":99,"method":"tools/list"}`))
	if err != nil {
		t.Fatal(err)
	}
	hijack.Header.Set("Authorization", "Bearer "+otherToken)
	hijack.Header.Set("Mcp-Session-Id", session.ID())
	hijack.Header.Set("Content-Type", "application/json")
	hijack.Header.Set("Accept", "application/json, text/event-stream")
	resp, err := http.DefaultClient.Do(hijack)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign session reuse: status %d, want 403", resp.StatusCode)
	}

	if err := oauthRepo.RevokeGrant(ctx, httpEvalUser, clientID); err != nil {
		t.Fatal(err)
	}
	if _, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "tenderhub_whoami", Arguments: map[string]any{}}); err == nil {
		t.Fatal("revoked grant still called MCP")
	}
}

func resultText(r *mcp.CallToolResult) string {
	text := ""
	for _, content := range r.Content {
		if tc, ok := content.(*mcp.TextContent); ok {
			text += tc.Text
		}
	}
	return text
}

const httpOtherUser = "eeeeeeee-9000-0000-0000-000000000004"

// seedHTTPOtherUser is a second engineer with an active grant of the same client.
func seedHTTPOtherUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, issuer *auth.Issuer, clientID string, scopes []string) string {
	t.Helper()
	for _, st := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO auth.users(id,email) VALUES ($1,'mcp-http-other@example.com') ON CONFLICT (id) DO NOTHING`, []any{httpOtherUser}},
		{`INSERT INTO public.users(id,full_name,email,access_status,access_enabled,role_code,allowed_pages) VALUES ($1,'MCP HTTP other','mcp-http-other@example.com','approved',true,'engineer','["/positions","/library"]') ON CONFLICT (id) DO NOTHING`, []any{httpOtherUser}},
		{`INSERT INTO app_auth.oauth_grants(user_id,client_id,scopes) VALUES ($1,$2,$3) ON CONFLICT (user_id,client_id) DO UPDATE SET revoked_at=NULL`, []any{httpOtherUser, clientID, scopes}},
	} {
		if _, err := pool.Exec(ctx, st.sql, st.args...); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM app_auth.oauth_grants WHERE user_id=$1`, httpOtherUser)
		_, _ = pool.Exec(ctx, `DELETE FROM public.users WHERE id=$1`, httpOtherUser)
		_, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id=$1`, httpOtherUser)
	})
	token, err := issuer.IssueDelegatedAccessToken(httpOtherUser, "mcp-http-other@example.com", "engineer", joinScopes(scopes), clientID)
	if err != nil {
		t.Fatal(err)
	}
	return token.Token
}

func seedHTTPActor(t *testing.T, ctx context.Context, pool *pgxpool.Pool, clientID string, scopes []string) {
	t.Helper()
	statements := []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO public.roles(code,name,allowed_pages) VALUES ('engineer','Инженер','["/positions","/library","/library/templates"]') ON CONFLICT (code) DO NOTHING`, nil},
		{`INSERT INTO auth.users(id,email) VALUES ($1,'mcp-http@example.com') ON CONFLICT (id) DO NOTHING`, []any{httpEvalUser}},
		{`INSERT INTO public.users(id,full_name,email,access_status,access_enabled,role_code,allowed_pages) VALUES ($1,'MCP HTTP','mcp-http@example.com','approved',true,'engineer','["/positions","/library","/library/templates"]') ON CONFLICT (id) DO UPDATE SET access_status='approved',access_enabled=true`, []any{httpEvalUser}},
		{`INSERT INTO app_auth.oauth_clients(client_id,client_name,redirect_uris,allowed_scopes) VALUES ($1,'MCP HTTP Evaluation','["http://127.0.0.1/callback"]',$2) ON CONFLICT (client_id) DO NOTHING`, []any{clientID, scopes}},
		{`INSERT INTO app_auth.oauth_grants(user_id,client_id,scopes) VALUES ($1,$2,$3) ON CONFLICT (user_id,client_id) DO UPDATE SET revoked_at=NULL,scopes=EXCLUDED.scopes`, []any{httpEvalUser, clientID, scopes}},
	}
	for _, st := range statements {
		if _, err := pool.Exec(ctx, st.sql, st.args...); err != nil {
			t.Fatal(err)
		}
	}
}
func cleanupHTTPActor(ctx context.Context, pool *pgxpool.Pool, clientID string) {
	for _, st := range []struct {
		sql  string
		args []any
	}{{`DELETE FROM app_auth.oauth_grants WHERE user_id=$1`, []any{httpEvalUser}}, {`DELETE FROM app_auth.oauth_clients WHERE client_id=$1`, []any{clientID}}, {`DELETE FROM public.users WHERE id=$1`, []any{httpEvalUser}}, {`DELETE FROM auth.users WHERE id=$1`, []any{httpEvalUser}}} {
		_, _ = pool.Exec(ctx, st.sql, st.args...)
	}
}
func mcpHTTPTestIssuer(t *testing.T) (*auth.SigningKey, *auth.Issuer) {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	key, err := auth.LoadSigningKey(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
	if err != nil {
		t.Fatal(err)
	}
	issuer, err := auth.NewIssuer(auth.IssuerConfig{SigningKey: key, Issuer: "https://issuer.test", Audience: "hubtender-mcp", AccessTTL: 10 * time.Minute, RefreshTTL: 24 * time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	return key, issuer
}
func joinScopes(scopes []string) string {
	out := ""
	for i, s := range scopes {
		if i > 0 {
			out += " "
		}
		out += s
	}
	return out
}

// legacyMCP speaks protocol 2025-11-25 over raw Streamable HTTP, as clients
// without multi round-trip do (Cursor at the time of writing): the server
// opens the confirmation window with elicitation/create inside the tool call.
type legacyMCP struct {
	t       *testing.T
	url     string
	token   string
	session string
}

func (c *legacyMCP) post(body string) *http.Response {
	c.t.Helper()
	req, err := http.NewRequest(http.MethodPost, c.url, strings.NewReader(body))
	if err != nil {
		c.t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("Mcp-Protocol-Version", "2025-11-25")
	if c.session != "" {
		req.Header.Set("Mcp-Session-Id", c.session)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	return resp
}

// nextMessage returns the next JSON-RPC message of an SSE response.
func nextMessage(t *testing.T, sc *bufio.Scanner) map[string]any {
	t.Helper()
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var msg map[string]any
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &msg); err != nil {
			t.Fatal(err)
		}
		return msg
	}
	t.Fatalf("SSE stream ended: %v", sc.Err())
	return nil
}

func TestLegacyClientConfirmsThroughServerElicitation(t *testing.T) {
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
	key, issuer := mcpHTTPTestIssuer(t)
	oauthRepo := mcpauth.NewRepository(pool)
	userRepo := repository.NewUserRepo(pool)
	pricingRepo := repository.NewPricingRepo(pool)
	clientID := "mcp-http-legacy"
	scopes := []string{mcpauth.ScopeTendersRead, mcpauth.ScopeArchiveRead, mcpauth.ScopeLibraryRead, mcpauth.ScopePricingWrite}
	seedHTTPActor(t, ctx, pool, clientID, scopes)
	defer cleanupHTTPActor(ctx, pool, clientID)
	const tenderID = "eeeeeeee-3000-0000-0000-000000000011"
	const positionID = "eeeeeeee-4000-0000-0000-000000000011"
	for _, q := range []string{
		`INSERT INTO public.tenders(id,title,client_name,tender_number,version,is_archived,usd_rate,eur_rate) VALUES ('` + tenderID + `','MCP legacy client','Eval','EVAL-LEGACY',1,false,90,100) ON CONFLICT (id) DO NOTHING`,
		`INSERT INTO public.client_positions(id,tender_id,position_number,unit_code,volume,work_name,hierarchy_level) VALUES ('` + positionID + `','` + tenderID + `',1,'шт',2,'Мобильный пресс-компактор',0) ON CONFLICT (id) DO NOTHING`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		_, _ = pool.Exec(ctx, `DELETE FROM public.mcp_direct_pricing_requests WHERE tender_id=$1`, tenderID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.boq_items WHERE tender_id=$1`, tenderID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.boq_items_audit WHERE changed_by=$1`, httpEvalUser)
		_, _ = pool.Exec(ctx, `DELETE FROM public.client_position_gp_audit WHERE tender_id=$1`, tenderID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.client_positions WHERE id=$1`, positionID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.tenders WHERE id=$1`, tenderID)
	}()
	token, err := issuer.IssueDelegatedAccessToken(httpEvalUser, "mcp-http@example.com", "engineer", joinScopes(scopes), clientID)
	if err != nil {
		t.Fatal(err)
	}
	pricingSvc := services.NewPricingService(pricingRepo, userRepo, repository.NewLibraryRepo(pool), oauthRepo, services.PricingFeatures{WriteEnabled: true})
	oauthSvc := mcpauth.NewService(oauthRepo, userRepo, mcpauth.ServiceConfig{Issuer: issuer, CodeTTL: 5 * time.Minute})
	oauthHandler := mcpauth.NewHandler(oauthSvc, mcpauth.HandlerConfig{PublicBaseURL: "https://issuer.test"})
	verify := middleware.VerifyConfig{AppPublicKey: &key.Private.PublicKey, AppIssuer: "https://issuer.test", AppAudience: "hubtender-mcp"}
	server := httptest.NewServer(middleware.JWTAuthWithChallenge(verify, "https://issuer.test/.well-known/oauth-protected-resource")(
		oauthHandler.RequireActiveGrant(NewHTTPHandler(pricingSvc, Config{MaxRequestBodyBytes: 1 << 20, Logger: zerolog.Nop()}))))
	defer server.Close()

	c := &legacyMCP{t: t, url: server.URL, token: token.Token}
	init := c.post(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{"elicitation":{"form":{}}},"clientInfo":{"name":"legacy-cursor-like","version":"1"}}}`)
	c.session = init.Header.Get("Mcp-Session-Id")
	_ = init.Body.Close()
	if init.StatusCode != http.StatusOK || c.session == "" {
		t.Fatalf("initialize: status %d session %q", init.StatusCode, c.session)
	}
	_ = c.post(`{"jsonrpc":"2.0","method":"notifications/initialized"}`).Body.Close()

	selected, err := pricingRepo.GetArchiveItem(ctx, "eeeeeeee-5000-0000-0000-000000000001")
	if err != nil {
		t.Fatal(err)
	}
	args, _ := json.Marshal(map[string]any{
		"tender_id": tenderID, "target_position_id": positionID,
		"source_kind": "archive", "source_id": "eeeeeeee-5000-0000-0000-000000000001",
		"expected_source_rate": 2070000, "quantity": 2, "position_quantity": 2,
		"expected_source_version": selected.SourceVersion,
		"detail_cost_category_id": "eeeeeeee-0000-0000-0000-000000000002",
		"expected_revision":       0, "request_key": "legacy-direct-price-0001",
	})
	call := c.post(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tenderhub_price_boq_item","arguments":` + string(args) + `}}`)
	defer call.Body.Close()
	if ct := call.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("tool call must stream to carry the window request, got %q", ct)
	}
	stream := bufio.NewScanner(call.Body)
	stream.Buffer(make([]byte, 1<<20), 1<<20)
	elicit := nextMessage(t, stream)
	params, _ := elicit["params"].(map[string]any)
	if elicit["method"] != "elicitation/create" || params == nil || !strings.Contains(params["message"].(string), "Позиция: №1 «Мобильный пресс-компактор»") {
		t.Fatalf("expected a confirmation window, got %+v", elicit)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.boq_items WHERE tender_id=$1`, tenderID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("written before the human answered: %d %v", count, err)
	}
	id, _ := json.Marshal(elicit["id"])
	answer := c.post(`{"jsonrpc":"2.0","id":` + string(id) + `,"result":{"action":"accept","content":{"confirm":true}}}`)
	_ = answer.Body.Close()
	result := nextMessage(t, stream)
	res, _ := result["result"].(map[string]any)
	if result["id"] != float64(2) || res == nil || res["isError"] == true {
		t.Fatalf("tool result after confirmation: %+v", result)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.boq_items WHERE tender_id=$1`, tenderID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("confirmed write: rows=%d %v", count, err)
	}
}
