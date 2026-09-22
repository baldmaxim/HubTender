package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/su10/hubtender/backend/internal/access"
	"github.com/su10/hubtender/backend/internal/calc"
	"github.com/su10/hubtender/backend/internal/domain/user"
	"github.com/su10/hubtender/backend/internal/mcpauth"
	"github.com/su10/hubtender/backend/internal/pricing"
	"github.com/su10/hubtender/backend/internal/repository"
)

var (
	ErrPricingForbidden    = errors.New("pricing operation is not permitted")
	ErrPricingDisabled     = errors.New("pricing writes are disabled")
	ErrDraftOwnership      = errors.New("pricing draft belongs to another user")
	ErrInvalidPricingInput = errors.New("invalid pricing input")
)

type PricingFeatures struct {
	WriteEnabled         bool
	TemplateWriteEnabled bool
}

type PricingService struct {
	repo    *repository.PricingRepo
	users   *repository.UserRepo
	library *repository.LibraryRepo
	grants  interface {
		IsGrantActive(context.Context, string, string) (bool, error)
	}
	recalcQueue *RecalcQueue
	features    PricingFeatures
}

func (s *PricingService) WithRecalcQueue(q *RecalcQueue) *PricingService {
	s.recalcQueue = q
	return s
}

func NewPricingService(repo *repository.PricingRepo, users *repository.UserRepo, library *repository.LibraryRepo, grants interface {
	IsGrantActive(context.Context, string, string) (bool, error)
}, features PricingFeatures) *PricingService {
	return &PricingService{repo: repo, users: users, library: library, grants: grants, features: features}
}

func (s *PricingService) Authorize(ctx context.Context, p pricing.Principal, scope, page string) (*user.User, error) {
	if p.UserID == "" || !slices.Contains(p.Scopes, scope) {
		return nil, ErrPricingForbidden
	}
	u, err := s.users.GetByID(ctx, p.UserID)
	if err != nil || u == nil || !u.AccessEnabled || !strings.EqualFold(u.AccessStatus, "approved") {
		return nil, ErrPricingForbidden
	}
	if page != "" && !access.HasAccess(u.AllowedPages, page) {
		return nil, ErrPricingForbidden
	}
	if p.ClientID != "" {
		if s.grants == nil {
			return nil, ErrPricingForbidden
		}
		active, err := s.grants.IsGrantActive(ctx, p.UserID, p.ClientID)
		if err != nil || !active {
			return nil, ErrPricingForbidden
		}
	}
	return u, nil
}

func (s *PricingService) ListTenders(ctx context.Context, p pricing.Principal, search string, archived *bool, limit, offset int) ([]pricing.TenderSummary, pricing.Page, error) {
	if _, err := s.Authorize(ctx, p, mcpauth.ScopeTendersRead, "/positions"); err != nil {
		return nil, pricing.Page{}, err
	}
	limit, offset = normalizePage(limit, offset, 50)
	rows, total, err := s.repo.ListPricingTenders(ctx, search, archived, limit, offset)
	page := buildPage(limit, offset, total, len(rows))
	return rows, page, err
}

func (s *PricingService) GetPricingState(ctx context.Context, p pricing.Principal, tenderID string, limit, offset int) (*pricing.PricingState, error) {
	if _, err := s.Authorize(ctx, p, mcpauth.ScopeTendersRead, "/positions"); err != nil {
		return nil, err
	}
	limit, offset = normalizePage(limit, offset, 50)
	return s.repo.GetPricingState(ctx, tenderID, limit, offset)
}

