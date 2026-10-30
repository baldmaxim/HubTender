package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/su10/hubtender/backend/internal/access"
)

// Права на запись пилота «аналог». Те же правила, что применяет фронт к правке
// состава позиции (hasPageAccess и checkTenderDeadline), но на сервере: без
// проверки пользователь с прямым вызовом API обходил бы и доступ к странице
// позиций, и дедлайн тендера.

const (
	analogPositionsPage = "/positions"

	analogMsgForbidden = "Нет доступа к странице позиций — обратитесь к администратору"
	analogMsgDeadline  = "Дедлайн тендера истёк — правка состава недоступна. Продление выдаёт администратор"
)

// analogAccessFacts — всё, что нужно для решения о праве записи.
type analogAccessFacts struct {
	RoleCode         string
	AllowedPagesJSON []byte
	// Дедлайн тендера и персональное продление пользователя (nil — не задан).
	Deadline  *time.Time
	Extension *time.Time
	// Время БД на момент проверки.
	Now time.Time
}

// analogPageBypassRoles — роли, которым фронт открывает все страницы без
// allowed_pages (canManageUsers: Администратор, Руководитель, Разработчик).
var analogPageBypassRoles = map[string]bool{
	"administrator": true,
	"director":      true,
	"developer":     true,
}

// decideAnalogEditAccess — чистое решение: "" — можно, иначе код ошибки.
// Порядок как на фронте: сначала доступ к странице, затем дедлайн.
func decideAnalogEditAccess(f analogAccessFacts) string {
	if !analogPageBypassRoles[f.RoleCode] &&
		!access.HasAccess(access.GetAllowedPages(f.RoleCode, f.AllowedPagesJSON), analogPositionsPage) {
		return AnalogCodeForbidden
	}
	if access.FullAccessRoles[f.RoleCode] {
		return ""
	}
	effective := f.Deadline
	// Персональный срок — только продление: раньше общего дедлайна он не блокирует.
	if f.Deadline != nil && f.Extension != nil && f.Extension.After(*f.Deadline) {
		effective = f.Extension
	}
	if effective == nil || !f.Now.After(*effective) {
		return ""
	}
	return AnalogCodeDeadlinePassed
}

// parseAnalogExtension разбирает extended_deadline (ISO-строка с фронта);
// нечитаемое значение игнорируется — как Invalid Date на фронте.
func parseAnalogExtension(raw *string) *time.Time {
	if raw == nil || *raw == "" {
		return nil
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05", "2006-01-02T15:04", "2006-01-02"} {
		if t, err := time.Parse(layout, *raw); err == nil {
			return &t
		}
	}
	return nil
}

// checkAnalogEditAccess читает роль, страницы, продление и дедлайн одним
// запросом (время сравнения — now() БД) и отказывает ошибкой аналога.
// Вызывать в транзакции до любой записи.
func checkAnalogEditAccess(ctx context.Context, q analogQuerier, userID, tenderID string) error {
	var f analogAccessFacts
	var ext *string
	err := q.QueryRow(ctx, `
		SELECT u.role_code, u.allowed_pages, t.submission_deadline,
		       (SELECT e->>'extended_deadline'
		          FROM jsonb_array_elements(COALESCE(u.tender_deadline_extensions, '[]'::jsonb)) e
		         WHERE e->>'tender_id' = $2::text
		         LIMIT 1),
		       now()
		FROM public.users u
		LEFT JOIN public.tenders t ON t.id = $2::uuid
		WHERE u.id = $1::uuid`, userID, tenderID).
		Scan(&f.RoleCode, &f.AllowedPagesJSON, &f.Deadline, &ext, &f.Now)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return analogErr(AnalogCodeForbidden, analogMsgForbidden, nil)
		}
		return fmt.Errorf("analog.access: %w", err)
	}
	f.Extension = parseAnalogExtension(ext)
	switch decideAnalogEditAccess(f) {
	case AnalogCodeForbidden:
		return analogErr(AnalogCodeForbidden, analogMsgForbidden, nil)
	case AnalogCodeDeadlinePassed:
		return analogErr(AnalogCodeDeadlinePassed, analogMsgDeadline, nil)
	}
	return nil
}
