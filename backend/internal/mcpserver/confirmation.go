package mcpserver

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Every MCP write is confirmed by a human in the client's confirmation window
// (form elicitation); the agent cannot confirm on its own, and a client that
// cannot show the window cannot write (docs/mcp/AUTHORSHIP.md).
//
// A tool returns an InputRequests result (multi round-trip, SEP-2322). A client
// on protocol >= 2026-07-28 shows the window itself and re-sends the call with
// the answer. For older clients go-sdk's server middleware sends
// elicitation/create over the session and re-invokes the tool with the answer;
// that needs the stateful Streamable HTTP transport (NewHTTPHandler).

var (
	errConfirmationUnsupported = errors.New("MCP_CONFIRMATION_UNSUPPORTED: этот MCP-клиент не показывает окно подтверждения (elicitation). Запись через MCP подтверждает только человек в окне клиента: используйте клиент с окном подтверждения или внесите изменение в портале")
	errWriteNotConfirmed       = errors.New("MCP_WRITE_NOT_CONFIRMED: запись отклонена в окне подтверждения")
	errConfirmationStale       = errors.New("MCP_CONFIRMATION_STALE: данные изменились после показа окна подтверждения; повторите запрос, чтобы увидеть актуальный предпросмотр")
)

// confirmationState binds the human's answer to the exact proposal shown.
func confirmationState(v any) string {
	raw, _ := json.Marshal(v)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func supportsFormElicitation(req *mcp.CallToolRequest) bool {
	if req == nil {
		return false
	}
	caps := req.ClientCapabilities()
	if caps == nil || caps.Elicitation == nil {
		return false
	}
	// Match go-sdk ServerSession.Elicit: Form==nil && URL!=nil means form is
	// unsupported; both nil means form is assumed for backward compatibility.
	if caps.Elicitation.Form == nil && caps.Elicitation.URL != nil {
		return false
	}
	return true
}

func confirmSchema() *jsonschema.Schema {
	return &jsonschema.Schema{
		Type: "object",
		Properties: map[string]*jsonschema.Schema{
			"confirm": {Type: "boolean", Title: "Подтверждаю", Description: "Отметьте, если проверили изменение и согласны записать его в TenderHUB."},
		},
		Required: []string{"confirm"},
	}
}

// requireConfirmation returns (nil, nil) once the human accepted exactly the
// proposal identified by state. Otherwise it returns the confirmation window
// request, or an error when the client cannot show it, the human declined, or
// the data changed after the window was shown.
func requireConfirmation(req *mcp.CallToolRequest, message, state string) (*mcp.CallToolResult, error) {
	if req != nil && len(req.Params.InputResponses) > 0 {
		answer, ok := req.Params.InputResponses["confirm"].(*mcp.ElicitResult)
		if !ok || answer.Action != "accept" || answer.Content["confirm"] != true {
			return nil, errWriteNotConfirmed
		}
		if req.Params.RequestState != state {
			return nil, errConfirmationStale
		}
		return nil, nil
	}
	if !supportsFormElicitation(req) {
		return nil, errConfirmationUnsupported
	}
	return &mcp.CallToolResult{
		InputRequests: mcp.InputRequestMap{
			"confirm": &mcp.ElicitParams{
				Mode:            "form",
				Message:         message,
				RequestedSchema: confirmSchema(),
			},
		},
		RequestState: state,
	}, nil
}
