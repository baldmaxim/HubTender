package mcpauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct{ pool *pgxpool.Pool }

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

func (r *Repository) FindClient(ctx context.Context, id string) (*Client, error) {
	var c Client
	var redirects []byte
	err := r.pool.QueryRow(ctx, `
		SELECT client_id, client_name, redirect_uris, allowed_scopes,
		       application_type, registration_kind, disabled
		FROM app_auth.oauth_clients WHERE client_id=$1`, id).Scan(
		&c.ID, &c.Name, &redirects, &c.AllowedScopes,
		&c.ApplicationType, &c.RegistrationKind, &c.Disabled,
	)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(redirects, &c.RedirectURIs); err != nil {
		return nil, fmt.Errorf("oauth client redirect_uris: %w", err)
	}
	return &c, nil
}

func (r *Repository) RegisterClient(ctx context.Context, c Client) error {
	redirects, _ := json.Marshal(c.RedirectURIs)
	_, err := r.pool.Exec(ctx, `
		INSERT INTO app_auth.oauth_clients
		    (client_id,client_name,redirect_uris,allowed_scopes,application_type,registration_kind)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		c.ID, c.Name, redirects, c.AllowedScopes, c.ApplicationType, c.RegistrationKind,
	)
	return err
}

func (r *Repository) StoreAuthorizationCode(ctx context.Context, c AuthorizationCode) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO app_auth.oauth_authorization_codes
		    (code_hash,client_id,user_id,redirect_uri,scopes,code_challenge,expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		c.CodeHash, c.ClientID, c.UserID, c.RedirectURI, c.Scopes, c.CodeChallenge, c.ExpiresAt,
	)
	return err
}

// ConsumeAuthorizationCode is single-use even under concurrent exchanges.
func (r *Repository) ConsumeAuthorizationCode(ctx context.Context, hash string) (*AuthorizationCode, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var c AuthorizationCode
	err = tx.QueryRow(ctx, `
		UPDATE app_auth.oauth_authorization_codes
		SET consumed_at=now()
		WHERE code_hash=$1 AND consumed_at IS NULL AND expires_at>now()
		RETURNING id::text,code_hash,client_id,user_id::text,redirect_uri,scopes,code_challenge,expires_at`, hash).Scan(
		&c.ID, &c.CodeHash, &c.ClientID, &c.UserID, &c.RedirectURI, &c.Scopes, &c.CodeChallenge, &c.ExpiresAt,
	)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *Repository) InsertRefreshToken(
	ctx context.Context,
	tokenHash, familyID, clientID, userID string,
	scopes []string,
	expiresAt time.Time,
	userAgent, ip string,
) error {
	var ipParam any
	if parsed := net.ParseIP(ip); parsed != nil {
		ipParam = parsed.String()
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO app_auth.oauth_refresh_tokens
		    (token_hash,token_family_id,client_id,user_id,scopes,expires_at,user_agent,ip_address)
		VALUES ($1,$2::uuid,$3,$4,$5,$6,$7,$8)`,
		tokenHash, familyID, clientID, userID, scopes, expiresAt, userAgent, ipParam,
	)
	return err
}

func (r *Repository) FindRefreshToken(ctx context.Context, hash string) (*RefreshToken, error) {
	var t RefreshToken
	err := r.pool.QueryRow(ctx, `
		SELECT id::text,token_hash,token_family_id::text,client_id,user_id::text,
		       scopes,issued_at,expires_at,revoked_at
		FROM app_auth.oauth_refresh_tokens WHERE token_hash=$1`, hash).Scan(
		&t.ID, &t.TokenHash, &t.TokenFamilyID, &t.ClientID, &t.UserID,
		&t.Scopes, &t.IssuedAt, &t.ExpiresAt, &t.RevokedAt,
	)
	return &t, err
}

func (r *Repository) RotateRefreshToken(
	ctx context.Context,
	old *RefreshToken,
	newHash string,
	expiresAt time.Time,
	userAgent, ip string,
) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var newID string
	err = tx.QueryRow(ctx, `
		INSERT INTO app_auth.oauth_refresh_tokens
		    (token_hash,token_family_id,client_id,user_id,scopes,expires_at,user_agent,ip_address)
		VALUES ($1,$2::uuid,$3,$4,$5,$6,$7,NULLIF($8,'')::inet)
		RETURNING id::text`, newHash, old.TokenFamilyID, old.ClientID, old.UserID, old.Scopes,
		expiresAt, userAgent, normalizedIP(ip)).Scan(&newID)
	if err != nil {
		return err
	}
	cmd, err := tx.Exec(ctx, `
		UPDATE app_auth.oauth_refresh_tokens
		SET revoked_at=now(),replaced_by=$2::uuid
		WHERE id=$1::uuid AND revoked_at IS NULL`, old.ID, newID)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() != 1 {
		return errors.New("refresh token already rotated")
	}
	return tx.Commit(ctx)
}

func (r *Repository) RevokeToken(ctx context.Context, hash string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE app_auth.oauth_refresh_tokens SET revoked_at=COALESCE(revoked_at,now())
		WHERE token_hash=$1`, hash)
	return err
}

func (r *Repository) RevokeFamily(ctx context.Context, familyID string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE app_auth.oauth_refresh_tokens SET revoked_at=COALESCE(revoked_at,now())
		WHERE token_family_id=$1::uuid`, familyID)
	return err
}

func (r *Repository) UpsertGrant(ctx context.Context, userID, clientID string, scopes []string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO app_auth.oauth_grants (user_id,client_id,scopes,last_used_at)
		VALUES ($1,$2,$3,now())
		ON CONFLICT (user_id,client_id) DO UPDATE
		SET scopes=EXCLUDED.scopes,last_used_at=now(),revoked_at=NULL`, userID, clientID, scopes)
	return err
}

func (r *Repository) TouchGrant(ctx context.Context, userID, clientID string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE app_auth.oauth_grants SET last_used_at=now()
		WHERE user_id=$1 AND client_id=$2 AND revoked_at IS NULL`, userID, clientID)
	return err
}

func (r *Repository) ListGrants(ctx context.Context, userID string) ([]Grant, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT g.client_id,COALESCE(c.client_name,g.client_id),g.scopes,
		       g.granted_at,g.last_used_at,g.revoked_at
		FROM app_auth.oauth_grants g
		LEFT JOIN app_auth.oauth_clients c ON c.client_id=g.client_id
		WHERE g.user_id=$1 ORDER BY g.granted_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Grant{}
	for rows.Next() {
		var g Grant
		if err := rows.Scan(&g.ClientID, &g.ClientName, &g.Scopes, &g.GrantedAt, &g.LastUsedAt, &g.RevokedAt); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func (r *Repository) RevokeGrant(ctx context.Context, userID, clientID string) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `UPDATE app_auth.oauth_grants SET revoked_at=now()
		WHERE user_id=$1 AND client_id=$2`, userID, clientID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE app_auth.oauth_refresh_tokens SET revoked_at=COALESCE(revoked_at,now())
		WHERE user_id=$1 AND client_id=$2`, userID, clientID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (r *Repository) IsGrantActive(ctx context.Context, userID, clientID string) (bool, error) {
	var active bool
	err := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM app_auth.oauth_grants
		WHERE user_id=$1 AND client_id=$2 AND revoked_at IS NULL)`, userID, clientID).Scan(&active)
	return active, err
}

func normalizedIP(raw string) string {
	if ip := net.ParseIP(raw); ip != nil {
		return ip.String()
	}
	return ""
}
