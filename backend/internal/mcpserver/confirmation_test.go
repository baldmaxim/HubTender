package mcpserver

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestConfirmationRejectsClientWithoutWindow(t *testing.T) {
	if _, err := requireConfirmation(nil, "Approve?", "state-1"); !errors.Is(err, errConfirmationUnsupported) {
		t.Fatalf("a client without a confirmation window must not write: %v", err)
	}
}

func TestConfirmationAnswerBoundToState(t *testing.T) {
	answer := func(action string, confirm any, state string) *mcp.CallToolRequest {
		return &mcp.CallToolRequest{Params: &mcp.CallToolParamsRaw{
			InputResponses: mcp.InputResponseMap{"confirm": &mcp.ElicitResult{Action: action, Content: map[string]any{"confirm": confirm}}},
			RequestState:   state,
		}}
	}
	if pending, err := requireConfirmation(answer("accept", true, "state-1"), "Approve?", "state-1"); pending != nil || err != nil {
		t.Fatalf("accepted window: %+v %v", pending, err)
	}
	if _, err := requireConfirmation(answer("accept", true, "state-0"), "Approve?", "state-1"); !errors.Is(err, errConfirmationStale) {
		t.Fatalf("answer for an older preview accepted: %v", err)
	}
	if _, err := requireConfirmation(answer("decline", true, "state-1"), "Approve?", "state-1"); !errors.Is(err, errWriteNotConfirmed) {
		t.Fatalf("declined window accepted: %v", err)
	}
	if _, err := requireConfirmation(answer("accept", false, "state-1"), "Approve?", "state-1"); !errors.Is(err, errWriteNotConfirmed) {
		t.Fatalf("unchecked confirmation accepted: %v", err)
	}
}

// A real SDK round trip: the client shows the window (elicitation handler) and
// only the human's answer lets the tool continue.
func TestConfirmationWindowRoundTrip(t *testing.T) {
	run := func(t *testing.T, handler func(context.Context, *mcp.ElicitRequest) (*mcp.ElicitResult, error)) (string, error) {
		t.Helper()
		server := mcp.NewServer(&mcp.Implementation{Name: "test", Version: "1"}, nil)
		mcp.AddTool(server, destructiveTool("confirm_probe", "Probe", "Ask the human and report the outcome."),
			func(_ context.Context, req *mcp.CallToolRequest, _ emptyInput) (*mcp.CallToolResult, statusOutput, error) {
				if pending, err := requireConfirmation(req, "Записать?", "probe-state"); pending != nil || err != nil {
					return pending, statusOutput{}, err
				}
				return md("written"), statusOutput{OK: true, Message: "written"}, nil
			})
		ct, st := mcp.NewInMemoryTransports()
		if _, err := server.Connect(context.Background(), st, nil); err != nil {
			t.Fatal(err)
		}
		opts := &mcp.ClientOptions{}
		if handler != nil {
			opts.ElicitationHandler = handler
		}
		session, err := mcp.NewClient(&mcp.Implementation{Name: "client", Version: "1"}, opts).Connect(context.Background(), ct, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer session.Close()
		result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "confirm_probe", Arguments: map[string]any{}})
		if err != nil {
			return "", err
		}
		text := result.Content[0].(*mcp.TextContent).Text
		if result.IsError {
			return "", errors.New(text)
		}
		return text, nil
	}
	shown := ""
	accept := func(_ context.Context, req *mcp.ElicitRequest) (*mcp.ElicitResult, error) {
		shown = req.Params.Message
		return &mcp.ElicitResult{Action: "accept", Content: map[string]any{"confirm": true}}, nil
	}
	if text, err := run(t, accept); err != nil || text != "written" || shown != "Записать?" {
		t.Fatalf("accepted window: text=%q shown=%q err=%v", text, shown, err)
	}
	decline := func(context.Context, *mcp.ElicitRequest) (*mcp.ElicitResult, error) {
		return &mcp.ElicitResult{Action: "decline"}, nil
	}
	if _, err := run(t, decline); err == nil || !strings.Contains(err.Error(), "MCP_WRITE_NOT_CONFIRMED") {
		t.Fatalf("declined window wrote: %v", err)
	}
	if _, err := run(t, nil); err == nil || !strings.Contains(err.Error(), "MCP_CONFIRMATION_UNSUPPORTED") {
		t.Fatalf("client without window wrote: %v", err)
	}
}
