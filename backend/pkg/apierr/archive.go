package apierr

import "net/http"

// Ошибки домена «архив смет» (/api/v1/archive/*). Каждая несёт машинный `code`
// в extension-члене, чтобы клиент разбирал ответ без парсинга текста.

// ArchiveProblem — общий конструктор проблемы архива с произвольными extras.
func ArchiveProblem(status int, code, detail string, extras map[string]any) *ProblemExtra {
	m := map[string]any{"code": code}
	for k, v := range extras {
		m[k] = v
	}
	return &ProblemExtra{
		Problem: Problem{
			Type:   problemTypeURI(status),
			Title:  http.StatusText(status),
			Status: status,
			Detail: detail,
		},
		Extras: m,
	}
}

// ArchiveTargetSpecInvalid — 400: цель группы задана неверно.
func ArchiveTargetSpecInvalid(groupTempID, reason string) *ProblemExtra {
	return ArchiveProblem(http.StatusBadRequest, "ARCHIVE_TARGET_SPEC_INVALID",
		"Некорректно задана целевая позиция группы.",
		map[string]any{"groupTempId": groupTempID, "reason": reason})
}

// ArchiveDuplicateTarget — 409: один temp_id или одна целевая позиция дважды.
func ArchiveDuplicateTarget(groupTempID, positionID string) *ProblemExtra {
	return ArchiveProblem(http.StatusConflict, "ARCHIVE_DUPLICATE_TARGET",
		"Одна и та же цель указана более одного раза.",
		map[string]any{"groupTempId": groupTempID, "positionId": positionID})
}

// ArchiveTargetPositionNotFound — 404: целевой позиции нет.
func ArchiveTargetPositionNotFound(positionID string) *ProblemExtra {
	return ArchiveProblem(http.StatusNotFound, "ARCHIVE_TARGET_POSITION_NOT_FOUND",
		"Целевая позиция не найдена.",
		map[string]any{"positionId": positionID})
}

// ArchiveTargetTenderMismatch — 409: целевая позиция из другого тендера.
func ArchiveTargetTenderMismatch(positionID, expected, actual string) *ProblemExtra {
	return ArchiveProblem(http.StatusConflict, "ARCHIVE_TARGET_TENDER_MISMATCH",
		"Целевая позиция принадлежит другому тендеру.",
		map[string]any{"positionId": positionID, "expectedTenderId": expected, "actualTenderId": actual})
}

// ArchiveSourceNotFound — 404: нет позиции-источника или её строки.
func ArchiveSourceNotFound(code, positionID, itemID string) *ProblemExtra {
	extras := map[string]any{"positionId": positionID}
	if itemID != "" {
		extras["itemId"] = itemID
	}
	return ArchiveProblem(http.StatusNotFound, code,
		"Историческая позиция-источник не найдена.", extras)
}

// ArchiveNothingToCompose — 400: копировать нечего.
func ArchiveNothingToCompose() *ProblemExtra {
	return ArchiveProblem(http.StatusBadRequest, "ARCHIVE_NOTHING_TO_COMPOSE",
		"Ни одной строки к переносу: проверьте источники и фильтры.", nil)
}

// ArchiveScaleInvalid — 400: некорректный коэффициент масштабирования.
func ArchiveScaleInvalid(code, groupTempID, reason string) *ProblemExtra {
	return ArchiveProblem(http.StatusBadRequest, code,
		"Некорректное масштабирование количеств.",
		map[string]any{"groupTempId": groupTempID, "reason": reason})
}

// ArchiveQuantityUnderflow — 400: после масштабирования количество стало нулевым.
func ArchiveQuantityUnderflow(groupTempID, sourceItemID string, factor float64) *ProblemExtra {
	return ArchiveProblem(http.StatusBadRequest, "ARCHIVE_QUANTITY_UNDERFLOW",
		"После масштабирования количество строки становится нулевым — запись отменена.",
		map[string]any{"groupTempId": groupTempID, "sourceItemId": sourceItemID, "factor": factor})
}

// ArchiveConcurrentModification — 409: пока шла сборка, тендер изменили.
func ArchiveConcurrentModification(tenderID string) *ProblemExtra {
	return ArchiveProblem(http.StatusConflict, "ARCHIVE_CONCURRENT_MODIFICATION",
		"Тендер изменён параллельно — сборка отменена целиком, повторите запрос.",
		map[string]any{"tenderId": tenderID})
}
