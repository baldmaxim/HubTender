//go:build integration

package mcpserver

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/rs/zerolog"
	"github.com/su10/hubtender/backend/internal/auth"
	"github.com/su10/hubtender/backend/internal/mcpauth"
	"github.com/su10/hubtender/backend/internal/middleware"
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
	scopes := []string{mcpauth.ScopeTendersRead, mcpauth.ScopeArchiveRead, mcpauth.ScopeLibraryRead, mcpauth.ScopePricingDraft, mcpauth.ScopePricingApply}
	seedHTTPActor(t, ctx, pool, clientID, scopes)
	defer cleanupHTTPActor(ctx, pool, clientID)
	token, err := issuer.IssueDelegatedAccessToken(httpEvalUser, "mcp-http@example.com", "engineer", joinScopes(scopes), clientID)
	if err != nil {
		t.Fatal(err)
	}
	pricingSvc := services.NewPricingService(pricingRepo, userRepo, libraryRepo, oauthRepo, services.PricingFeatures{WriteEnabled: true})
	oauthSvc := mcpauth.NewService(oauthRepo, userRepo, mcpauth.ServiceConfig{Issuer: issuer, CodeTTL: 5 * time.Minute, DCR: true})
	oauthHandler := mcpauth.NewHandler(oauthSvc, mcpauth.HandlerConfig{PublicBaseURL: "https://issuer.test", DCR: true})
	mcpHandler := NewHTTPHandler(pricingSvc, Config{MaxRequestBodyBytes: 1 << 20, Logger: zerolog.Nop()})
	verify := middleware.VerifyConfig{AppPublicKey: &key.Private.PublicKey, AppIssuer: "https://issuer.test", AppAudience: "hubtender-mcp"}
	server := httptest.NewServer(middleware.JWTAuthWithChallenge(verify, "https://issuer.test/.well-known/oauth-protected-resource")(oauthHandler.RequireActiveGrant(mcpHandler)))
	defer server.Close()
	httpClient := &http.Client{Transport: bearerTransport{token: token.Token, base: http.DefaultTransport}}
	client := mcp.NewClient(&mcp.Implementation{Name: "integration-client", Version: "1.0.0"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL, HTTPClient: httpClient, DisableStandaloneSSE: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	listed, err := session.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Tools) != 18 {
		t.Fatalf("tool count=%d", len(listed.Tools))
	}
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "tenderhub_search_archive_prices", Arguments: map[string]any{"query": "Мобильный пресс-компактор", "kind": "material", "unit_code": "шт", "limit": 5}})
	if err != nil {
		t.Fatal(err)
	}
	if result.IsError {
		t.Fatalf("tool error: %+v", result.Content)
	}
	if err := oauthRepo.RevokeGrant(ctx, httpEvalUser, clientID); err != nil {
		t.Fatal(err)
	}
	if _, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "tenderhub_whoami", Arguments: map[string]any{}}); err == nil {
		t.Fatal("revoked grant still called MCP")
	}
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
