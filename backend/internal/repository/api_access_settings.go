package repository

import (
	"context"
	"fmt"
)

// ApiAccessSettings — тумблеры выдачи API и потолки. Строка ровно одна
// (api_access_settings.id = true).
type ApiAccessSettings struct {
	ArchiveSearchEnabled  bool    `json:"archive_search_enabled"`
	ArchiveReadEnabled    bool    `json:"archive_read_enabled"`
	ArchiveSuggestEnabled bool    `json:"archive_suggest_enabled"`
	ArchiveComposeEnabled bool    `json:"archive_compose_enabled"`
	MaxSearchLimit        int     `json:"max_search_limit"`
	MaxCandidateLimit     int     `json:"max_candidate_limit"`
	MaxSuggestQueries     int     `json:"max_suggest_queries"`
	RateLimitPerMinute    int     `json:"rate_limit_per_minute"`
	CallLogRetentionDays  int     `json:"call_log_retention_days"`
	UpdatedAt             string  `json:"updated_at"`
	UpdatedBy             *string `json:"updated_by"`
	UpdatedByName         *string `json:"updated_by_name"`
}

const apiAccessSettingsSelect = `
SELECT s.archive_search_enabled, s.archive_read_enabled,
       s.archive_suggest_enabled, s.archive_compose_enabled,
       s.max_search_limit, s.max_candidate_limit, s.max_suggest_queries,
       s.rate_limit_per_minute, s.call_log_retention_days,
       to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       s.updated_by::text, u.full_name
FROM public.api_access_settings s
LEFT JOIN public.users u ON u.id = s.updated_by
WHERE s.id = true
`

// GetApiAccessSettings читает единственную строку настроек.
func (r *ApiAccessRepo) GetApiAccessSettings(ctx context.Context) (*ApiAccessSettings, error) {
	var s ApiAccessSettings
	err := r.pool.QueryRow(ctx, apiAccessSettingsSelect).Scan(
		&s.ArchiveSearchEnabled, &s.ArchiveReadEnabled,
		&s.ArchiveSuggestEnabled, &s.ArchiveComposeEnabled,
		&s.MaxSearchLimit, &s.MaxCandidateLimit, &s.MaxSuggestQueries,
		&s.RateLimitPerMinute, &s.CallLogRetentionDays,
		&s.UpdatedAt, &s.UpdatedBy, &s.UpdatedByName,
	)
	if err != nil {
		return nil, fmt.Errorf("apiAccessRepo.GetApiAccessSettings: %w", err)
	}
	return &s, nil
}