func (s *PricingService) SearchArchive(ctx context.Context, p pricing.Principal, in pricing.ArchiveSearchInput) ([]pricing.ArchiveCandidate, pricing.Page, error) {
	if _, err := s.Authorize(ctx, p, mcpauth.ScopeArchiveRead, "/positions"); err != nil {
		return nil, pricing.Page{}, err
	}
	in.Query = strings.TrimSpace(in.Query)
	if len([]rune(in.Query)) < 2 || len([]rune(in.Query)) > 300 {
		return nil, pricing.Page{}, fmt.Errorf("%w: query must contain 2-300 characters", ErrInvalidPricingInput)
	}
	in.Limit, in.Offset = normalizePage(in.Limit, in.Offset, 20)
	raw, err := s.repo.RawArchiveCandidates(ctx, in, 500)
	if err != nil {
		return nil, pricing.Page{}, err
	}
	matched := make([]pricing.ArchiveCandidate, 0, len(raw))
	for _, c := range raw {
		score, level, warnings, ok := pricing.ScoreCandidate(in.Query, in.UnitCode, in.DetailCostCategoryID, in.HousingClass, in.ConstructionScope, c, time.Now().UTC())
		if !ok {
			continue
		}
		c.Confidence, c.MatchLevel, c.Warnings = score, level, warnings
		c.Rationale = fmt.Sprintf("детерминированная оценка %.0f%%: название/семейство, единица, категория, давность и контекст", score*100)
		matched = append(matched, c)
	}
	sort.SliceStable(matched, func(i, j int) bool { return matched[i].Confidence > matched[j].Confidence })
	matched = pricing.ApplyOutlierWarnings(matched)
	total := len(matched)
	start := min(in.Offset, total)
	end := min(start+in.Limit, total)
	return matched[start:end], buildPage(in.Limit, in.Offset, total, end-start), nil
}

func (s *PricingService) SearchLibrary(ctx context.Context, p pricing.Principal, query, kind, unit string, limit, offset int) ([]pricing.LibraryCandidate, pricing.Page, error) {
	if _, err := s.Authorize(ctx, p, mcpauth.ScopeLibraryRead, "/library"); err != nil {
		return nil, pricing.Page{}, err
	}
	if len([]rune(strings.TrimSpace(query))) < 2 {
		return nil, pricing.Page{}, fmt.Errorf("%w: query must contain at least 2 characters", ErrInvalidPricingInput)
	}
	limit, offset = normalizePage(limit, offset, 20)
	rows, total, err := s.repo.SearchLibrary(ctx, query, kind, unit, limit, offset)
	return rows, buildPage(limit, offset, total, len(rows)), err
}

func (s *PricingService) ListTemplates(ctx context.Context, p pricing.Principal, search string, limit, offset int) ([]pricing.TemplateSummary, pricing.Page, error) {
	if _, err := s.Authorize(ctx, p, mcpauth.ScopeLibraryRead, "/library/templates"); err != nil {
		return nil, pricing.Page{}, err
	}
	limit, offset = normalizePage(limit, offset, 20)
	rows, total, err := s.repo.ListTemplatesForPricing(ctx, search, limit, offset)
	return rows, buildPage(limit, offset, total, len(rows)), err
}

func (s *PricingService) GetTemplate(ctx context.Context, p pricing.Principal, id string) (*pricing.TemplateDetail, error) {
	if _, err := s.Authorize(ctx, p, mcpauth.ScopeLibraryRead, "/library/templates"); err != nil {
		return nil, err
	}
	return s.repo.GetTemplateForPricing(ctx, id)
}

func (s *PricingService) CreateDraft(ctx context.Context, p pricing.Principal, tenderID string) (*pricing.Draft, error) {
	if _, err := s.Authorize(ctx, p, mcpauth.ScopePricingDraft, "/positions"); err != nil {
		return nil, err
	}
	return s.repo.CreateDraft(ctx, tenderID, p.UserID)
}

func (s *PricingService) GetDraft(ctx context.Context, p pricing.Principal, id string) (*pricing.Draft, error) {
	if _, err := s.Authorize(ctx, p, mcpauth.ScopePricingDraft, "/positions"); err != nil {
		return nil, err
	}
	d, err := s.repo.GetDraft(ctx, id)
	if err != nil {
		return nil, err
	}
	if d.CreatedBy != p.UserID {
		return nil, ErrDraftOwnership
	}
	return d, nil
}

func (s *PricingService) ListDrafts(ctx context.Context, p pricing.Principal, tenderID string, limit, offset int) ([]pricing.Draft, pricing.Page, error) {
	if _, err := s.Authorize(ctx, p, mcpauth.ScopePricingDraft, "/positions"); err != nil {
		return nil, pricing.Page{}, err
	}
	limit, offset = normalizePage(limit, offset, 20)
	rows, total, err := s.repo.ListDrafts(ctx, tenderID, p.UserID, limit, offset)
	return rows, buildPage(limit, offset, total, len(rows)), err
}

