package mcpserver

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/rs/zerolog"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/pricing"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
)

const serverInstructions = `TenderHUB MCP works only with already-created and imported tenders. Search archive/library/template sources first, create a durable pricing draft, validate it, show the diff and warnings, and call apply only after explicit user confirmation. Never invent a rate. Leave unmatched positions unresolved.`

type Config struct {
	MaxRequestBodyBytes int64
	Logger              zerolog.Logger
}

func NewHTTPHandler(svc *services.PricingService, cfg Config) http.Handler {
	cache := mcp.NewSchemaCache()
	h := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		u := middleware.UserFromContext(r.Context())
		if u == nil {
			return nil
		}
		principal := pricing.Principal{UserID: u.ID, Email: u.Email, RoleCode: u.Role, Scopes: u.Scopes, ClientID: u.ClientID}
		server := mcp.NewServer(&mcp.Implementation{
			Name: "tenderhub-mcp-server", Title: "TenderHUB MCP", Version: "1.0.0",
			Description: "Archive-grounded tender pricing with auditable drafts",
		}, &mcp.ServerOptions{Instructions: serverInstructions, SchemaCache: cache, Capabilities: &mcp.ServerCapabilities{}})
		registerTools(server, svc, principal)
		return server
	}, &mcp.StreamableHTTPOptions{
		Stateless: true, JSONResponse: true, MaxRequestBodyBytes: cfg.MaxRequestBodyBytes,
		PropagateRequestCancellation: true,
	})
	return auditHTTP(h, cfg.Logger)
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (w *statusRecorder) WriteHeader(code int) { w.status = code; w.ResponseWriter.WriteHeader(code) }
func auditHTTP(next http.Handler, logger zerolog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		u := middleware.UserFromContext(r.Context())
		event := logger.Info()
		if rec.status >= 400 {
			event = logger.Warn()
		}
		if u != nil {
			event = event.Str("user_id", u.ID).Str("oauth_client_id", u.ClientID)
		}
		event.Str("mcp_method", r.Header.Get("Mcp-Method")).Str("mcp_name", r.Header.Get("Mcp-Name")).Int("status", rec.status).Dur("duration", time.Since(start)).Msg("mcp request")
	})
}

