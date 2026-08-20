package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ApiAccessRepo — ключи машинного доступа, настройки выдачи API и журнал вызовов.
type ApiAccessRepo struct {
	pool *pgxpool.Pool
}

// NewApiAccessRepo creates an ApiAccessRepo.
func NewApiAccessRepo(pool *pgxpool.Pool) *ApiAccessRepo {
	return &ApiAccessRepo{pool: pool}
}

// ErrApiKeyNotFound — ключа с таким id нет.
var ErrApiKeyNotFound = errors.New("api key not found")

// ApiKeyRow — ключ в списке. Секрета здесь нет и быть не может: в БД лежит
// только хеш, и наружу он тоже не отдаётся.
type ApiKeyRow struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	KeyPrefix        string   `json:"key_prefix"`
	Scopes           []string `json:"scopes"`
	AllowedTenderIDs []string `json:"allowed_tender_ids"`
	ExpiresAt        *string  `json:"expires_at"`
	RevokedAt        *string  `json:"revoked_at"`
	LastUsedAt       *string  `json:"last_used_at"`
	CreatedAt        string   `json:"created_at"`
	CreatedBy        string   `json:"created_by"`
	CreatedByName    *string  `json:"created_by_name"`
	RevokedByName    *string  `json:"revoked_by_name"`
	// Status — производное состояние: active | revoked | expired.
	Status string `json:"status"`
	// CallsLast24h — сколько раз ключом пользовались за сутки.
	CallsLast24h int `json:"calls_last_24h"`
}

// CreateApiKeyInput — параметры выпуска.
type CreateApiKeyInput struct {
	Name             string
	KeyPrefix        string
	KeyHash          string
	Scopes           []string
	AllowedTenderIDs []string
	ExpiresAt        *string
	CreatedBy        string
}

// VerifiedApiKey — то, что нужно рантайму после проверки заголовка.
type VerifiedApiKey struct {
	ID               string
	Name             string
	Scopes           []string
	AllowedTenderIDs []string
	OwnerUserID      string
	OwnerEmail       string
	OwnerRole        string
}

const apiKeySelect = `
SELECT k.id::text, k.name, k.key_prefix, k.scopes,
       COALESCE(ARRAY(SELECT t::text FROM UNNEST(k.allowed_tender_ids) AS t), '{}'),
       to_char(k.expires_at   AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       to_char(k.revoked_at   AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       to_char(k.last_used_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       to_char(k.created_at   AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       k.created_by::text,
       cu.full_name, ru.full_name,
       CASE
         WHEN k.revoked_at IS NOT NULL THEN 'revoked'
         WHEN k.expires_at IS NOT NULL AND k.expires_at <= NOW() THEN 'expired'
         ELSE 'active'
       END,
       (SELECT count(*) FROM public.api_call_log l
         WHERE l.api_key_id = k.id AND l.called_at >= NOW() - INTERVAL '24 hours')::int
FROM public.api_keys k
LEFT JOIN public.users cu ON cu.id = k.created_by
LEFT JOIN public.users ru ON ru.id = k.revoked_by
`

