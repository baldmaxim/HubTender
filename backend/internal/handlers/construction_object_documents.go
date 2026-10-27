package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// Лимиты загрузки документа объекта. Тело запроса ограничено с запасом на
// multipart-обёртку и текстовые поля.
const (
	maxObjectDocumentFileBytes = 25 << 20 // 25 МБ — файл
	maxObjectDocumentBodyBytes = 26 << 20 // 26 МБ — всё тело запроса
	maxObjectDocumentTitleLen  = 300
	maxObjectDocumentNameLen   = 200
	objectDocumentFallbackName = "document"
)

// constructionObjectDocumentsServicer is the interface ConstructionObjectDocumentsHandler depends on.
type constructionObjectDocumentsServicer interface {
	List(ctx context.Context, objectID string) ([]repository.ConstructionObjectDocumentMeta, error)
	Create(ctx context.Context, objectID string, in repository.ConstructionObjectDocumentInput, createdBy *string) (*repository.ConstructionObjectDocumentMeta, error)
	UpdateMeta(ctx context.Context, docID string, title, docDate *string) (*repository.ConstructionObjectDocumentMeta, error)
	Delete(ctx context.Context, docID string) error
	File(ctx context.Context, docID string) (*repository.ConstructionObjectDocumentFile, error)
}

// ConstructionObjectDocumentsHandler serves документы объектов строительства.
type ConstructionObjectDocumentsHandler struct {
	svc constructionObjectDocumentsServicer
}

// NewConstructionObjectDocumentsHandler creates a ConstructionObjectDocumentsHandler.
func NewConstructionObjectDocumentsHandler(svc constructionObjectDocumentsServicer) *ConstructionObjectDocumentsHandler {
	return &ConstructionObjectDocumentsHandler{svc: svc}
}

// objectDocumentMime определяет тип по байтам (не по заголовку клиента); пусто — не поддерживается.
// TIFF Go не распознаёт, поэтому проверяется сигнатура II*\0 / MM\0*.
func objectDocumentMime(data []byte) string {
	if bytes.HasPrefix(data, []byte{'I', 'I', '*', 0x00}) || bytes.HasPrefix(data, []byte{'M', 'M', 0x00, '*'}) {
		return "image/tiff"
	}
	switch m := http.DetectContentType(data); m {
	case "application/pdf", "image/jpeg", "image/png", "image/webp":
		return m
	}
	return ""
}

