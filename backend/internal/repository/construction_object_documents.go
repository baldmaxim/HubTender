package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MaxConstructionObjectDocuments — предел числа документов на один объект.
const MaxConstructionObjectDocuments = 50

var (
	// ErrConstructionObjectDocumentNotFound — документа с таким id нет.
	ErrConstructionObjectDocumentNotFound = errors.New("construction object document not found")
	// ErrConstructionObjectDocumentLimit — у объекта уже MaxConstructionObjectDocuments документов.
	ErrConstructionObjectDocumentLimit = errors.New("construction object document limit reached")
)

// ConstructionObjectDocumentsRepo — документы объектов (public.construction_object_documents).
type ConstructionObjectDocumentsRepo struct {
	pool *pgxpool.Pool
}

// NewConstructionObjectDocumentsRepo creates a ConstructionObjectDocumentsRepo.
func NewConstructionObjectDocumentsRepo(pool *pgxpool.Pool) *ConstructionObjectDocumentsRepo {
	return &ConstructionObjectDocumentsRepo{pool: pool}
}

// ConstructionObjectDocumentMeta — метаданные документа в ответе API (без байтов).
type ConstructionObjectDocumentMeta struct {
	ID        string    `json:"id"`
	ObjectID  string    `json:"object_id"`
	FileName  string    `json:"file_name"`
	Mime      string    `json:"mime"`
	SizeBytes int       `json:"size_bytes"`
	Title     *string   `json:"title"`
	DocDate   *string   `json:"doc_date"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
}

// ConstructionObjectDocumentInput — уже проверенные данные загруженного документа.
type ConstructionObjectDocumentInput struct {
	FileName string
	Mime     string
	Content  []byte
	Title    *string
	DocDate  *string // YYYY-MM-DD
}

// ConstructionObjectDocumentFile — байты документа для отдачи клиенту.
type ConstructionObjectDocumentFile struct {
	FileName string
	Mime     string
	Data     []byte
}

const constructionObjectDocumentCols = `id::text, object_id::text, file_name, mime, size_bytes, title,
	to_char(doc_date, 'YYYY-MM-DD'), sort_order, created_at`

func scanConstructionObjectDocument(row pgx.Row) (*ConstructionObjectDocumentMeta, error) {
	var m ConstructionObjectDocumentMeta
	if err := row.Scan(&m.ID, &m.ObjectID, &m.FileName, &m.Mime, &m.SizeBytes, &m.Title, &m.DocDate, &m.SortOrder, &m.CreatedAt); err != nil {
		return nil, err
	}
	return &m, nil
}

// List возвращает метаданные документов объекта; нет объекта — ErrConstructionObjectNotFound.
func (r *ConstructionObjectDocumentsRepo) List(ctx context.Context, objectID string) ([]ConstructionObjectDocumentMeta, error) {
	var exists bool
	if err := r.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM public.construction_objects WHERE id = $1::uuid)`, objectID,
	).Scan(&exists); err != nil {
		return nil, fmt.Errorf("constructionObjectDocumentsRepo.List exists: %w", err)
	}
	if !exists {
		return nil, ErrConstructionObjectNotFound
	}
	rows, err := r.pool.Query(ctx, `
		SELECT `+constructionObjectDocumentCols+`
		FROM public.construction_object_documents
		WHERE object_id = $1::uuid
		ORDER BY sort_order, created_at
	`, objectID)
	if err != nil {
		return nil, fmt.Errorf("constructionObjectDocumentsRepo.List: %w", err)
	}
	defer rows.Close()
	out := make([]ConstructionObjectDocumentMeta, 0)
	for rows.Next() {
		m, err := scanConstructionObjectDocument(rows)
		if err != nil {
			return nil, fmt.Errorf("constructionObjectDocumentsRepo.List scan: %w", err)
		}
		out = append(out, *m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("constructionObjectDocumentsRepo.List rows: %w", err)
	}
	return out, nil
}

