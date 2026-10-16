package repository

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
)

// MCP writes share one receipt table: (actor, request_key) identifies a
// command, request_hash its inputs, result the committed outcome.

// claimDirectReceiptTx reserves the request key for a new write. For a key
// that is already committed it returns the stored result to replay, or
// ErrDirectRequestKeyReused when the inputs differ.
func claimDirectReceiptTx(ctx context.Context, tx pgx.Tx, actorID, requestKey, requestHash, tenderID string) ([]byte, error) {
	var inserted int
	err := tx.QueryRow(ctx, `INSERT INTO public.mcp_direct_pricing_requests
		(actor_id,request_key,request_hash,tender_id,result)
		VALUES ($1,$2,$3,$4,'{}'::jsonb)
		ON CONFLICT (actor_id,request_key) DO NOTHING RETURNING 1`,
		actorID, requestKey, requestHash, tenderID).Scan(&inserted)
	if err == nil {
		return nil, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	var existingHash string
	var raw []byte
	if err := tx.QueryRow(ctx, `SELECT request_hash,result
		FROM public.mcp_direct_pricing_requests
		WHERE actor_id=$1 AND request_key=$2 FOR UPDATE`,
		actorID, requestKey).Scan(&existingHash, &raw); err != nil {
		return nil, err
	}
	if existingHash != requestHash {
		return nil, ErrDirectRequestKeyReused
	}
	return raw, nil
}

func storeDirectReceiptTx(ctx context.Context, tx pgx.Tx, actorID, requestKey string, result any) error {
	encoded, err := json.Marshal(result)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE public.mcp_direct_pricing_requests SET result=$3::jsonb
		WHERE actor_id=$1 AND request_key=$2`, actorID, requestKey, encoded)
	return err
}

// GetDirectReceiptRaw returns a committed receipt of any MCP write kind. A
// missing row is not an error.
func (r *PricingRepo) GetDirectReceiptRaw(ctx context.Context, actorID, requestKey string) ([]byte, string, error) {
	var hash string
	var raw []byte
	err := r.pool.QueryRow(ctx, `SELECT request_hash,result
		FROM public.mcp_direct_pricing_requests
		WHERE actor_id=$1 AND request_key=$2`, actorID, requestKey).Scan(&hash, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", nil
	}
	return raw, hash, err
}
