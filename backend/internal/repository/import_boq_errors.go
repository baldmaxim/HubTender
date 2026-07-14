package repository

import (
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"
)

// boqInsertError превращает ошибку INSERT boq_item в сообщение с номером строки
// Excel. Ошибки данных/ограничений (классы SQLSTATE 22/23) → ErrBulkImport (400)
// с человекочитаемой причиной — она доедет до пользователя в RFC 7807 `detail`.
// Прочие ошибки (соединение, отмена контекста) → обёрнутая ошибка (500), но
// номер строки/позиция теперь видны в логах и Sentry.
func boqInsertError(err error, rowLabel, positionID string) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && len(pgErr.Code) >= 2 {
		switch pgErr.Code[:2] {
		case "22", "23": // data exception / integrity constraint violation
			return &ErrBulkImport{
				Message: fmt.Sprintf("Строка %s: %s", rowLabel, boqConstraintReason(pgErr)),
			}
		}
	}
	return fmt.Errorf("importRepo.BulkImport: insert boq_item (row %s, position %s): %w",
		rowLabel, positionID, err)
}

// boqConstraintReason формирует понятную причину из pg-ошибки: сначала по имени
// constraint'а boq_items, затем по коду SQLSTATE; при наличии добавляет
// pgErr.Detail (там Postgres указывает конкретный ключ/значение).
func boqConstraintReason(pgErr *pgconn.PgError) string {
	var reason string
	switch pgErr.ConstraintName {
	case "boq_items_quantity_positive":
		reason = "количество должно быть больше нуля"
	case "boq_items_base_quantity_positive":
		reason = "базовое количество должно быть больше нуля"
	case "boq_items_consumption_coefficient_positive":
		reason = "коэффициент расхода должен быть больше нуля"
	case "boq_items_conversion_coefficient_positive":
		reason = "коэффициент перевода должен быть больше нуля"
	case "boq_items_material_check":
		reason = "тип элемента не соответствует заполненным полям (работа/материал)"
	case "boq_items_parent_work_check":
		reason = "у работы не может быть привязки к родительской работе"
	case "boq_items_delivery_amount_check":
		reason = "для типа доставки «суммой» нужна стоимость доставки"
	case "boq_items_client_position_id_fkey":
		reason = "позиция заказчика не найдена"
	case "boq_items_material_name_id_fkey":
		reason = "материал не найден в номенклатуре"
	case "boq_items_work_name_id_fkey":
		reason = "работа не найдена в номенклатуре"
	case "boq_items_unit_code_fkey":
		reason = "единица измерения не найдена в справочнике"
	case "boq_items_detail_cost_category_id_fkey":
		reason = "затрата на строительство не найдена"
	case "boq_items_tender_id_fkey":
		reason = "тендер не найден"
	case "boq_items_parent_work_item_id_fkey":
		reason = "родительская работа не найдена"
	default:
		switch pgErr.Code {
		case "23502": // not_null_violation
			reason = fmt.Sprintf("не заполнено обязательное поле «%s»", pgErr.ColumnName)
		case "23503": // foreign_key_violation
			reason = "ссылка на несуществующую запись (внешний ключ)"
		case "23505": // unique_violation
			reason = "запись с такими данными уже существует"
		case "23514": // check_violation
			reason = "значение не прошло проверку ограничений БД"
		case "22P02": // invalid_text_representation (кривой enum/uuid)
			reason = "недопустимое значение (тип элемента, валюта или идентификатор)"
		case "22003": // numeric_value_out_of_range
			reason = "числовое значение вне допустимого диапазона"
		default:
			reason = pgErr.Message
		}
	}
	if pgErr.Detail != "" {
		reason += " (" + pgErr.Detail + ")"
	}
	return reason
}