type AddArchivePriceInput struct {
	DraftID          string
	SourceItemID     string
	TargetPositionID string
	TargetItemID     *string
	Quantity         *float64
	Rationale        string
}

func (s *PricingService) AddArchivePrice(ctx context.Context, p pricing.Principal, in AddArchivePriceInput) (*pricing.DraftOperation, error) {
	d, err := s.GetDraft(ctx, p, in.DraftID)
	if err != nil {
		return nil, err
	}
	position, err := s.repo.GetTargetPosition(ctx, in.TargetPositionID)
	if err != nil {
		return nil, err
	}
	if position.TenderID != d.TenderID {
		return nil, fmt.Errorf("%w: target position is outside the draft tender", ErrInvalidPricingInput)
	}
	source, err := s.repo.GetArchiveItem(ctx, in.SourceItemID)
	if err != nil {
		return nil, err
	}
	targetName, targetUnit, targetCategory := position.WorkName, value(position.UnitCode), ""
	action := "create_item"
	var payload pricing.ProposedItem
	var expected *string
	if in.TargetItemID != nil {
		target, etag, err := s.repo.GetCurrentBoqItem(ctx, *in.TargetItemID)
		if err != nil {
			return nil, err
		}
		if target.TenderID != d.TenderID || target.ClientPositionID != position.ID {
			return nil, ErrInvalidPricingInput
		}
		targetDisplay, err := s.repo.GetArchiveItem(ctx, target.ID)
		if err == nil {
			targetName, targetUnit = targetDisplay.ItemName, value(targetDisplay.UnitCode)
		}
		if target.DetailCostCategoryID != nil {
			targetCategory = *target.DetailCostCategoryID
		}
		payload = proposedFromExisting(target)
		payload.UnitRate, payload.CurrencyType = source.UnitRate, source.CurrencyType
		payload.DeliveryPriceType, payload.DeliveryAmount = source.DeliveryPriceType, source.DeliveryAmount
		payload.ConsumptionCoefficient = source.ConsumptionCoefficient
		if payload.DetailCostCategoryID == nil {
			payload.DetailCostCategoryID = source.DetailCostCategoryID
		}
		if source.QuoteLink != nil {
			payload.QuoteLink = source.QuoteLink
		}
		if source.QuotePriceDate != nil {
			payload.QuotePriceDate = source.QuotePriceDate
		}
		if source.QuoteValidUntil != nil {
			payload.QuoteValidUntil = source.QuoteValidUntil
		}
		action, expected = "update_item", &etag
	} else {
		quantity := in.Quantity
		warnings := []string{}
		if quantity == nil && source.ItemKind == "work" {
			quantity = effectiveVolume(position)
			warnings = append(warnings, "Количество работы взято из объёма позиции")
		}
		if quantity == nil {
			return nil, fmt.Errorf("%w: quantity is required for a new material", ErrInvalidPricingInput)
		}
		sortNum := position.MaxSort + 1
		payload = pricing.ProposedItem{BoqItemType: source.BoqItemType, MaterialType: source.MaterialType,
			Description: source.Description, UnitCode: source.UnitCode, Quantity: quantity, UnitRate: source.UnitRate,
			CurrencyType: source.CurrencyType, DeliveryPriceType: source.DeliveryPriceType, DeliveryAmount: source.DeliveryAmount,
			ConsumptionCoefficient: source.ConsumptionCoefficient, DetailCostCategoryID: source.DetailCostCategoryID,
			MaterialNameID: source.MaterialNameID, WorkNameID: source.WorkNameID, QuoteLink: source.QuoteLink, SortNumber: &sortNum}
		payload.QuotePriceDate, payload.QuoteValidUntil = source.QuotePriceDate, source.QuoteValidUntil
		_ = warnings
	}
	score, level, warnings, ok := pricing.ScoreCandidate(targetName, targetUnit, targetCategory, "", "", *source, time.Now().UTC())
	if !ok {
		return nil, fmt.Errorf("%w: archive item is below the 70%% safety threshold or incompatible", ErrInvalidPricingInput)
	}
	if source.TenderID == d.TenderID {
		warnings = append(warnings, "Источник находится в том же тендере")
	}
	op := &pricing.DraftOperation{DraftID: d.ID, Action: action, TargetPositionID: position.ID,
		TargetItemID: in.TargetItemID, ExpectedETag: expected, ProposedPayload: payload, SourceKind: "archive",
		SourceRef:  pricing.SourceRef{TenderID: &source.TenderID, ItemID: &source.ItemID, Rate: source.UnitRate, Currency: source.CurrencyType, Date: &source.TenderDate},
		MatchLevel: level, Confidence: score, Rationale: stringPtr(defaultText(in.Rationale, source.Rationale)), Warnings: warnings, PositionOrder: position.MaxSort + 1}
	if err := s.repo.ResetDraftValidation(ctx, d.ID); err != nil {
		return nil, err
	}
	if err := s.repo.InsertDraftOperation(ctx, op); err != nil {
		return nil, err
	}
	_ = s.repo.InsertDraftEvent(ctx, d.ID, p.UserID, "operation_added", map[string]any{"operation_id": op.ID, "source_kind": "archive"})
	return op, nil
}

