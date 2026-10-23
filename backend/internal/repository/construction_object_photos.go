package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MaxConstructionObjectPhotos — предел числа фото на один объект.
const MaxConstructionObjectPhotos = 30

var (
	// ErrConstructionObjectPhotoNotFound — фото с таким id нет.
	ErrConstructionObjectPhotoNotFound = errors.New("construction object photo not found")
	// ErrConstructionObjectPhotoLimit — у объекта уже MaxConstructionObjectPhotos фото.
	ErrConstructionObjectPhotoLimit = errors.New("construction object photo limit reached")
)

// ConstructionObjectPhotosRepo — фото объектов (public.construction_object_photos).
type ConstructionObjectPhotosRepo struct {
	pool *pgxpool.Pool
}

// NewConstructionObjectPhotosRepo creates a ConstructionObjectPhotosRepo.
func NewConstructionObjectPhotosRepo(pool *pgxpool.Pool) *ConstructionObjectPhotosRepo {
	return &ConstructionObjectPhotosRepo{pool: pool}
}

// ConstructionObjectPhotoMeta — метаданные фото в ответе API (без байтов).
type ConstructionObjectPhotoMeta struct {
	ID        string    `json:"id"`
	ObjectID  string    `json:"object_id"`
	Caption   *string   `json:"caption"`
	Width     int       `json:"width"`
	Height    int       `json:"height"`
	SizeBytes int       `json:"size_bytes"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
}

// ConstructionObjectPhotoInput — уже проверенные данные загруженного фото.
type ConstructionObjectPhotoInput struct {
	Mime      string
	Content   []byte
	ThumbMime string
	Thumb     []byte
	Width     int
	Height    int
	Caption   *string
}

// ConstructionObjectPhotoImage — байты одного изображения для отдачи клиенту.
type ConstructionObjectPhotoImage struct {
	Mime string
	Data []byte
}

const constructionObjectPhotoCols = `id::text, object_id::text, caption, width, height, size_bytes, sort_order, created_at`

func scanConstructionObjectPhoto(row pgx.Row) (*ConstructionObjectPhotoMeta, error) {
	var m ConstructionObjectPhotoMeta
	if err := row.Scan(&m.ID, &m.ObjectID, &m.Caption, &m.Width, &m.Height, &m.SizeBytes, &m.SortOrder, &m.CreatedAt); err != nil {
		return nil, err
	}
	return &m, nil
}

// List возвращает метаданные фото объекта; нет объекта — ErrConstructionObjectNotFound.
func (r *ConstructionObjectPhotosRepo) List(ctx context.Context, objectID string) ([]ConstructionObjectPhotoMeta, error) {
	var exists bool
	if err := r.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM public.construction_objects WHERE id = $1::uuid)`, objectID,
	).Scan(&exists); err != nil {
		return nil, fmt.Errorf("constructionObjectPhotosRepo.List exists: %w", err)
	}
	if !exists {
		return nil, ErrConstructionObjectNotFound
	}
	rows, err := r.pool.Query(ctx, `
		SELECT `+constructionObjectPhotoCols+`
		FROM public.construction_object_photos
		WHERE object_id = $1::uuid
		ORDER BY sort_order, created_at
	`, objectID)
	if err != nil {
		return nil, fmt.Errorf("constructionObjectPhotosRepo.List: %w", err)
	}
	defer rows.Close()
	out := make([]ConstructionObjectPhotoMeta, 0)
	for rows.Next() {
		m, err := scanConstructionObjectPhoto(rows)
		if err != nil {
			return nil, fmt.Errorf("constructionObjectPhotosRepo.List scan: %w", err)
		}
		out = append(out, *m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("constructionObjectPhotosRepo.List rows: %w", err)
	}
	return out, nil
}