// UpdateApiAccessSettings перезаписывает настройки целиком.
// Диапазоны значений стережёт CHECK api_access_settings_limits_chk.
func (r *ApiAccessRepo) UpdateApiAccessSettings(
	ctx context.Context, s ApiAccessSettings, updatedBy string,
) (*ApiAccessSettings, error) {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.api_access_settings
		SET archive_search_enabled  = $1,
		    archive_read_enabled    = $2,
		    archive_suggest_enabled = $3,
		    archive_compose_enabled = $4,
		    max_search_limit        = $5,
		    max_candidate_limit     = $6,
		    max_suggest_queries     = $7,
		    rate_limit_per_minute   = $8,
		    call_log_retention_days = $9,
		    updated_at              = NOW(),
		    updated_by              = $10::uuid
		WHERE id = true
	`,
		s.ArchiveSearchEnabled, s.ArchiveReadEnabled,
		s.ArchiveSuggestEnabled, s.ArchiveComposeEnabled,
		s.MaxSearchLimit, s.MaxCandidateLimit, s.MaxSuggestQueries,
		s.RateLimitPerMinute, s.CallLogRetentionDays, updatedBy,
	)
	if err != nil {
		return nil, fmt.Errorf("apiAccessRepo.UpdateApiAccessSettings: %w", err)
	}
	return r.GetApiAccessSettings(ctx)
}

// ─── Журнал вызовов ─────────────────────────────────────────────────────────

// ApiCallLogEntry — запись журнала. Только метаданные: ни тел запросов, ни
// секретов, ни ключа в открытом виде.
type ApiCallLogEntry struct {
	ID            string  `json:"id"`
	ApiKeyID      *string `json:"api_key_id"`
	ApiKeyName    *string `json:"api_key_name"`
	UserID        *string `json:"user_id"`
	UserName      *string `json:"user_name"`
	Method        string  `json:"method"`
	Path          string  `json:"path"`
	Status        int     `json:"status"`
	DurationMs    int     `json:"duration_ms"`
	ErrorCode     *string `json:"error_code"`
	ItemsAffected *int    `json:"items_affected"`
	DryRun        *bool   `json:"dry_run"`
	CalledAt      string  `json:"called_at"`
}

// ApiCallLogFilter — фильтры выборки журнала.
type ApiCallLogFilter struct {
	ApiKeyID   string
	OnlyErrors bool
	Limit      int
}

// InsertApiCallLog пишет одну запись журнала.
func (r *ApiAccessRepo) InsertApiCallLog(ctx context.Context, e ApiCallLogEntry) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.api_call_log
		    (api_key_id, user_id, method, path, status, duration_ms,
		     error_code, items_affected, dry_run)
		VALUES (NULLIF($1,'')::uuid, NULLIF($2,'')::uuid, $3, $4, $5, $6,
		        NULLIF($7,''), $8, $9)
	`,
		derefOrEmpty(e.ApiKeyID), derefOrEmpty(e.UserID),
		e.Method, e.Path, e.Status, e.DurationMs,
		derefOrEmpty(e.ErrorCode), e.ItemsAffected, e.DryRun,
	)
	if err != nil {
		return fmt.Errorf("apiAccessRepo.InsertApiCallLog: %w", err)
	}
	return nil
}

// ListApiCallLog возвращает журнал, свежие сверху.
func (r *ApiAccessRepo) ListApiCallLog(ctx context.Context, f ApiCallLogFilter) ([]ApiCallLogEntry, error) {
	limit := f.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 1000 {
		limit = 1000
	}
	rows, err := r.pool.Query(ctx, `
		SELECT l.id::text, l.api_key_id::text, k.name,
		       l.user_id::text, u.full_name,
		       l.method, l.path, l.status, l.duration_ms,
		       l.error_code, l.items_affected, l.dry_run,
		       to_char(l.called_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM public.api_call_log l
		LEFT JOIN public.api_keys k ON k.id = l.api_key_id
		LEFT JOIN public.users u ON u.id = l.user_id
		WHERE ($1::uuid IS NULL OR l.api_key_id = $1::uuid)
		  AND (NOT $2::boolean OR l.status >= 400)
		ORDER BY l.called_at DESC
		LIMIT $3::int
	`, nullableUUID(f.ApiKeyID), f.OnlyErrors, limit)
	if err != nil {
		return nil, fmt.Errorf("apiAccessRepo.ListApiCallLog: %w", err)
	}
	defer rows.Close()

	out := make([]ApiCallLogEntry, 0, limit)
	for rows.Next() {
		var e ApiCallLogEntry
		if err := rows.Scan(
			&e.ID, &e.ApiKeyID, &e.ApiKeyName, &e.UserID, &e.UserName,
			&e.Method, &e.Path, &e.Status, &e.DurationMs,
			&e.ErrorCode, &e.ItemsAffected, &e.DryRun, &e.CalledAt,
		); err != nil {
			return nil, fmt.Errorf("apiAccessRepo.ListApiCallLog: scan: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// PurgeApiCallLog чистит журнал по сроку хранения из настроек.
func (r *ApiAccessRepo) PurgeApiCallLog(ctx context.Context, retentionDays int) (int, error) {
	if retentionDays <= 0 {
		return 0, nil
	}
	tag, err := r.pool.Exec(ctx, `
		DELETE FROM public.api_call_log
		WHERE called_at < NOW() - make_interval(days => $1::int)
	`, retentionDays)
	if err != nil {
		return 0, fmt.Errorf("apiAccessRepo.PurgeApiCallLog: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

func nullableUUID(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}
