package apierr

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

// ProblemFromPgErr maps well-known SQLSTATE codes to client-safe Problems so
// handlers can surface expected constraint violations (409/400 with a Russian
// detail) instead of a generic 500 + Sentry capture via InternalFromErr.
//
// overrides maps a constraint name to a domain-specific detail message —
// constraint names are domain knowledge, so they live at the call site, not
// here. Returns nil when err is not a recognised pg error: the caller must
// then fall back to InternalFromErr.
func ProblemFromPgErr(err error, overrides map[string]string) *Problem {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return nil
	}
	detail, ok := overrides[pgErr.ConstraintName]
	switch pgErr.Code {
	case "23505": // unique_violation
		if !ok {
			detail = "Запись с такими данными уже существует"
		}
		return Conflict(withPgDetail(detail, pgErr))
	case "23503": // foreign_key_violation
		if !ok {
			detail = "Операция невозможна: запись связана с другими данными"
		}
		return Conflict(withPgDetail(detail, pgErr))
	case "23514": // check_violation
		if !ok {
			detail = "Данные не прошли проверку ограничений базы данных"
		}
		return BadRequest(withPgDetail(detail, pgErr))
	case "23502": // not_null_violation
		if !ok {
			detail = "Не заполнено обязательное поле"
			if pgErr.ColumnName != "" {
				detail += " «" + pgErr.ColumnName + "»"
			}
		}
		return BadRequest(withPgDetail(detail, pgErr))
	case "22P02": // invalid_text_representation (кривой enum/uuid/число)
		if !ok {
			detail = "Недопустимое значение поля (тип, валюта или идентификатор)"
		}
		return BadRequest(withPgDetail(detail, pgErr))
	case "22003": // numeric_value_out_of_range
		if !ok {
			detail = "Числовое значение вне допустимого диапазона"
		}
		return BadRequest(withPgDetail(detail, pgErr))
	}
	return nil
}

// withPgDetail добавляет к сообщению pgErr.Detail (Postgres кладёт туда
// конкретный ключ/значение), если он непустой и не дублирует override.
func withPgDetail(detail string, pgErr *pgconn.PgError) string {
	if pgErr.Detail != "" {
		return detail + " (" + pgErr.Detail + ")"
	}
	return detail
}