// sanitizeObjectDocumentName оставляет в имени файла только последний
// компонент пути (и «/», и «\»), убирает управляющие символы и режет до 200 символов.
func sanitizeObjectDocumentName(raw string) string {
	name := strings.ReplaceAll(raw, `\`, "/")
	name = path.Base(name)
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == utf8.RuneError {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if name == "." || name == ".." || name == "/" {
		name = ""
	}
	if utf8.RuneCountInString(name) > maxObjectDocumentNameLen {
		name = string([]rune(name)[:maxObjectDocumentNameLen])
	}
	if name == "" {
		return objectDocumentFallbackName
	}
	return name
}

// normalizeObjectDocumentTitle обрезает пробелы; пустое название — nil.
func normalizeObjectDocumentTitle(raw string) (*string, *apierr.Problem) {
	t := strings.TrimSpace(raw)
	if t == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(t) > maxObjectDocumentTitleLen {
		return nil, apierr.BadRequest("title must be at most " + strconv.Itoa(maxObjectDocumentTitleLen) + " characters")
	}
	return &t, nil
}

// normalizeObjectDocumentDate принимает YYYY-MM-DD; пустая дата — nil.
func normalizeObjectDocumentDate(raw string) (*string, *apierr.Problem) {
	d := strings.TrimSpace(raw)
	if d == "" {
		return nil, nil
	}
	if _, err := time.Parse("2006-01-02", d); err != nil {
		return nil, apierr.BadRequest("doc_date must be a date in YYYY-MM-DD format")
	}
	return &d, nil
}

// parseObjectDocumentUpload разбирает и проверяет multipart-запрос загрузки документа.
// Проблема уже готова к ответу клиенту.
func parseObjectDocumentUpload(w http.ResponseWriter, r *http.Request) (repository.ConstructionObjectDocumentInput, *apierr.Problem) {
	var in repository.ConstructionObjectDocumentInput

	r.Body = http.MaxBytesReader(w, r.Body, maxObjectDocumentBodyBytes)
	// Память с запасом на всё тело: ничего не пишется во временные файлы.
	if err := r.ParseMultipartForm(maxObjectDocumentBodyBytes + 1<<20); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			return in, apierr.New(http.StatusRequestEntityTooLarge, "Payload Too Large", "тело запроса превышает 26 МБ")
		}
		return in, apierr.BadRequest("не удалось разобрать multipart-запрос")
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll() //nolint:errcheck
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		return in, apierr.BadRequest("поле file обязательно")
	}
	defer file.Close() //nolint:errcheck
	data, err := io.ReadAll(io.LimitReader(file, maxObjectDocumentFileBytes+1))
	if err != nil {
		return in, apierr.BadRequest("не удалось прочитать поле file")
	}
	if len(data) == 0 {
		return in, apierr.BadRequest("поле file пустое")
	}
	if len(data) > maxObjectDocumentFileBytes {
		return in, apierr.New(http.StatusRequestEntityTooLarge, "Payload Too Large", "поле file превышает 25 МБ")
	}
	mimeType := objectDocumentMime(data)
	if mimeType == "" {
		return in, apierr.BadRequest("поле file: допустимы только PDF, JPEG, PNG, TIFF и WebP")
	}

	title, prob := normalizeObjectDocumentTitle(r.FormValue("title"))
	if prob != nil {
		return in, prob
	}
	docDate, prob := normalizeObjectDocumentDate(r.FormValue("doc_date"))
	if prob != nil {
		return in, prob
	}

	in = repository.ConstructionObjectDocumentInput{
		FileName: sanitizeObjectDocumentName(header.Filename),
		Mime:     mimeType,
		Content:  data,
		Title:    title,
		DocDate:  docDate,
	}
	return in, nil
}

// objectDocumentID достаёт и проверяет {docId}; битый id отвечает 404.
func objectDocumentID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := chi.URLParam(r, "docId")
	if !constructionObjectUUIDRe.MatchString(id) {
		apierr.NotFound("construction object document not found").Render(w)
		return "", false
	}
	return id, true
}

// renderObjectDocumentErr отвечает на ожидаемые ошибки документов; false — ошибка неизвестна.
func renderObjectDocumentErr(w http.ResponseWriter, err error) bool {
	switch {
	case errors.Is(err, repository.ErrConstructionObjectNotFound):
		apierr.NotFound("construction object not found").Render(w)
	case errors.Is(err, repository.ErrConstructionObjectDocumentNotFound):
		apierr.NotFound("construction object document not found").Render(w)
	case errors.Is(err, repository.ErrConstructionObjectDocumentLimit):
		apierr.BadRequest("у объекта не может быть больше " + strconv.Itoa(repository.MaxConstructionObjectDocuments) + " документов").Render(w)
	default:
		return false
	}
	return true
}

// contentDispositionHeader строит значение Content-Disposition: ASCII-запасной
// filename и filename* в UTF-8 (RFC 5987/6266) для кириллических имён.
func contentDispositionHeader(disposition, fileName string) string {
	var fallback strings.Builder
	for _, r := range fileName {
		if r >= 0x20 && r < 0x7F && r != '"' && r != '\\' && r != '%' {
			fallback.WriteRune(r)
		} else {
			fallback.WriteByte('_')
		}
	}
	return disposition + `; filename="` + fallback.String() + `"; filename*=UTF-8''` + percentEncodeRFC5987(fileName)
}

// percentEncodeRFC5987 кодирует всё, кроме attr-char (буквы, цифры и !#$&+-.^_`|~).
func percentEncodeRFC5987(s string) string {
	const attrChars = "!#$&+-.^_`|~"
	var b strings.Builder
	for _, c := range []byte(s) {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', strings.IndexByte(attrChars, c) >= 0:
			b.WriteByte(c)
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

// List handles GET /api/v1/construction-objects/{id}/documents.
func (h *ConstructionObjectDocumentsHandler) List(w http.ResponseWriter, r *http.Request) {
	id, ok := constructionObjectID(w, r)
	if !ok {
		return
	}
	rows, err := h.svc.List(r.Context(), id)
	if err != nil {
		if renderObjectDocumentErr(w, err) {
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to list construction object documents")
		return
	}
	if rows == nil {
		rows = []repository.ConstructionObjectDocumentMeta{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// Create handles POST /api/v1/construction-objects/{id}/documents (multipart/form-data).
func (h *ConstructionObjectDocumentsHandler) Create(w http.ResponseWriter, r *http.Request) {
	id, ok := constructionObjectID(w, r)
	if !ok {
		return
	}
	in, prob := parseObjectDocumentUpload(w, r)
	if prob != nil {
		prob.Render(w)
		return
	}
	var createdBy *string
	if u := middleware.UserFromContext(r.Context()); u != nil && u.ID != "" {
		createdBy = &u.ID
	}
	m, err := h.svc.Create(r.Context(), id, in, createdBy)
	if err != nil {
		if renderObjectDocumentErr(w, err) {
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to create construction object document")
		return
	}
	renderJSON(w, r, http.StatusCreated, dataEnvelope{Data: m})
}

// UpdateMeta handles PATCH /api/v1/construction-object-documents/{docId}.
// Название и дата заменяются целиком: отсутствующее или null поле очищается.
func (h *ConstructionObjectDocumentsHandler) UpdateMeta(w http.ResponseWriter, r *http.Request) {
	id, ok := objectDocumentID(w, r)
	if !ok {
		return
	}
	var req struct {
		Title   *string `json:"title"`
		DocDate *string `json:"doc_date"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	var title, docDate *string
	if req.Title != nil {
		t, prob := normalizeObjectDocumentTitle(*req.Title)
		if prob != nil {
			prob.Render(w)
			return
		}
		title = t
	}
	if req.DocDate != nil {
		d, prob := normalizeObjectDocumentDate(*req.DocDate)
		if prob != nil {
			prob.Render(w)
			return
		}
		docDate = d
	}
	m, err := h.svc.UpdateMeta(r.Context(), id, title, docDate)
	if err != nil {
		if renderObjectDocumentErr(w, err) {
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to update construction object document")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: m})
}

// Delete handles DELETE /api/v1/construction-object-documents/{docId}.
func (h *ConstructionObjectDocumentsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, ok := objectDocumentID(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), id); err != nil {
		if renderObjectDocumentErr(w, err) {
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to delete construction object document")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// File handles GET /api/v1/construction-object-documents/{docId}/file?disposition=inline|attachment.
func (h *ConstructionObjectDocumentsHandler) File(w http.ResponseWriter, r *http.Request) {
	id, ok := objectDocumentID(w, r)
	if !ok {
		return
	}
	disposition := r.URL.Query().Get("disposition")
	switch disposition {
	case "":
		disposition = "inline"
	case "inline", "attachment":
	default:
		apierr.BadRequest("disposition must be 'inline' or 'attachment'").Render(w)
		return
	}
	f, err := h.svc.File(r.Context(), id)
	if err != nil {
		if renderObjectDocumentErr(w, err) {
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to read construction object document")
		return
	}
	// Байты документа неизменны, поэтому ETag — идентификатор.
	etag := `"` + id + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", f.Mime)
	w.Header().Set("Content-Length", strconv.Itoa(len(f.Data)))
	w.Header().Set("Content-Disposition", contentDispositionHeader(disposition, f.FileName))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(f.Data)
}