// Create добавляет документ в конец (sort_order = max + 1). Строка объекта
// блокируется на время транзакции, чтобы параллельные загрузки не обошли лимит
// и не получили один sort_order. Нет объекта — ErrConstructionObjectNotFound,
// лимит — ErrConstructionObjectDocumentLimit.
func (r *ConstructionObjectDocumentsRepo) Create(ctx context.Context, objectID string, in ConstructionObjectDocumentInput, createdBy *string) (*ConstructionObjectDocumentMeta, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("constructionObjectDocumentsRepo.Create begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var lockedID string
	if err := tx.QueryRow(ctx,
		`SELECT id::text FROM public.construction_objects WHERE id = $1::uuid FOR UPDATE`, objectID,
	).Scan(&lockedID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrConstructionObjectNotFound
		}
		return nil, fmt.Errorf("constructionObjectDocumentsRepo.Create lock: %w", err)
	}

	var count, maxOrder int
	if err := tx.QueryRow(ctx, `
		SELECT count(*)::int, COALESCE(MAX(sort_order), 0)
		FROM public.construction_object_documents WHERE object_id = $1::uuid
	`, objectID).Scan(&count, &maxOrder); err != nil {
		return nil, fmt.Errorf("constructionObjectDocumentsRepo.Create count: %w", err)
	}
	if count >= MaxConstructionObjectDocuments {
		return nil, ErrConstructionObjectDocumentLimit
	}

	m, err := scanConstructionObjectDocument(tx.QueryRow(ctx, `
		INSERT INTO public.construction_object_documents (
			object_id, file_name, mime, content, size_bytes, title, doc_date, sort_order, created_by
		) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::date, $8, $9::uuid)
		RETURNING `+constructionObjectDocumentCols,
		objectID, in.FileName, in.Mime, in.Content, len(in.Content), in.Title, in.DocDate, maxOrder+1, createdBy,
	))
	if err != nil {
		return nil, fmt.Errorf("constructionObjectDocumentsRepo.Create insert: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("constructionObjectDocumentsRepo.Create commit: %w", err)
	}
	return m, nil
}

// UpdateMeta заменяет название и дату (nil — убрать); нет документа — ErrConstructionObjectDocumentNotFound.
func (r *ConstructionObjectDocumentsRepo) UpdateMeta(ctx context.Context, docID string, title, docDate *string) (*ConstructionObjectDocumentMeta, error) {
	m, err := scanConstructionObjectDocument(r.pool.QueryRow(ctx, `
		UPDATE public.construction_object_documents SET title = $2, doc_date = $3::date
		WHERE id = $1::uuid
		RETURNING `+constructionObjectDocumentCols, docID, title, docDate))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrConstructionObjectDocumentNotFound
		}
		return nil, fmt.Errorf("constructionObjectDocumentsRepo.UpdateMeta: %w", err)
	}
	return m, nil
}

// Delete удаляет документ; нет строки — ErrConstructionObjectDocumentNotFound.
func (r *ConstructionObjectDocumentsRepo) Delete(ctx context.Context, docID string) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM public.construction_object_documents WHERE id = $1::uuid`, docID)
	if err != nil {
		return fmt.Errorf("constructionObjectDocumentsRepo.Delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrConstructionObjectDocumentNotFound
	}
	return nil
}

// File читает байты документа вместе с именем и типом.
func (r *ConstructionObjectDocumentsRepo) File(ctx context.Context, docID string) (*ConstructionObjectDocumentFile, error) {
	var f ConstructionObjectDocumentFile
	if err := r.pool.QueryRow(ctx,
		`SELECT file_name, mime, content FROM public.construction_object_documents WHERE id = $1::uuid`, docID,
	).Scan(&f.FileName, &f.Mime, &f.Data); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrConstructionObjectDocumentNotFound
		}
		return nil, fmt.Errorf("constructionObjectDocumentsRepo.File: %w", err)
	}
	return &f, nil
}