type AddLibraryItemInput struct {
	DraftID              string
	LibraryID            string
	Kind                 string
	TargetPositionID     string
	TargetItemID         *string
	Quantity             *float64
	DetailCostCategoryID *string
}

func (s *PricingService) AddLibraryItem(ctx context.Context, p pricing.Principal, in AddLibraryItemInput) (*pricing.DraftOperation, error) {
	d, err := s.GetDraft(ctx, p, in.DraftID)
	if err != nil {
		return nil, err
	}
	position, err := s.repo.GetTargetPosition(ctx, in.TargetPositionID)
	if err != nil {
		return nil, err
	}
	if position.TenderID != d.TenderID {
		return nil, ErrInvalidPricingInput
	}
	item, err := s.repo.GetLibraryItem(ctx, in.LibraryID, in.Kind)
	if err != nil {
		return nil, err
	}
	quantity := in.Quantity
	if quantity == nil && item.Kind == "work" {
		quantity = effectiveVolume(position)
	}
	if quantity == nil {
		return nil, fmt.Errorf("%w: quantity is required for a new material", ErrInvalidPricingInput)
	}
	currency := item.CurrencyType
	unit := item.UnitCode
	rate := item.UnitRate
	itemType := item.ItemType
	payload := pricing.ProposedItem{BoqItemType: itemType, UnitCode: &unit, Quantity: quantity, UnitRate: &rate,
		CurrencyType: &currency, MaterialType: item.MaterialType, DeliveryPriceType: item.DeliveryPriceType,
		DeliveryAmount: item.DeliveryAmount, ConsumptionCoefficient: item.ConsumptionCoefficient,
		DetailCostCategoryID: in.DetailCostCategoryID}
	if item.Kind == "work" {
		payload.WorkNameID = &item.NameID
	} else {
		payload.MaterialNameID = &item.NameID
	}
	action := "create_item"
	var expected *string
	if in.TargetItemID != nil {
		target, etag, err := s.repo.GetCurrentBoqItem(ctx, *in.TargetItemID)
		if err != nil {
			return nil, err
		}
		if target.TenderID != d.TenderID || target.ClientPositionID != position.ID {
			return nil, ErrInvalidPricingInput
		}
		base := proposedFromExisting(target)
		base.UnitRate, base.CurrencyType = &rate, &currency
		base.DeliveryPriceType, base.DeliveryAmount, base.ConsumptionCoefficient = item.DeliveryPriceType, item.DeliveryAmount, item.ConsumptionCoefficient
		payload, action, expected = base, "update_item", &etag
	} else {
		sortNum := position.MaxSort + 1
		payload.SortNumber = &sortNum
	}
	op := &pricing.DraftOperation{DraftID: d.ID, Action: action, TargetPositionID: position.ID, TargetItemID: in.TargetItemID,
		ExpectedETag: expected, ProposedPayload: payload, SourceKind: "library", SourceRef: pricing.SourceRef{LibraryID: &item.ID, Rate: &rate, Currency: &currency},
		MatchLevel: "strong", Confidence: item.Confidence, Rationale: stringPtr("Расценка из управляемой библиотеки TenderHUB"), PositionOrder: position.MaxSort + 1}
	if err := s.repo.ResetDraftValidation(ctx, d.ID); err != nil {
		return nil, err
	}
	if err := s.repo.InsertDraftOperation(ctx, op); err != nil {
		return nil, err
	}
	_ = s.repo.InsertDraftEvent(ctx, d.ID, p.UserID, "operation_added", map[string]any{"operation_id": op.ID, "source_kind": "library"})
	return op, nil
}

