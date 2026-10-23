package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// Лимиты загрузки фото объекта. Браузер сжимает фото до отправки; тело запроса
// ограничено с запасом на multipart-обёртку и текстовые поля.
const (
	maxObjectPhotoFileBytes  = 1536 << 10 // 1,5 МБ — полное фото
	maxObjectPhotoThumbBytes = 200 << 10  // 200 КБ — миниатюра
	maxObjectPhotoBodyBytes  = 2 << 20    // 2 МБ — всё тело запроса
	maxObjectPhotoDimension  = 10000
	maxObjectPhotoCaptionLen = 500
)

// constructionObjectPhotosServicer is the interface ConstructionObjectPhotosHandler depends on.
type constructionObjectPhotosServicer interface {
	List(ctx context.Context, objectID string) ([]repository.ConstructionObjectPhotoMeta, error)
	Create(ctx context.Context, objectID string, in repository.ConstructionObjectPhotoInput, createdBy *string) (*repository.ConstructionObjectPhotoMeta, error)
	UpdateCaption(ctx context.Context, photoID string, caption *string) (*repository.ConstructionObjectPhotoMeta, error)
	Delete(ctx context.Context, photoID string) error
	Image(ctx context.Context, photoID string, thumb bool) (*repository.ConstructionObjectPhotoImage, error)
}

// ConstructionObjectPhotosHandler serves фото объектов строительства.
type ConstructionObjectPhotosHandler struct {
	svc constructionObjectPhotosServicer
}

// NewConstructionObjectPhotosHandler creates a ConstructionObjectPhotosHandler.
func NewConstructionObjectPhotosHandler(svc constructionObjectPhotosServicer) *ConstructionObjectPhotosHandler {
	return &ConstructionObjectPhotosHandler{svc: svc}
}

// objectPhotoMime определяет тип по байтам (не по заголовку клиента); пусто — не поддерживается.
func objectPhotoMime(data []byte) string {
	switch m := http.DetectContentType(data); m {
	case "image/jpeg", "image/png", "image/webp":
		return m
	}
	return ""
}

// readObjectPhotoPart читает файловую часть multipart с жёстким пределом размера.
func readObjectPhotoPart(r *http.Request, field string, limit int) ([]byte, *apierr.Problem) {
	file, _, err := r.FormFile(field)
	if err != nil {
		return nil, apierr.BadRequest("поле " + field + " обязательно")
	}
	defer file.Close() //nolint:errcheck
	data, err := io.ReadAll(io.LimitReader(file, int64(limit)+1))
	if err != nil {
		return nil, apierr.BadRequest("не удалось прочитать поле " + field)
	}
	if len(data) == 0 {
		return nil, apierr.BadRequest("поле " + field + " пустое")
	}
	if len(data) > limit {
		return nil, apierr.New(http.StatusRequestEntityTooLarge, "Payload Too Large", "поле "+field+" превышает допустимый размер")
	}
	if objectPhotoMime(data) == "" {
		return nil, apierr.BadRequest("поле " + field + ": допустимы только JPEG, WebP и PNG")
	}
	return data, nil
}

func parseObjectPhotoDimension(r *http.Request, field string) (int, *apierr.Problem) {
	v, err := strconv.Atoi(strings.TrimSpace(r.FormValue(field)))
	if err != nil || v < 1 || v > maxObjectPhotoDimension {
		return 0, apierr.BadRequest(field + " must be an integer within [1, " + strconv.Itoa(maxObjectPhotoDimension) + "]")
	}
	return v, nil
}

// parseObjectPhotoUpload разбирает и проверяет multipart-запрос загрузки фото.
// Проблема уже готова к ответу клиенту.
func parseObjectPhotoUpload(w http.ResponseWriter, r *http.Request) (repository.ConstructionObjectPhotoInput, *apierr.Problem) {
	var in repository.ConstructionObjectPhotoInput

	r.Body = http.MaxBytesReader(w, r.Body, maxObjectPhotoBodyBytes)
	// Память с запасом на всё тело: ничего не пишется во временные файлы.
	if err := r.ParseMultipartForm(maxObjectPhotoBodyBytes + 1<<20); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			return in, apierr.New(http.StatusRequestEntityTooLarge, "Payload Too Large", "тело запроса превышает 2 МБ")
		}
		return in, apierr.BadRequest("не удалось разобрать multipart-запрос")
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll() //nolint:errcheck
	}

	content, prob := readObjectPhotoPart(r, "file", maxObjectPhotoFileBytes)
	if prob != nil {
		return in, prob
	}
	thumb, prob := readObjectPhotoPart(r, "thumb", maxObjectPhotoThumbBytes)
	if prob != nil {
		return in, prob
	}
	width, prob := parseObjectPhotoDimension(r, "width")
	if prob != nil {
		return in, prob
	}
	height, prob := parseObjectPhotoDimension(r, "height")
	if prob != nil {
		return in, prob
	}
	caption, prob := normalizeObjectPhotoCaption(r.FormValue("caption"))
	if prob != nil {
		return in, prob
	}

	in = repository.ConstructionObjectPhotoInput{
		Mime: objectPhotoMime(content), Content: content,
		ThumbMime: objectPhotoMime(thumb), Thumb: thumb,
		Width: width, Height: height, Caption: caption,
	}
	return in, nil
}

