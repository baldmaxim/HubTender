package repository

import (
	"errors"
	"fmt"
)

// importQuotePriceDate проверяет дату цены строки импорта по правилам
// одиночного создания (validateQuoteDates) и отдаёт значение для INSERT.
func importQuotePriceDate(item ImportBoqItem, rowLabel string) (any, error) {
	if item.QuotePriceDate == nil {
		return nil, nil
	}
	if err := validateQuoteDates(item.QuotePriceDate, nil, &BoqItemRow{}); err != nil {
		var qe *InvalidQuoteDatesError
		if errors.As(err, &qe) {
			return nil, &ErrBulkImport{Message: fmt.Sprintf("Строка %s: %s", rowLabel, qe.Reason)}
		}
		return nil, err
	}
	return nullIfEmptyDate(*item.QuotePriceDate), nil
}