type AddTemplateInput struct{ DraftID, TemplateID, TargetPositionID string }

func (s *PricingService) AddTemplate(ctx context.Context, p pricing.Principal, in AddTemplateInput) ([]pricing.DraftOperation, error) {
	d, err := s.GetDraft(ctx, p, in.DraftID)
	if err != nil {
		return nil, err
	}
	position, err := s.repo.GetTargetPosition(ctx, in.TargetPositionID)
	if err != nil {
		return nil, err
	}
	if position.TenderID != d.TenderID {
		return nil, ErrInvalidPricingInput
	}
	tmpl, err := s.repo.GetTemplateForPricing(ctx, in.TemplateID)
	if err != nil {
		return nil, err
	}
	if len(tmpl.Items) == 0 {
		return nil, fmt.Errorf("%w: template is empty", ErrInvalidPricingInput)
	}
	if err := s.repo.ResetDraftValidation(ctx, d.ID); err != nil {
		return nil, err
	}
	createdByTemplateID := map[string]string{}
	ops := make([]pricing.DraftOperation, 0, len(tmpl.Items))
	for _, item := range tmpl.Items {
		qty := 1.0
		if item.Kind == "material" && item.ConversionCoefficient != nil && *item.ConversionCoefficient != 0 {
			if v := effectiveVolume(position); v != nil {
				qty = *v * *item.ConversionCoefficient
			}
		}
		unit, cur, rate := item.UnitCode, item.CurrencyType, item.UnitRate
		payload := pricing.ProposedItem{BoqItemType: item.ItemType, MaterialType: item.MaterialType, UnitCode: &unit, Quantity: &qty,
			UnitRate: &rate, CurrencyType: &cur, DeliveryPriceType: item.DeliveryPriceType, DeliveryAmount: item.DeliveryAmount,
			ConsumptionCoefficient: item.ConsumptionCoefficient, ConversionCoefficient: item.ConversionCoefficient,
			DetailCostCategoryID: item.DetailCostCategoryID, Description: item.Note}
		if payload.DetailCostCategoryID == nil {
			payload.DetailCostCategoryID = tmpl.DetailCostCategoryID
		}
		if item.Kind == "work" {
			payload.WorkNameID = &item.NameID
		} else {
			payload.MaterialNameID = &item.NameID
		}
		order := position.MaxSort + item.Position + 1
		payload.SortNumber = &order
		op := pricing.DraftOperation{DraftID: d.ID, Action: "create_item", TargetPositionID: position.ID, ProposedPayload: payload,
			SourceKind: "template", SourceRef: pricing.SourceRef{TemplateID: &tmpl.ID, Rate: &rate, Currency: &cur}, MatchLevel: "strong", Confidence: 1,
			Rationale: stringPtr("Элемент из управляемого шаблона " + tmpl.Name), PositionOrder: order}
		if item.ParentTemplateItemID != nil {
			if parent := createdByTemplateID[*item.ParentTemplateItemID]; parent != "" {
				op.ParentOperationID = &parent
			}
		}
		if err := s.repo.InsertDraftOperation(ctx, &op); err != nil {
			return nil, err
		}
		createdByTemplateID[item.ID] = op.ID
		ops = append(ops, op)
	}
	_ = s.repo.InsertDraftEvent(ctx, d.ID, p.UserID, "template_added", map[string]any{"template_id": tmpl.ID, "operations": len(ops)})
	return ops, nil
}

