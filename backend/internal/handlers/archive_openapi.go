package handlers

import (
	_ "embed"
	"net/http"
)

// archiveOpenAPISpec — спецификация домена «архив смет». Отдаётся как есть,
// чтобы потребитель мог сгенерировать клиент любым openapi-generator: это и
// заменяет автодоки FastAPI, ради которых обычно заводят отдельный сервис.
//
//go:embed openapi/archive.yaml
var archiveOpenAPISpec []byte

// OpenAPI handles GET /api/v1/archive/openapi.yaml.
func (h *ArchiveHandler) OpenAPI(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(archiveOpenAPISpec)
}
