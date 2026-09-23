package mcpserver

import (
	"context"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/su10/hubtender/backend/internal/pricing"
	"github.com/su10/hubtender/backend/internal/services"
)

func TestToolCatalogIsCompleteAndAnnotated(t *testing.T) {
	server := mcp.NewServer(&mcp.Implementation{Name: "test", Version: "1"}, &mcp.ServerOptions{Capabilities: &mcp.ServerCapabilities{}})
	registerTools(server, &services.PricingService{}, pricing.Principal{})
	ct, st := mcp.NewInMemoryTransports()
	if _, err := server.Connect(context.Background(), st, nil); err != nil {
		t.Fatal(err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "1"}, nil)
	session, err := client.Connect(context.Background(), ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	result, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Tools) != 18 {
		t.Fatalf("got %d tools, want 18", len(result.Tools))
	}
	names := map[string]bool{}
	for _, tool := range result.Tools {
		names[tool.Name] = true
		if tool.Description == "" || tool.InputSchema == nil || tool.OutputSchema == nil || tool.Annotations == nil {
			t.Fatalf("tool %s missing schema/description/annotations", tool.Name)
		}
	}
	for _, want := range []string{"tenderhub_search_archive_prices", "tenderhub_validate_pricing_draft", "tenderhub_apply_pricing_draft", "tenderhub_get_pricing_qa_report"} {
		if !names[want] {
			t.Errorf("missing %s", want)
		}
	}
	for _, tool := range result.Tools {
		if tool.Name == "tenderhub_apply_pricing_draft" && (!tool.Annotations.IdempotentHint || tool.Annotations.DestructiveHint == nil || !*tool.Annotations.DestructiveHint) {
			t.Fatal("apply tool annotations are unsafe")
		}
	}
}