func (s *PricingService) ValidateDraft(ctx context.Context, p pricing.Principal, id string) (*pricing.ValidationSummary, error) {
	d, err := s.GetDraft(ctx, p, id)
	if err != nil {
		return nil, err
	}
	if d.Status != "draft" && d.Status != "ready" {
		return nil, repository.ErrDraftNotEditable
	}
	revision, usd, eur, cny, err := s.repo.GetTenderRevisionAndRates(ctx, d.TenderID)
	if err != nil {
		return nil, err
	}
	before, err := s.repo.TenderDirectTotal(ctx, d.TenderID)
	if err != nil {
		return nil, err
	}
	unresolved, err := s.repo.CountUnresolvedPositions(ctx, d.TenderID)
	if err != nil {
		return nil, err
	}
	summary := &pricing.ValidationSummary{DraftID: id, Status: "draft", OperationsCount: len(d.Operations), BeforeDirectTotal: before, AfterDirectTotal: before, UnresolvedPositions: unresolved, ValidatedAt: time.Now().UTC()}
	if !revision.Equal(d.BaseRevision) {
		summary.BlockingErrors = append(summary.BlockingErrors, "Тендер изменён после создания черновика; создайте новый черновик")
	}
	if len(d.Operations) == 0 {
		summary.BlockingErrors = append(summary.BlockingErrors, "Черновик не содержит операций")
	}
	seenItems := map[string]bool{}
	seenOps := map[string]bool{}
	resolvedPositions := map[string]bool{}
	rates := calc.CurrencyRates{USDRate: usd, EURRate: eur, CNYRate: cny}
	for _, op := range d.Operations {
		position, err := s.repo.GetTargetPosition(ctx, op.TargetPositionID)
		if err != nil {
			summary.BlockingErrors = append(summary.BlockingErrors, "Целевая позиция недоступна: "+op.TargetPositionID)
			continue
		}
		if position.TenderID != d.TenderID {
			summary.BlockingErrors = append(summary.BlockingErrors, "Операция ссылается на другой тендер: "+op.ID)
		}
		if op.ParentOperationID != nil && !seenOps[*op.ParentOperationID] {
			summary.BlockingErrors = append(summary.BlockingErrors, "Родительская операция должна идти раньше дочерней: "+op.ID)
		}
		seenOps[op.ID] = true
		if op.Action == "update_item" {
			summary.UpdateCount++
			if op.TargetItemID == nil {
				summary.BlockingErrors = append(summary.BlockingErrors, "UPDATE без target_item_id: "+op.ID)
				continue
			}
			if seenItems[*op.TargetItemID] {
				summary.BlockingErrors = append(summary.BlockingErrors, "Один BOQ-элемент изменяется дважды: "+*op.TargetItemID)
			}
			seenItems[*op.TargetItemID] = true
			current, etag, e := s.repo.GetCurrentBoqItem(ctx, *op.TargetItemID)
			if e != nil || op.ExpectedETag == nil || *op.ExpectedETag != etag {
				summary.BlockingErrors = append(summary.BlockingErrors, "BOQ-элемент изменён после добавления в черновик: "+*op.TargetItemID)
			} else if current.TotalAmount != nil {
				summary.AfterDirectTotal -= *current.TotalAmount
			}
		} else {
			summary.CreateCount++
		}
		if err := validateProposed(op.ProposedPayload); err != nil {
			summary.BlockingErrors = append(summary.BlockingErrors, op.ID+": "+err.Error())
			continue
		}
		var parent *string
		if op.ParentOperationID != nil {
			placeholder := "pending-parent"
			parent = &placeholder
		}
		amount, e := calc.CalculateBoqItemTotalAmount(calc.BoqItemAmountInput{BoqItemType: op.ProposedPayload.BoqItemType, Quantity: op.ProposedPayload.Quantity, UnitRate: op.ProposedPayload.UnitRate, CurrencyType: value(op.ProposedPayload.CurrencyType), DeliveryPriceType: value(op.ProposedPayload.DeliveryPriceType), DeliveryAmount: op.ProposedPayload.DeliveryAmount, ConsumptionCoefficient: op.ProposedPayload.ConsumptionCoefficient, ParentWorkItemID: parent}, rates)
		if e != nil {
			summary.BlockingErrors = append(summary.BlockingErrors, op.ID+": "+e.Error())
			continue
		}
		summary.AfterDirectTotal += amount
		summary.WarningsCount += len(op.Warnings)
		if op.ProposedPayload.DetailCostCategoryID == nil {
			summary.WarningsCount++
		}
		if op.ProposedPayload.UnitRate != nil && *op.ProposedPayload.UnitRate > 0 {
			resolvedPositions[op.TargetPositionID] = true
		}
	}
	summary.DeltaDirectTotal = summary.AfterDirectTotal - summary.BeforeDirectTotal
	summary.UnresolvedPositions = max(0, summary.UnresolvedPositions-len(resolvedPositions))
	hashInput, _ := json.Marshal(struct {
		Revision   time.Time                `json:"revision"`
		Operations []pricing.DraftOperation `json:"operations"`
	}{revision, d.Operations})
	h := sha256.Sum256(hashInput)
	summary.ValidationHash = hex.EncodeToString(h[:])
	if len(summary.BlockingErrors) > 0 {
		_ = s.repo.InsertDraftEvent(ctx, id, p.UserID, "validation_failed", summary)
		return summary, nil
	}
	summary.Status = "ready"
	if err := s.repo.SetDraftValidated(ctx, id, summary.ValidationHash, *summary, p.UserID); err != nil {
		return nil, err
	}
	return summary, nil
}

