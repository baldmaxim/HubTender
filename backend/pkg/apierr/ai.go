package apierr

import "net/http"

// Этап 2.5: стабильные RFC7807-коды OpenRouter/AI-администрирования (§20).
// В ответы НИКОГДА не попадают: raw provider body, API key, полный upstream
// URL, stack, внутренние metadata провайдера.

// aiProblem — единый конструктор с machine-readable code.
func aiProblem(status int, title, detail, code string) *ProblemExtra {
	return &ProblemExtra{
		Problem: Problem{
			Type:   problemTypeURI(status),
			Title:  title,
			Status: status,
			Detail: detail,
		},
		Extras: map[string]any{"code": code},
	}
}

// AIProviderNotConfigured — OPENROUTER_API_KEY не задан либо подключение не
// подтверждено. Приложение и ручной Smart Import продолжают работать.
func AIProviderNotConfigured() *ProblemExtra {
	return aiProblem(http.StatusConflict, "Conflict",
		"OpenRouter не настроен: задайте server secret OPENROUTER_API_KEY и проверьте подключение.",
		"AI_PROVIDER_NOT_CONFIGURED")
}

// AICatalogUnavailable — каталог моделей недоступен и кэша нет.
func AICatalogUnavailable() *ProblemExtra {
	return aiProblem(http.StatusServiceUnavailable, "Service Unavailable",
		"Каталог моделей OpenRouter временно недоступен. Попробуйте обновить позже.",
		"AI_CATALOG_UNAVAILABLE")
}

// AIModelNotAvailable — model ID отсутствует в user-filtered каталоге
// (произвольный ввод/router/истёкшая модель отклоняются одинаково).
func AIModelNotAvailable() *ProblemExtra {
	return aiProblem(http.StatusBadRequest, "Bad Request",
		"Модель недоступна в каталоге OpenRouter для текущего ключа. Выберите модель из каталога.",
		"AI_MODEL_NOT_AVAILABLE")
}

// AIModelNotSelected — draft-модель ещё не выбрана.
func AIModelNotSelected() *ProblemExtra {
	return aiProblem(http.StatusConflict, "Conflict",
		"Модель не выбрана. Сначала выберите модель из каталога и сохраните черновик.",
		"AI_MODEL_NOT_SELECTED")
}

// AIModelExpired — срок действия выбранной модели истёк.
func AIModelExpired() *ProblemExtra {
	return aiProblem(http.StatusConflict, "Conflict",
		"Срок действия выбранной модели истёк. Выберите другую модель из каталога.",
		"AI_MODEL_EXPIRED")
}

// AIModelTestRequired — активация без актуального PASS невозможна.
func AIModelTestRequired() *ProblemExtra {
	return aiProblem(http.StatusConflict, "Conflict",
		"Перед активацией необходимо успешно пройти проверку модели.",
		"AI_MODEL_TEST_REQUIRED")
}

// AIModelTestFailed — последний тест модели провален.
func AIModelTestFailed() *ProblemExtra {
	return aiProblem(http.StatusConflict, "Conflict",
		"Проверка модели завершилась неудачно. Выберите другую модель или повторите тест.",
		"AI_MODEL_TEST_FAILED")
}

// AIModelConfigChanged — конфигурация изменилась после теста (stale PASS).
func AIModelConfigChanged() *ProblemExtra {
	return aiProblem(http.StatusConflict, "Conflict",
		"Конфигурация изменилась после последней проверки модели. Повторите проверку.",
		"AI_MODEL_CONFIG_CHANGED")
}

// AIActivationNotAllowed — прочие непройденные гейты активации.
func AIActivationNotAllowed(detail string) *ProblemExtra {
	if detail == "" {
		detail = "Активация конфигурации сейчас невозможна."
	}
	return aiProblem(http.StatusConflict, "Conflict", detail, "AI_MODEL_ACTIVATION_NOT_ALLOWED")
}

// AIProviderError — безопасная оболочка ошибок OpenRouter (§20): наружу
// уходит только стабильный safe-код (unauthorized/payment_required/…).
func AIProviderError(safeCode string) *ProblemExtra {
	detail := "Запрос к OpenRouter не выполнен."
	switch safeCode {
	case "unauthorized":
		detail = "OpenRouter отклонил API key (unauthorized). Проверьте ключ."
	case "payment_required":
		detail = "Недостаточно кредитов OpenRouter (payment required)."
	case "rate_limited":
		detail = "OpenRouter ограничил частоту запросов (rate limited). Повторите позже."
	case "invalid_response":
		detail = "OpenRouter вернул некорректный ответ."
	}
	return &ProblemExtra{
		Problem: Problem{
			Type:   problemTypeURI(http.StatusBadGateway),
			Title:  "Bad Gateway",
			Status: http.StatusBadGateway,
			Detail: detail,
		},
		Extras: map[string]any{"code": "AI_OPENROUTER_" + upperSnake(safeCode)},
	}
}

func upperSnake(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if r >= 'a' && r <= 'z' {
			r -= 32
		}
		out = append(out, r)
	}
	return string(out)
}