// normalizeObjectPhotoCaption обрезает пробелы; пустая подпись — nil.
func normalizeObjectPhotoCaption(raw string) (*string, *apierr.Problem) {
	c := strings.TrimSpace(raw)
	if c == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(c) > maxObjectPhotoCaptionLen {
		return nil, apierr.BadRequest("caption must be at most " + strconv.Itoa(maxObjectPhotoCaptionLen) + " characters")
	}
	return &c, nil
}

// objectPhotoID достаёт и проверяет {photoId}; битый id отвечает 404.
func objectPhotoID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := chi.URLParam(r, "photoId")
	if !constructionObjectUUIDRe.MatchString(id) {
		apierr.NotFound("construction object photo not found").Render(w)
		return "", false
	}
	return id, true
}

// renderObjectPhotoErr отвечает на ожидаемые ошибки фото; false — ошибка неизвестна.
func renderObjectPhotoErr(w http.ResponseWriter, err error) bool {
	switch {
	case errors.Is(err, repository.ErrConstructionObjectNotFound):
		apierr.NotFound("construction object not found").Render(w)
	case errors.Is(err, repository.ErrConstructionObjectPhotoNotFound):
		apierr.NotFound("construction object photo not found").Render(w)
	case errors.Is(err, repository.ErrConstructionObjectPhotoLimit):
		apierr.BadRequest("у объекта не может быть больше " + strconv.Itoa(repository.MaxConstructionObjectPhotos) + " фото").Render(w)
	default:
		return false
	}
	return true
}

// List handles GET /api/v1/construction-objects/{id}/photos.
func (h *ConstructionObjectPhotosHandler) List(w http.ResponseWriter, r *http.Request) {
	id, ok := constructionObjectID(w, r)
	if !ok {
		return
	}
	rows, err := h.svc.List(r.Context(), id)
	if err != nil {
		if renderObjectPhotoErr(w, err) {
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to list construction object photos")
		return
	}
	if rows == nil {
		rows = []repository.ConstructionObjectPhotoMeta{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// Create handles POST /api/v1/construction-objects/{id}/photos (multipart/form-data).
func (h *ConstructionObjectPhotosHandler) Create(w http.ResponseWriter, r *http.Request) {
	id, ok := constructionObjectID(w, r)
	if !ok {
		return
	}
	in, prob := parseObjectPhotoUpload(w, r)
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
		if renderObjectPhotoErr(w, err) {
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to create construction object photo")
		return
	}
	renderJSON(w, r, http.StatusCreated, dataEnvelope{Data: m})
}

// UpdateCaption handles PATCH /api/v1/construction-object-photos/{photoId}.
func (h *ConstructionObjectPhotosHandler) UpdateCaption(w http.ResponseWriter, r *http.Request) {
	id, ok := objectPhotoID(w, r)
	if !ok {
		return
	}
	var req struct {
		Caption *string `json:"caption"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	var caption *string
	if req.Caption != nil {
		c, prob := normalizeObjectPhotoCaption(*req.Caption)
		if prob != nil {
			prob.Render(w)
			return
		}
		caption = c
	}
	m, err := h.svc.UpdateCaption(r.Context(), id, caption)
	if err != nil {
		if renderObjectPhotoErr(w, err) {
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to update construction object photo")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: m})
}

// Delete handles DELETE /api/v1/construction-object-photos/{photoId}.
func (h *ConstructionObjectPhotosHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, ok := objectPhotoID(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), id); err != nil {
		if renderObjectPhotoErr(w, err) {
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to delete construction object photo")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Image handles GET /api/v1/construction-object-photos/{photoId}/image?size=thumb|full.
func (h *ConstructionObjectPhotosHandler) Image(w http.ResponseWriter, r *http.Request) {
	id, ok := objectPhotoID(w, r)
	if !ok {
		return
	}
	var thumb bool
	switch r.URL.Query().Get("size") {
	case "", "full":
	case "thumb":
		thumb = true
	default:
		apierr.BadRequest("size must be 'thumb' or 'full'").Render(w)
		return
	}
	img, err := h.svc.Image(r.Context(), id, thumb)
	if err != nil {
		if renderObjectPhotoErr(w, err) {
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to read construction object photo")
		return
	}
	// Байты фото неизменны, поэтому ETag — идентификатор (миниатюра отличается суффиксом).
	etag := `"` + id + `"`
	if thumb {
		etag = `"` + id + `-thumb"`
	}
	h.writeImage(w, r, img, etag)
}

func (h *ConstructionObjectPhotosHandler) writeImage(w http.ResponseWriter, r *http.Request, img *repository.ConstructionObjectPhotoImage, etag string) {
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", img.Mime)
	w.Header().Set("Content-Length", strconv.Itoa(len(img.Data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(img.Data)
}