type emptyInput struct{}
type whoamiOutput struct {
	UserID   string   `json:"user_id"`
	Email    string   `json:"email"`
	RoleCode string   `json:"role_code"`
	Scopes   []string `json:"scopes"`
}
type paginationInput struct {
	Limit  int `json:"limit,omitempty" jsonschema:"Maximum results from 1 to 100"`
	Offset int `json:"offset,omitempty" jsonschema:"Zero-based result offset"`
}
type listTendersInput struct {
	Search     string `json:"search,omitempty"`
	IsArchived *bool  `json:"is_archived,omitempty"`
	Limit      int    `json:"limit,omitempty"`
	Offset     int    `json:"offset,omitempty"`
}
type listTendersOutput struct {
	Tenders    []pricing.TenderSummary `json:"tenders"`
	Pagination pricing.Page            `json:"pagination"`
}
type pricingStateInput struct {
	TenderID string `json:"tender_id" jsonschema:"UUID of an already imported tender"`
	Limit    int    `json:"limit,omitempty"`
	Offset   int    `json:"offset,omitempty"`
}
type archiveSearchToolInput struct {
	Query                string `json:"query" jsonschema:"Russian item or work description to match"`
	Kind                 string `json:"kind,omitempty" jsonschema:"Optional work or material filter"`
	UnitCode             string `json:"unit_code,omitempty"`
	DetailCostCategoryID string `json:"detail_cost_category_id,omitempty"`
	HousingClass         string `json:"housing_class,omitempty"`
	ConstructionScope    string `json:"construction_scope,omitempty"`
	IncludeActive        bool   `json:"include_active,omitempty"`
	Limit                int    `json:"limit,omitempty"`
	Offset               int    `json:"offset,omitempty"`
}
type archiveSearchOutput struct {
	Candidates []pricing.ArchiveCandidate `json:"candidates"`
	Pagination pricing.Page               `json:"pagination"`
}
type librarySearchInput struct {
	Query    string `json:"query"`
	Kind     string `json:"kind,omitempty"`
	UnitCode string `json:"unit_code,omitempty"`
	Limit    int    `json:"limit,omitempty"`
	Offset   int    `json:"offset,omitempty"`
}
type librarySearchOutput struct {
	Items      []pricing.LibraryCandidate `json:"items"`
	Pagination pricing.Page               `json:"pagination"`
}
type listTemplatesInput struct {
	Search string `json:"search,omitempty"`
	Limit  int    `json:"limit,omitempty"`
	Offset int    `json:"offset,omitempty"`
}
type listTemplatesOutput struct {
	Templates  []pricing.TemplateSummary `json:"templates"`
	Pagination pricing.Page              `json:"pagination"`
}
type idInput struct {
	ID string `json:"id"`
}
type createDraftInput struct {
	TenderID string `json:"tender_id"`
}
type addArchiveInput struct {
	DraftID          string   `json:"draft_id"`
	SourceItemID     string   `json:"source_item_id"`
	TargetPositionID string   `json:"target_position_id"`
	TargetItemID     *string  `json:"target_item_id,omitempty"`
	Quantity         *float64 `json:"quantity,omitempty"`
	Rationale        string   `json:"rationale,omitempty"`
}
type addLibraryInput struct {
	DraftID              string   `json:"draft_id"`
	LibraryID            string   `json:"library_id"`
	Kind                 string   `json:"kind"`
	TargetPositionID     string   `json:"target_position_id"`
	TargetItemID         *string  `json:"target_item_id,omitempty"`
	Quantity             *float64 `json:"quantity,omitempty"`
	DetailCostCategoryID *string  `json:"detail_cost_category_id,omitempty"`
}
type addTemplateInput struct {
	DraftID          string `json:"draft_id"`
	TemplateID       string `json:"template_id"`
	TargetPositionID string `json:"target_position_id"`
}
type addTemplateOutput struct {
	Operations []pricing.DraftOperation `json:"operations"`
}
type applyDraftInput struct {
	DraftID        string `json:"draft_id"`
	ValidationHash string `json:"validation_hash"`
}
type qaInput struct {
	TenderID string `json:"tender_id"`
}
type statusOutput struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}
type createTemplateInput struct {
	Name                 string                             `json:"name"`
	DetailCostCategoryID string                             `json:"detail_cost_category_id"`
	Works                []repository.TemplateWorkInput     `json:"works"`
	Materials            []repository.TemplateMaterialInput `json:"materials"`
}
type createTemplateOutput struct {
	ID string `json:"id"`
}
type updateTemplateInput struct {
	ID                   string                         `json:"id"`
	Name                 string                         `json:"name"`
	DetailCostCategoryID string                         `json:"detail_cost_category_id"`
	Items                []repository.TemplateItemPatch `json:"items"`
}