func scanApiKeyRows(rows pgx.Rows) ([]ApiKeyRow, error) {
	defer rows.Close()
	out := make([]ApiKeyRow, 0)
	for rows.Next() {
		var k ApiKeyRow
		if err := rows.Scan(
			&k.ID, &k.Name, &k.KeyPrefix, &k.Scopes, &k.AllowedTenderIDs,
			&k.ExpiresAt, &k.RevokedAt, &k.LastUsedAt, &k.CreatedAt,
			&k.CreatedBy, &k.CreatedByName, &k.RevokedByName,
			&k.Status, &k.CallsLast24h,
		); err != nil {
			return nil, fmt.Errorf("scanApiKeyRows: %w", err)
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

// ListApiKeys возвращает все ключи, свежие сверху.
func (r *ApiAccessRepo) ListApiKeys(ctx context.Context) ([]ApiKeyRow, error) {
	rows, err := r.pool.Query(ctx, apiKeySelect+` ORDER BY k.created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("apiAccessRepo.ListApiKeys: %w", err)
	}
	return scanApiKeyRows(rows)
}

// CreateApiKey сохраняет ХЕШ выпущенного ключа. Секрет сюда не передаётся.
func (r *ApiAccessRepo) CreateApiKey(ctx context.Context, in CreateApiKeyInput) (*ApiKeyRow, error) {
	var id string
	err := r.pool.QueryRow(ctx, `
		INSERT INTO public.api_keys
		    (name, key_prefix, key_hash, scopes, allowed_tender_ids, expires_at, created_by)
		VALUES ($1, $2, $3, $4::text[],
		        NULLIF($5::text[], '{}')::uuid[],
		        NULLIF($6, '')::timestamptz, $7::uuid)
		RETURNING id::text
	`, in.Name, in.KeyPrefix, in.KeyHash, in.Scopes,
		in.AllowedTenderIDs, derefOrEmpty(in.ExpiresAt), in.CreatedBy,
	).Scan(&id)
	if err != nil {
		return nil, fmt.Errorf("apiAccessRepo.CreateApiKey: %w", err)
	}
	return r.GetApiKey(ctx, id)
}

// GetApiKey возвращает один ключ.
func (r *ApiAccessRepo) GetApiKey(ctx context.Context, id string) (*ApiKeyRow, error) {
	rows, err := r.pool.Query(ctx, apiKeySelect+` WHERE k.id = $1::uuid`, id)
	if err != nil {
		return nil, fmt.Errorf("apiAccessRepo.GetApiKey: %w", err)
	}
	list, err := scanApiKeyRows(rows)
	if err != nil {
		return nil, fmt.Errorf("apiAccessRepo.GetApiKey: %w", err)
	}
	if len(list) == 0 {
		return nil, ErrApiKeyNotFound
	}
	return &list[0], nil
}

// RevokeApiKey гасит ключ. Повторный отзыв — no-op, а не ошибка: результат
// один и тот же, и клиенту не за что цепляться.
func (r *ApiAccessRepo) RevokeApiKey(ctx context.Context, id, revokedBy string) (*ApiKeyRow, error) {
	tag, err := r.pool.Exec(ctx, `
		UPDATE public.api_keys
		SET revoked_at = COALESCE(revoked_at, NOW()),
		    revoked_by = COALESCE(revoked_by, $2::uuid),
		    updated_at = NOW()
		WHERE id = $1::uuid
	`, id, revokedBy)
	if err != nil {
		return nil, fmt.Errorf("apiAccessRepo.RevokeApiKey: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrApiKeyNotFound
	}
	return r.GetApiKey(ctx, id)
}

// DeleteApiKey удаляет ключ насовсем. Записи журнала сохраняются
// (api_call_log.api_key_id → ON DELETE SET NULL).
func (r *ApiAccessRepo) DeleteApiKey(ctx context.Context, id string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM public.api_keys WHERE id = $1::uuid`, id)
	if err != nil {
		return fmt.Errorf("apiAccessRepo.DeleteApiKey: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrApiKeyNotFound
	}
	return nil
}

// VerifyApiKeyHash ищет ДЕЙСТВУЮЩИЙ ключ по хешу.
//
// Отозванный и просроченный ключ не находится вовсе — проверка срока живёт в
// том же запросе, чтобы между выборкой и решением не было окна.
func (r *ApiAccessRepo) VerifyApiKeyHash(ctx context.Context, hash string) (*VerifiedApiKey, error) {
	var k VerifiedApiKey
	var email, role *string
	err := r.pool.QueryRow(ctx, `
		SELECT k.id::text, k.name, k.scopes,
		       COALESCE(ARRAY(SELECT t::text FROM UNNEST(k.allowed_tender_ids) AS t), '{}'),
		       k.created_by::text, u.email, u.role_code
		FROM public.api_keys k
		JOIN public.users u ON u.id = k.created_by
		WHERE k.key_hash = $1
		  AND k.revoked_at IS NULL
		  AND (k.expires_at IS NULL OR k.expires_at > NOW())
	`, hash).Scan(&k.ID, &k.Name, &k.Scopes, &k.AllowedTenderIDs, &k.OwnerUserID, &email, &role)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrApiKeyNotFound
		}
		return nil, fmt.Errorf("apiAccessRepo.VerifyApiKeyHash: %w", err)
	}
	k.OwnerEmail = derefOrEmpty(email)
	k.OwnerRole = derefOrEmpty(role)
	return &k, nil
}

// TouchApiKey отмечает факт использования. Лучшая попытка: неудача не должна
// валить сам запрос, поэтому вызывающий игнорирует ошибку осознанно.
func (r *ApiAccessRepo) TouchApiKey(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE public.api_keys SET last_used_at = NOW() WHERE id = $1::uuid`, id)
	return err
}
