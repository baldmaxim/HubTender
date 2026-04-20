package handlers

import (
	"encoding/json"
	"net/http"
)

// HealthHandler handles the GET /health liveness probe.
// No authentication required — called by load balancers and orchestrators.
type HealthHandler struct{}

// NewHealthHandler creates a HealthHandler.
func NewHealthHandler() *HealthHandler {
	return &HealthHandler{}
}

// ServeHTTP responds with {"status":"ok"} and HTTP 200.
func (h *HealthHandler) ServeHTTP(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
