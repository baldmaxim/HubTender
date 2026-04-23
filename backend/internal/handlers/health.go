package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/su10/hubtender/backend/internal/cache"
)

// HealthHandler handles GET /health (liveness), /health/db (readiness +
// DB reachability), and /health/cache (in-memory cache stats).
// No authentication required.
type HealthHandler struct {
	pool  *pgxpool.Pool
	cache *cache.InMem
}

// NewHealthHandler creates a HealthHandler. The pool is optional — when nil,
// only the liveness endpoint works. The cache is optional — when nil,
// /health/cache returns zeroes.
func NewHealthHandler(pool *pgxpool.Pool, c *cache.InMem) *HealthHandler {
	return &HealthHandler{pool: pool, cache: c}
}

// ServeHTTP responds with {"status":"ok"} and HTTP 200 — process liveness.
func (h *HealthHandler) ServeHTTP(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// CacheStats returns the in-memory cache hit/miss counters and entry count.
// Useful for eyeballing cache efficiency in prod without Prometheus.
func (h *HealthHandler) CacheStats(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if h.cache == nil {
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(cache.Stats{})
		return
	}
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(h.cache.Stats())
}

// CheckDB probes the database with a 2-second timeout SELECT 1.
// Returns 200 {"status":"ok"} on success, 503 {"status":"down","error":...} otherwise.
func (h *HealthHandler) CheckDB(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if h.pool == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status": "down", "error": "pool not configured",
		})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	var one int
	if err := h.pool.QueryRow(ctx, `SELECT 1`).Scan(&one); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status": "down", "error": err.Error(),
		})
		return
	}
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
