package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"unicode/utf8"

	"github.com/su10/hubtender/backend/internal/mcpauth"
	"github.com/su10/hubtender/backend/internal/pricing"
	"github.com/su10/hubtender/backend/internal/repository"
)

// maxPositionNoteRunes bounds a GP note written through MCP.
const maxPositionNoteRunes = 2000

// DirectDeleteInput deletes one VOR row (with its linked materials) through MCP.
type DirectDeleteInput struct {
	TenderID         string `json:"tender_id"`
	ItemID           string `json:"item_id"`
	ExpectedETag     string `json:"expected_etag"`
	ExpectedRevision int64  `json:"expected_revision"`
	RequestKey       string `json:"request_key"`
}

// PositionGPInput changes Количество ГП and/or its note through MCP. Nil
// leaves a field unchanged; an empty note clears it.
type PositionGPInput struct {
	TenderID         string   `json:"tender_id"`
	PositionID       string   `json:"position_id"`
	Quantity         *float64 `json:"position_quantity,omitempty"`
	Note             *string  `json:"position_note,omitempty"`
	ExpectedRevision int64    `json:"expected_revision"`
	RequestKey       string   `json:"request_key"`
}

func (s *PricingService) PreviewDirectDelete(ctx context.Context, p pricing.Principal, in DirectDeleteInput) (*pricing.DirectDeleteResult, error) {
	return s.applyDirectDelete(ctx, p, in, true)
}

func (s *PricingService) ApplyDirectDelete(ctx context.Context, p pricing.Principal, in DirectDeleteInput) (*pricing.DirectDeleteResult, error) {
	return s.applyDirectDelete(ctx, p, in, false)
}

func (s *PricingService) applyDirectDelete(ctx context.Context, p pricing.Principal, in DirectDeleteInput, preview bool) (*pricing.DirectDeleteResult, error) {
	if _, err := s.Authorize(ctx, p, mcpauth.ScopePricingWrite, "/positions"); err != nil {
		return nil, err
	}
	if in.TenderID == "" || in.ItemID == "" || in.ExpectedETag == "" || !directRequestKeyPattern.MatchString(in.RequestKey) || in.ExpectedRevision < 0 {
		return nil, fmt.Errorf("%w: tender_id, item_id, expected_etag, request_key and expected_revision are required", ErrInvalidPricingInput)
	}
	hash, err := directCommandHash(p.ClientID, "delete_item", in)
	if err != nil {
		return nil, err
	}
	var prior pricing.DirectDeleteResult
	found, err := s.replayDirectReceipt(ctx, p, in.RequestKey, hash, &prior)
	if err != nil {
		return nil, err
	}
	if found {
		prior.Replayed = true
		if !preview {
			s.afterDirectPricingCommit(in.TenderID)
		}
		return &prior, nil
	}
	if !s.features.WriteEnabled {
		return nil, ErrPricingDisabled
	}
	result, err := s.repo.ApplyDirectDelete(ctx, repository.DirectDeleteCommit{
		Preview: preview, TenderID: in.TenderID, ActorID: p.UserID, RequestKey: in.RequestKey,
		RequestHash: hash, ExpectedRevision: in.ExpectedRevision, ItemID: in.ItemID, ExpectedETag: in.ExpectedETag,
	})
	if err != nil {
		return nil, err
	}
	if !preview {
		s.afterDirectPricingCommit(in.TenderID)
	}
	return result, nil
}

func (s *PricingService) PreviewPositionGP(ctx context.Context, p pricing.Principal, in PositionGPInput) (*pricing.PositionGPResult, error) {
	return s.applyPositionGP(ctx, p, in, true)
}

func (s *PricingService) ApplyPositionGP(ctx context.Context, p pricing.Principal, in PositionGPInput) (*pricing.PositionGPResult, error) {
	return s.applyPositionGP(ctx, p, in, false)
}

func (s *PricingService) applyPositionGP(ctx context.Context, p pricing.Principal, in PositionGPInput, preview bool) (*pricing.PositionGPResult, error) {
	if _, err := s.Authorize(ctx, p, mcpauth.ScopePricingWrite, "/positions"); err != nil {
		return nil, err
	}
	if in.TenderID == "" || in.PositionID == "" || !directRequestKeyPattern.MatchString(in.RequestKey) || in.ExpectedRevision < 0 {
		return nil, fmt.Errorf("%w: tender_id, position_id, request_key and expected_revision are required", ErrInvalidPricingInput)
	}
	if in.Quantity == nil && in.Note == nil {
		return nil, fmt.Errorf("%w: set position_quantity and/or position_note", ErrInvalidPricingInput)
	}
	if in.Quantity != nil && !positiveFinite(*in.Quantity) {
		return nil, fmt.Errorf("%w: position_quantity (Количество ГП) must be finite and positive", ErrInvalidPricingInput)
	}
	if in.Note != nil && utf8.RuneCountInString(*in.Note) > maxPositionNoteRunes {
		return nil, fmt.Errorf("%w: position_note is longer than %d characters", ErrInvalidPricingInput, maxPositionNoteRunes)
	}
	hash, err := directCommandHash(p.ClientID, "position_gp", in)
	if err != nil {
		return nil, err
	}
	var prior pricing.PositionGPResult
	found, err := s.replayDirectReceipt(ctx, p, in.RequestKey, hash, &prior)
	if err != nil {
		return nil, err
	}
	if found {
		prior.Replayed = true
		if !preview {
			s.afterDirectPricingCommit(in.TenderID)
		}
		return &prior, nil
	}
	if !s.features.WriteEnabled {
		return nil, ErrPricingDisabled
	}
	result, err := s.repo.ApplyPositionGP(ctx, repository.PositionGPCommit{
		Preview: preview, TenderID: in.TenderID, ActorID: p.UserID, RequestKey: in.RequestKey,
		RequestHash: hash, ExpectedRevision: in.ExpectedRevision, PositionID: in.PositionID,
		Quantity: in.Quantity, Note: in.Note,
	})
	if err != nil {
		return nil, err
	}
	if !preview {
		s.afterDirectPricingCommit(in.TenderID)
	}
	return result, nil
}

// directCommandHash binds a request key to the OAuth client, the command kind
// and its exact inputs.
func directCommandHash(clientID, kind string, input any) (string, error) {
	encoded, err := json.Marshal(struct {
		ClientID string `json:"client_id"`
		Kind     string `json:"kind"`
		Input    any    `json:"input"`
	}{clientID, kind, input})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:]), nil
}

// replayDirectReceipt decodes a committed receipt with the same request key into
// out. A different input under the same key is rejected.
func (s *PricingService) replayDirectReceipt(ctx context.Context, p pricing.Principal, requestKey, hash string, out any) (bool, error) {
	raw, priorHash, err := s.repo.GetDirectReceiptRaw(ctx, p.UserID, requestKey)
	if err != nil || raw == nil {
		return false, err
	}
	if priorHash != hash {
		return false, repository.ErrDirectRequestKeyReused
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return false, err
	}
	return true, nil
}