func registerTools(server *mcp.Server, svc *services.PricingService, principal pricing.Principal) {
	mcp.AddTool(server, readTool("tenderhub_whoami", "Show current TenderHUB OAuth identity and scopes", "Current TenderHUB identity and effective OAuth scopes."), func(ctx context.Context, _ *mcp.CallToolRequest, _ emptyInput) (*mcp.CallToolResult, whoamiOutput, error) {
		if _, err := svc.Authorize(ctx, principal, "tenders:read", "/positions"); err != nil {
			return nil, whoamiOutput{}, err
		}
		return md("# TenderHUB identity\n\nAuthenticated as **" + principal.Email + "** (`" + principal.RoleCode + "`)."), whoamiOutput{principal.UserID, principal.Email, principal.RoleCode, principal.Scopes}, nil
	})
	mcp.AddTool(server, readTool("tenderhub_list_tenders", "List active or archived tenders", "List tenders with search, archive filter and pagination. Does not modify TenderHUB."), func(ctx context.Context, _ *mcp.CallToolRequest, in listTendersInput) (*mcp.CallToolResult, listTendersOutput, error) {
		rows, page, err := svc.ListTenders(ctx, principal, in.Search, in.IsArchived, in.Limit, in.Offset)
		return md(fmt.Sprintf("Found %d tenders; returning %d.", page.TotalCount, len(rows))), listTendersOutput{rows, page}, err
	})
	mcp.AddTool(server, readTool("tenderhub_get_pricing_state", "Inspect tender pricing completeness", "Return direct-cost completeness and paginated positions for an imported tender."), func(ctx context.Context, _ *mcp.CallToolRequest, in pricingStateInput) (*mcp.CallToolResult, pricing.PricingState, error) {
		out, err := svc.GetPricingState(ctx, principal, in.TenderID, in.Limit, in.Offset)
		if out == nil {
			return nil, pricing.PricingState{}, err
		}
		return md(fmt.Sprintf("# %s\n\nPositions: %d; BOQ items: %d; missing rates: %d; direct total: %.2f RUB.", out.Tender.Title, out.PositionCount, out.ItemCount, out.MissingRateCount, out.DirectTotal)), *out, err
	})
	mcp.AddTool(server, readTool("tenderhub_search_archive_prices", "Search historical tender rates", "Search archived BOQ items using deterministic name/family, unit, category, recency and project-context ranking. Results below the safety threshold are omitted."), func(ctx context.Context, _ *mcp.CallToolRequest, in archiveSearchToolInput) (*mcp.CallToolResult, archiveSearchOutput, error) {
		rows, page, err := svc.SearchArchive(ctx, principal, pricing.ArchiveSearchInput{Query: in.Query, Kind: in.Kind, UnitCode: in.UnitCode, DetailCostCategoryID: in.DetailCostCategoryID, HousingClass: in.HousingClass, ConstructionScope: in.ConstructionScope, IncludeActive: in.IncludeActive, Limit: in.Limit, Offset: in.Offset})
		return md(fmt.Sprintf("Found %d safe archive candidates; returning %d. Review every warning and source date.", page.TotalCount, len(rows))), archiveSearchOutput{rows, page}, err
	})
	mcp.AddTool(server, readTool("tenderhub_search_library", "Search the managed work/material library", "Search managed TenderHUB work and material rates with pagination."), func(ctx context.Context, _ *mcp.CallToolRequest, in librarySearchInput) (*mcp.CallToolResult, librarySearchOutput, error) {
		rows, page, err := svc.SearchLibrary(ctx, principal, in.Query, in.Kind, in.UnitCode, in.Limit, in.Offset)
		return md(fmt.Sprintf("Found %d library items; returning %d.", page.TotalCount, len(rows))), librarySearchOutput{rows, page}, err
	})
	mcp.AddTool(server, readTool("tenderhub_list_templates", "List pricing templates", "List reusable managed pricing templates."), func(ctx context.Context, _ *mcp.CallToolRequest, in listTemplatesInput) (*mcp.CallToolResult, listTemplatesOutput, error) {
		rows, page, err := svc.ListTemplates(ctx, principal, in.Search, in.Limit, in.Offset)
		return md(fmt.Sprintf("Found %d templates; returning %d.", page.TotalCount, len(rows))), listTemplatesOutput{rows, page}, err
	})
	mcp.AddTool(server, readTool("tenderhub_get_template", "Inspect a pricing template", "Return all work/material template items and parent relationships."), func(ctx context.Context, _ *mcp.CallToolRequest, in idInput) (*mcp.CallToolResult, pricing.TemplateDetail, error) {
		out, err := svc.GetTemplate(ctx, principal, in.ID)
		if out == nil {
			return nil, pricing.TemplateDetail{}, err
		}
		return md(fmt.Sprintf("Template **%s** contains %d items.", out.Name, len(out.Items))), *out, err
	})

	mcp.AddTool(server, additiveTool("tenderhub_create_pricing_draft", "Create an auditable pricing draft", "Create an empty seven-day pricing draft for an imported tender. This does not change BOQ prices."), func(ctx context.Context, _ *mcp.CallToolRequest, in createDraftInput) (*mcp.CallToolResult, pricing.Draft, error) {
		out, err := svc.CreateDraft(ctx, principal, in.TenderID)
		if out == nil {
			return nil, pricing.Draft{}, err
		}
		return md("Created pricing draft `" + out.ID + "`. Add sources, then validate."), *out, err
	})
	mcp.AddTool(server, additiveTool("tenderhub_add_archive_price_to_draft", "Add an archive-grounded rate to a draft", "Copy direct-price inputs from one historical BOQ item into a draft. Existing targets keep their quantity/name/category; new materials require an explicit quantity."), func(ctx context.Context, _ *mcp.CallToolRequest, in addArchiveInput) (*mcp.CallToolResult, pricing.DraftOperation, error) {
		out, err := svc.AddArchivePrice(ctx, principal, services.AddArchivePriceInput{DraftID: in.DraftID, SourceItemID: in.SourceItemID, TargetPositionID: in.TargetPositionID, TargetItemID: in.TargetItemID, Quantity: in.Quantity, Rationale: in.Rationale})
		if out == nil {
			return nil, pricing.DraftOperation{}, err
		}
		return md(fmt.Sprintf("Added %s archive operation at %.0f%% confidence. Validate before applying.", out.MatchLevel, out.Confidence*100)), *out, err
	})
	mcp.AddTool(server, additiveTool("tenderhub_add_library_item_to_draft", "Add a library rate to a draft", "Add a managed work/material library item to a pricing draft."), func(ctx context.Context, _ *mcp.CallToolRequest, in addLibraryInput) (*mcp.CallToolResult, pricing.DraftOperation, error) {
		out, err := svc.AddLibraryItem(ctx, principal, services.AddLibraryItemInput{DraftID: in.DraftID, LibraryID: in.LibraryID, Kind: in.Kind, TargetPositionID: in.TargetPositionID, TargetItemID: in.TargetItemID, Quantity: in.Quantity, DetailCostCategoryID: in.DetailCostCategoryID})
		if out == nil {
			return nil, pricing.DraftOperation{}, err
		}
		return md("Added managed library operation `" + out.ID + "`."), *out, err
	})
	mcp.AddTool(server, additiveTool("tenderhub_add_template_to_draft", "Expand a template into a draft", "Expand every template work/material into ordered draft operations while preserving parent links."), func(ctx context.Context, _ *mcp.CallToolRequest, in addTemplateInput) (*mcp.CallToolResult, addTemplateOutput, error) {
		ops, err := svc.AddTemplate(ctx, principal, services.AddTemplateInput{DraftID: in.DraftID, TemplateID: in.TemplateID, TargetPositionID: in.TargetPositionID})
		return md(fmt.Sprintf("Expanded template into %d draft operations.", len(ops))), addTemplateOutput{ops}, err
	})
	mcp.AddTool(server, readTool("tenderhub_get_pricing_draft", "Inspect a pricing draft", "Return the full durable draft, operations, sources, warnings and event history."), func(ctx context.Context, _ *mcp.CallToolRequest, in idInput) (*mcp.CallToolResult, pricing.Draft, error) {
		out, err := svc.GetDraft(ctx, principal, in.ID)
		if out == nil {
			return nil, pricing.Draft{}, err
		}
		return md(fmt.Sprintf("Draft `%s` is **%s** with %d operations.", out.ID, out.Status, len(out.Operations))), *out, err
	})
	mcp.AddTool(server, additiveTool("tenderhub_validate_pricing_draft", "Validate and price-preview a draft", "Recalculate every proposed item with the authoritative server calculator, check FX, units, categories, duplicates, revisions and ETags, and return a validation hash."), func(ctx context.Context, _ *mcp.CallToolRequest, in idInput) (*mcp.CallToolResult, pricing.ValidationSummary, error) {
		out, err := svc.ValidateDraft(ctx, principal, in.ID)
		if out == nil {
			return nil, pricing.ValidationSummary{}, err
		}
		return md(fmt.Sprintf("Draft validation status: **%s**. Blocking errors: %d; warnings: %d; direct delta: %.2f RUB.", out.Status, len(out.BlockingErrors), out.WarningsCount, out.DeltaDirectTotal)), *out, err
	})
	mcp.AddTool(server, additiveTool("tenderhub_cancel_pricing_draft", "Cancel a pricing draft", "Cancel an unapplied draft. BOQ rows are not modified."), func(ctx context.Context, _ *mcp.CallToolRequest, in idInput) (*mcp.CallToolResult, statusOutput, error) {
		err := svc.CancelDraft(ctx, principal, in.ID)
		return md("Draft cancelled. No BOQ prices were changed."), statusOutput{err == nil, "draft cancelled"}, err
	})

	mcp.AddTool(server, destructiveTool("tenderhub_apply_pricing_draft", "Apply a validated draft", "Apply one validated pricing draft atomically. This tool always requires an explicit user confirmation and rejects stale validation hashes."), func(ctx context.Context, req *mcp.CallToolRequest, in applyDraftInput) (*mcp.CallToolResult, pricing.ApplyResult, error) {
		if len(req.Params.InputResponses) == 0 {
			return &mcp.CallToolResult{InputRequests: mcp.InputRequestMap{"confirm": &mcp.ElicitParams{Message: "Apply pricing draft " + in.DraftID + " to TenderHUB? This writes direct BOQ prices atomically.", RequestedSchema: &jsonschema.Schema{Type: "object", Properties: map[string]*jsonschema.Schema{"confirm": {Type: "boolean", Description: "Set true only after reviewing the validated diff."}}, Required: []string{"confirm"}}}}, RequestState: in.DraftID + ":" + in.ValidationHash}, pricing.ApplyResult{}, nil
		}
		if req.Params.RequestState != in.DraftID+":"+in.ValidationHash {
			return nil, pricing.ApplyResult{}, fmt.Errorf("confirmation state does not match draft/hash")
		}
		response, ok := req.Params.InputResponses["confirm"].(*mcp.ElicitResult)
		if !ok || response.Action != "accept" || response.Content["confirm"] != true {
			return nil, pricing.ApplyResult{}, fmt.Errorf("user declined pricing draft application")
		}
		out, err := svc.ApplyDraft(ctx, principal, in.DraftID, in.ValidationHash)
		if out == nil {
			return nil, pricing.ApplyResult{}, err
		}
		return md(fmt.Sprintf("Applied draft atomically: %d created, %d updated.", out.CreatedItems, out.UpdatedItems)), *out, err
	})
	mcp.AddTool(server, readTool("tenderhub_get_pricing_qa_report", "Generate a direct-price QA report", "Check leaf-position coverage, missing rates/quantities/categories/FX, weak or stale sources, provenance and direct total. Does not modify data."), func(ctx context.Context, _ *mcp.CallToolRequest, in qaInput) (*mcp.CallToolResult, pricing.QAReport, error) {
		out, err := svc.QAReport(ctx, principal, in.TenderID)
		if out == nil {
			return nil, pricing.QAReport{}, err
		}
		return md(fmt.Sprintf("QA ready_for_review=%t; blocking issues=%d; direct total=%.2f RUB.", out.ReadyForReview, len(out.BlockingIssues), out.DirectTotal)), *out, err
	})

	mcp.AddTool(server, additiveTool("tenderhub_create_template", "Create a managed pricing template", "Create a global template. Requires templates:write and a leading-engineer/administrator/developer role."), func(ctx context.Context, req *mcp.CallToolRequest, in createTemplateInput) (*mcp.CallToolResult, createTemplateOutput, error) {
		state := confirmationState(in)
		if len(req.Params.InputResponses) == 0 {
			return confirmationRequest("Create global pricing template "+in.Name+"?", state), createTemplateOutput{}, nil
		}
		if !confirmed(req, state) {
			return nil, createTemplateOutput{}, fmt.Errorf("template creation was not confirmed")
		}
		id, err := svc.CreateTemplate(ctx, principal, repository.CreateTemplateInput{Name: in.Name, DetailCostCategoryID: in.DetailCostCategoryID, Works: in.Works, Materials: in.Materials})
		return md("Created managed template `" + id + "`."), createTemplateOutput{id}, err
	})
	mcp.AddTool(server, destructiveTool("tenderhub_update_template", "Update a managed pricing template", "Update global template metadata and relationships. Requires templates:write and an allowed senior role."), func(ctx context.Context, req *mcp.CallToolRequest, in updateTemplateInput) (*mcp.CallToolResult, statusOutput, error) {
		state := confirmationState(in)
		if len(req.Params.InputResponses) == 0 {
			return confirmationRequest("Update global pricing template "+in.Name+"?", state), statusOutput{}, nil
		}
		if !confirmed(req, state) {
			return nil, statusOutput{}, fmt.Errorf("template update was not confirmed")
		}
		err := svc.UpdateTemplate(ctx, principal, in.ID, repository.UpdateTemplateInput{Name: in.Name, DetailCostCategoryID: in.DetailCostCategoryID, Items: in.Items})
		return md("Updated managed template `" + in.ID + "`."), statusOutput{err == nil, "template updated"}, err
	})
}