// Create добавляет фото в конец (sort_order = max + 1). Строка объекта блокируется
// на время транзакции, чтобы параллельные загрузки не обошли лимит и не получили
// один sort_order. Нет объекта — ErrConstructionObjectNotFound, лимит —
// ErrConstructionObjectPhotoLimit.
func (r *ConstructionObjectPhotosRepo) Create(ctx context.Context, objectID string, in ConstructionObjectPhotoInput, createdBy *string) (*ConstructionObjectPhotoMeta, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("constructionObjectPhotosRepo.Create begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var lockedID string
	if err := tx.QueryRow(ctx,
		`SELECT id::text FROM public.construction_objects WHERE id = $1::uuid FOR UPDATE`, objectID,
	).Scan(&lockedID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrConstructionObjectNotFound
		}
		return nil, fmt.Errorf("constructionObjectPhotosRepo.Create lock: %w", err)
	}

	var count, maxOrder int
	if err := tx.QueryRow(ctx, `
		SELECT count(*)::int, COALESCE(MAX(sort_order), 0)
		FROM public.construction_object_photos WHERE object_id = $1::uuid
	`, objectID).Scan(&count, &maxOrder); err != nil {
		return nil, fmt.Errorf("constructionObjectPhotosRepo.Create count: %w", err)
	}
	if count >= MaxConstructionObjectPhotos {
		return nil, ErrConstructionObjectPhotoLimit
	}

	m, err := scanConstructionObjectPhoto(tx.QueryRow(ctx, `
		INSERT INTO public.construction_object_photos (
			object_id, mime, content, thumb_mime, thumb, width, height, size_bytes,
			caption, sort_order, created_by
		) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid)
		RETURNING `+constructionObjectPhotoCols,
		objectID, in.Mime, in.Content, in.ThumbMime, in.Thumb, in.Width, in.Height, len(in.Content),
		in.Caption, maxOrder+1, createdBy,
	))
	if err != nil {
		return nil, fmt.Errorf("constructionObjectPhotosRepo.Create insert: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("constructionObjectPhotosRepo.Create commit: %w", err)
	}
	return m, nil
}

// UpdateCaption заменяет подпись (nil — убрать); нет фото — ErrConstructionObjectPhotoNotFound.
func (r *ConstructionObjectPhotosRepo) UpdateCaption(ctx context.Context, photoID string, caption *string) (*ConstructionObjectPhotoMeta, error) {
	m, err := scanConstructionObjectPhoto(r.pool.QueryRow(ctx, `
		UPDATE public.construction_object_photos SET caption = $2
		WHERE id = $1::uuid
		RETURNING `+constructionObjectPhotoCols, photoID, caption))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrConstructionObjectPhotoNotFound
		}
		return nil, fmt.Errorf("constructionObjectPhotosRepo.UpdateCaption: %w", err)
	}
	return m, nil
}

// Delete удаляет фото; нет строки — ErrConstructionObjectPhotoNotFound.
func (r *ConstructionObjectPhotosRepo) Delete(ctx context.Context, photoID string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM public.construction_object_photos WHERE id = $1::uuid`, photoID)
	if err != nil {
		return fmt.Errorf("constructionObjectPhotosRepo.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrConstructionObjectPhotoNotFound
	}
	return nil
}

// Image читает байты полного изображения или миниатюры (thumb=true).
func (r *ConstructionObjectPhotosRepo) Image(ctx context.Context, photoID string, thumb bool) (*ConstructionObjectPhotoImage, error) {
	query := `SELECT mime, content FROM public.construction_object_photos WHERE id = $1::uuid`
	if thumb {
		query = `SELECT thumb_mime, thumb FROM public.construction_object_photos WHERE id = $1::uuid`
	}
	var img ConstructionObjectPhotoImage
	if err := r.pool.QueryRow(ctx, query, photoID).Scan(&img.Mime, &img.Data); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrConstructionObjectPhotoNotFound
		}
		return nil, fmt.Errorf("constructionObjectPhotosRepo.Image: %w", err)
	}
	return &img, nil
}