func (s *PricingService) ApplyDraft(ctx context.Context, p pricing.Principal, id, hash string) (*pricing.ApplyResult, error) {
	if !s.features.WriteEnabled {
		return nil, ErrPricingDisabled
	}
	if _, err := s.Authorize(ctx, p, mcpauth.ScopePricingApply, "/positions"); err != nil {
		return nil, err
	}
	d, err := s.GetDraft(ctx, p, id)
	if err != nil {
		return nil, err
	}
	if d.CreatedBy != p.UserID {
		return nil, ErrDraftOwnership
	}
	result, err := s.repo.ApplyDraft(ctx, id, hash, p.UserID)
	if errors.Is(err, repository.ErrDraftStale) {
		s.repo.MarkDraftStale(ctx, id, p.UserID, err.Error())
	}
	if err == nil && result != nil && s.recalcQueue != nil {
		s.recalcQueue.Enqueue(d.TenderID)
	}
	return result, err
}

func (s *PricingService) CancelDraft(ctx context.Context, p pricing.Principal, id string) error {
	d, err := s.GetDraft(ctx, p, id)
	if err != nil {
		return err
	}
	return s.repo.CancelDraft(ctx, d.ID, p.UserID)
}

func (s *PricingService) QAReport(ctx context.Context, p pricing.Principal, tenderID string) (*pricing.QAReport, error) {
	if _, err := s.Authorize(ctx, p, mcpauth.ScopeTendersRead, "/positions"); err != nil {
		return nil, err
	}
	return s.repo.GetPricingQA(ctx, tenderID)
}

func (s *PricingService) CreateTemplate(ctx context.Context, p pricing.Principal, in repository.CreateTemplateInput) (string, error) {
	u, err := s.Authorize(ctx, p, mcpauth.ScopeTemplatesWrite, "/library/templates")
	if err != nil {
		return "", err
	}
	if !s.features.TemplateWriteEnabled || !slices.Contains([]string{"veduschiy_inzhener", "administrator", "developer"}, u.RoleCode) {
		return "", ErrPricingDisabled
	}
	return s.library.CreateTemplate(ctx, in)
}

func (s *PricingService) UpdateTemplate(ctx context.Context, p pricing.Principal, id string, in repository.UpdateTemplateInput) error {
	u, err := s.Authorize(ctx, p, mcpauth.ScopeTemplatesWrite, "/library/templates")
	if err != nil {
		return err
	}
	if !s.features.TemplateWriteEnabled || !slices.Contains([]string{"veduschiy_inzhener", "administrator", "developer"}, u.RoleCode) {
		return ErrPricingDisabled
	}
	return s.library.UpdateTemplate(ctx, id, in)
}