func readTool(name, title, description string) *mcp.Tool {
	return &mcp.Tool{Name: name, Title: title, Description: description, Annotations: &mcp.ToolAnnotations{Title: title, ReadOnlyHint: true, IdempotentHint: true, OpenWorldHint: boolPtr(false), DestructiveHint: boolPtr(false)}}
}
func additiveTool(name, title, description string) *mcp.Tool {
	return &mcp.Tool{Name: name, Title: title, Description: description, Annotations: &mcp.ToolAnnotations{Title: title, ReadOnlyHint: false, IdempotentHint: false, OpenWorldHint: boolPtr(false), DestructiveHint: boolPtr(false)}}
}
func destructiveTool(name, title, description string) *mcp.Tool {
	return &mcp.Tool{Name: name, Title: title, Description: description, Annotations: &mcp.ToolAnnotations{Title: title, ReadOnlyHint: false, IdempotentHint: true, OpenWorldHint: boolPtr(false), DestructiveHint: boolPtr(true)}}
}
func boolPtr(v bool) *bool { return &v }
func md(text string) *mcp.CallToolResult {
	if strings.TrimSpace(text) == "" {
		return nil
	}
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}
}
func confirmationState(v any) string {
	raw, _ := json.Marshal(v)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
func confirmationRequest(message, state string) *mcp.CallToolResult {
	return &mcp.CallToolResult{InputRequests: mcp.InputRequestMap{"confirm": &mcp.ElicitParams{Message: message, RequestedSchema: &jsonschema.Schema{Type: "object", Properties: map[string]*jsonschema.Schema{"confirm": {Type: "boolean", Description: "Set true only after reviewing the global template change."}}, Required: []string{"confirm"}}}}, RequestState: state}
}
func confirmed(req *mcp.CallToolRequest, state string) bool {
	if req.Params.RequestState != state {
		return false
	}
	r, ok := req.Params.InputResponses["confirm"].(*mcp.ElicitResult)
	return ok && r.Action == "accept" && r.Content["confirm"] == true
}
