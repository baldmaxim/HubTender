package apierr

import (
	"encoding/json"
	"net/http"
)

// Problem implements RFC 7807 Problem Details for HTTP APIs.
type Problem struct {
	Type   string `json:"type"`
	Title  string `json:"title"`
	Status int    `json:"status"`
	Detail string `json:"detail,omitempty"`
}

// New constructs a Problem with a standard type URI.
func New(status int, title, detail string) *Problem {
	return &Problem{
		Type:   problemTypeURI(status),
		Title:  title,
		Status: status,
		Detail: detail,
	}
}

// Render writes the problem as JSON to the response writer with the correct
// Content-Type and HTTP status code.
func (p *Problem) Render(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(p.Status)
	_ = json.NewEncoder(w).Encode(p)
}

// Unauthorized returns a 401 Problem.
func Unauthorized(detail string) *Problem {
	return New(http.StatusUnauthorized, "Unauthorized", detail)
}

// Forbidden returns a 403 Problem.
func Forbidden(detail string) *Problem {
	return New(http.StatusForbidden, "Forbidden", detail)
}

// NotFound returns a 404 Problem.
func NotFound(detail string) *Problem {
	return New(http.StatusNotFound, "Not Found", detail)
}

// InternalError returns a 500 Problem.
func InternalError(detail string) *Problem {
	return New(http.StatusInternalServerError, "Internal Server Error", detail)
}

// BadRequest returns a 400 Problem.
func BadRequest(detail string) *Problem {
	return New(http.StatusBadRequest, "Bad Request", detail)
}

// Conflict returns a 409 Problem.
func Conflict(detail string) *Problem {
	return New(http.StatusConflict, "Conflict", detail)
}

// PreconditionFailed returns a 412 Problem with optional extra fields merged
// into the JSON body. Pass nil extras for a plain response.
func PreconditionFailed(detail string, extras map[string]any) *ProblemExtra {
	return &ProblemExtra{
		Problem: Problem{
			Type:   problemTypeURI(http.StatusPreconditionFailed),
			Title:  "Version Conflict",
			Status: http.StatusPreconditionFailed,
			Detail: detail,
		},
		Extras: extras,
	}
}

// PreconditionRequired returns a 428 Problem.
func PreconditionRequired(detail string) *Problem {
	return New(http.StatusPreconditionRequired, "Precondition Required", detail)
}

// InvalidMarkupSequence returns a 400 Problem for a markup tactic whose
// sequences failed validation. `issues` is serialised as an RFC 7807 extension
// member so the frontend can point at the exact category/step/operand/field.
func InvalidMarkupSequence(issues any) *ProblemExtra {
	return &ProblemExtra{
		Problem: Problem{
			Type:   problemTypeURI(http.StatusBadRequest),
			Title:  "Bad Request",
			Status: http.StatusBadRequest,
			Detail: "Некорректная последовательность наценок: не задан формат умножения для multiply+markup",
		},
		Extras: map[string]any{
			"code":   "INVALID_MARKUP_SEQUENCE",
			"issues": issues,
		},
	}
}

// Gone returns a 410 Problem for a retired endpoint. `code` is the stable,
// machine-readable identifier clients can branch on (e.g.
// COMMERCIAL_COST_WRITE_RETIRED).
func Gone(detail, code string) *ProblemExtra {
	return &ProblemExtra{
		Problem: Problem{
			Type:   problemTypeURI(http.StatusGone),
			Title:  "Gone",
			Status: http.StatusGone,
			Detail: detail,
		},
		Extras: map[string]any{"code": code},
	}
}

// InvalidBoqParent returns a 400 Problem for a copied / transferred BOQ row whose
// parent link cannot be remapped to a copied WORK row in the target.
// parentItemType is omitted when unknown.
func InvalidBoqParent(itemID, parentItemID, reason, parentItemType string) *ProblemExtra {
	extras := map[string]any{
		"code":         "INVALID_BOQ_PARENT",
		"itemId":       itemID,
		"parentItemId": parentItemID,
		"reason":       reason,
	}
	if parentItemType != "" {
		extras["parentItemType"] = parentItemType
	}
	return &ProblemExtra{
		Problem: Problem{
			Type:   problemTypeURI(http.StatusBadRequest),
			Title:  "Bad Request",
			Status: http.StatusBadRequest,
			Detail: "Некорректная ссылка на родительскую работу при копировании/переносе BOQ.",
		},
		Extras: extras,
	}
}

// InvalidTemplateParent returns a 400 Problem for a template row whose parent
// link does not resolve to a really-inserted WORK item. The extension members
// point the client at the exact template row / parent / reason.
// parentItemType is omitted when unknown.
func InvalidTemplateParent(templateItemID, parentTemplateItemID, reason, parentItemType string) *ProblemExtra {
	extras := map[string]any{
		"code":                 "INVALID_TEMPLATE_PARENT",
		"templateItemId":       templateItemID,
		"parentTemplateItemId": parentTemplateItemID,
		"reason":               reason,
	}
	if parentItemType != "" {
		extras["parentItemType"] = parentItemType
	}
	return &ProblemExtra{
		Problem: Problem{
			Type:   problemTypeURI(http.StatusBadRequest),
			Title:  "Bad Request",
			Status: http.StatusBadRequest,
			Detail: "Некорректная ссылка на родительскую работу в шаблоне.",
		},
		Extras: extras,
	}
}

// InvalidBoqAuditSnapshot returns a 400 Problem for an audit snapshot that
// cannot be safely interpreted for a rollback (missing/typed/enum/relation
// issues). Nothing was restored.
func InvalidBoqAuditSnapshot(auditID, field, reason string) *ProblemExtra {
	extras := map[string]any{
		"code":    "INVALID_BOQ_AUDIT_SNAPSHOT",
		"auditId": auditID,
		"reason":  reason,
	}
	if field != "" {
		extras["field"] = field
	}
	return &ProblemExtra{
		Problem: Problem{
			Type:   problemTypeURI(http.StatusBadRequest),
			Title:  "Bad Request",
			Status: http.StatusBadRequest,
			Detail: "Снимок аудита не может быть безопасно восстановлен. Откат не выполнен.",
		},
		Extras: extras,
	}
}

// BoqAuditTargetMismatch returns a 409 Problem when the audit record does not
// belong to the item/tender the rollback would mutate. Deliberately carries only
// the audit id — no data of the other tender leaks into the response.
func BoqAuditTargetMismatch(auditID string) *ProblemExtra {
	return &ProblemExtra{
		Problem: Problem{
			Type:   problemTypeURI(http.StatusConflict),
			Title:  "Conflict",
			Status: http.StatusConflict,
			Detail: "Запись аудита не относится к этому элементу или тендеру. Откат не выполнен.",
		},
		Extras: map[string]any{
			"code":    "BOQ_AUDIT_TARGET_MISMATCH",
			"auditId": auditID,
		},
	}
}

// UnsupportedBoqAuditRollback returns a 400 Problem for an audit operation type
// that has no rollback semantics (e.g. INSERT undo).
func UnsupportedBoqAuditRollback(auditID, operation string) *ProblemExtra {
	return &ProblemExtra{
		Problem: Problem{
			Type:   problemTypeURI(http.StatusBadRequest),
			Title:  "Bad Request",
			Status: http.StatusBadRequest,
			Detail: "Откат для операции аудита «" + operation + "» не поддерживается.",
		},
		Extras: map[string]any{
			"code":      "UNSUPPORTED_BOQ_AUDIT_ROLLBACK",
			"auditId":   auditID,
			"operation": operation,
		},
	}
}

// InvalidRedistributionRules returns a 400 Problem for a redistribution rules
// command that failed server-side validation. `issues` points at the exact
// fields (deductions[0].percentage, position_adjustments[1].amount, …).
func InvalidRedistributionRules(issues any) *ProblemExtra {
	return &ProblemExtra{
		Problem: Problem{
			Type:   problemTypeURI(http.StatusBadRequest),
			Title:  "Bad Request",
			Status: http.StatusBadRequest,
			Detail: "Правила перераспределения не прошли серверную валидацию. Ничего не сохранено.",
		},
		Extras: map[string]any{
			"code":   "INVALID_REDISTRIBUTION_RULES",
			"issues": issues,
		},
	}
}

// RedistributionTacticMismatch returns a 409 Problem: redistribution can be
// saved only for the tender's ACTIVE markup tactic.
func RedistributionTacticMismatch(requested, active string) *ProblemExtra {
	return &ProblemExtra{
		Problem: Problem{
			Type:   problemTypeURI(http.StatusConflict),
			Title:  "Conflict",
			Status: http.StatusConflict,
			Detail: "Перераспределение можно сохранить только для активной тактики наценок тендера.",
		},
		Extras: map[string]any{
			"code":            "REDISTRIBUTION_TACTIC_MISMATCH",
			"requestedTactic": requested,
			"activeTactic":    active,
		},
	}
}

// RedistributionUnbalanced returns a 409 Problem: the calculated snapshot does
// not balance and is never persisted.
func RedistributionUnbalanced(totalDeducted, totalAdded float64) *ProblemExtra {
	return &ProblemExtra{
		Problem: Problem{
			Type:   problemTypeURI(http.StatusConflict),
			Title:  "Conflict",
			Status: http.StatusConflict,
			Detail: "Расчёт перераспределения не сбалансирован (вычтено ≠ добавлено). Результат не сохранён.",
		},
		Extras: map[string]any{
			"code":          "REDISTRIBUTION_UNBALANCED",
			"totalDeducted": totalDeducted,
			"totalAdded":    totalAdded,
		},
	}
}

// InvalidInsuranceConfiguration returns a 400 Problem: the stored tender
// insurance row cannot be safely interpreted (non-finite/negative fields,
// percentage out of range).
func InvalidInsuranceConfiguration(field, reason string) *ProblemExtra {
	return &ProblemExtra{
		Problem: Problem{
			Type:   problemTypeURI(http.StatusBadRequest),
			Title:  "Bad Request",
			Status: http.StatusBadRequest,
			Detail: "Конфигурация страхования тендера некорректна. Исправьте её на странице «Страхование».",
		},
		Extras: map[string]any{
			"code":   "INVALID_INSURANCE_CONFIGURATION",
			"field":  field,
			"reason": reason,
		},
	}
}

// RedistributionNoBoqItems returns a 400 Problem: the tender has no BOQ items.
func RedistributionNoBoqItems() *ProblemExtra {
	return &ProblemExtra{
		Problem: Problem{
			Type:   problemTypeURI(http.StatusBadRequest),
			Title:  "Bad Request",
			Status: http.StatusBadRequest,
			Detail: "В тендере нет BOQ-элементов — перераспределять нечего.",
		},
		Extras: map[string]any{"code": "REDISTRIBUTION_NO_BOQ_ITEMS"},
	}
}

// MissingFXRate returns a 400 Problem for a blocking missing currency-rate
// condition. The machine-readable "code" and "currency" extension members let
// the frontend surface a precise message ("Не задан курс USD …") instead of a
// silently-zero amount.
func MissingFXRate(currency string) *ProblemExtra {
	return &ProblemExtra{
		Problem: Problem{
			Type:   problemTypeURI(http.StatusBadRequest),
			Title:  "Bad Request",
			Status: http.StatusBadRequest,
			Detail: "Не задан курс валюты " + currency + " для тендера. Расчёт заблокирован.",
		},
		Extras: map[string]any{
			"code":     "MISSING_FX_RATE",
			"currency": currency,
		},
	}
}

// ProblemExtra extends Problem with arbitrary extra fields serialised into
// the same JSON object (RFC 7807 §3.2 extension members).
type ProblemExtra struct {
	Problem
	Extras map[string]any
}

// Render writes the ProblemExtra as JSON to the response writer.
func (p *ProblemExtra) Render(w http.ResponseWriter) {
	// Build a single flat map merging Problem fields and Extras.
	m := map[string]any{
		"type":   p.Type,
		"title":  p.Title,
		"status": p.Status,
		"detail": p.Detail,
	}
	for k, v := range p.Extras {
		m[k] = v
	}
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(p.Status)
	_ = json.NewEncoder(w).Encode(m)
}

// problemTypeURI maps status codes to type URIs.
// Using IANA HTTP status pages as canonical URIs per RFC 7807 recommendation.
func problemTypeURI(status int) string {
	switch status {
	case http.StatusBadRequest:
		return "https://httpstatuses.io/400"
	case http.StatusUnauthorized:
		return "https://httpstatuses.io/401"
	case http.StatusForbidden:
		return "https://httpstatuses.io/403"
	case http.StatusNotFound:
		return "https://httpstatuses.io/404"
	case http.StatusConflict:
		return "https://httpstatuses.io/409"
	case http.StatusGone:
		return "https://httpstatuses.io/410"
	case http.StatusPreconditionFailed:
		return "https://httpstatuses.io/412"
	case http.StatusPreconditionRequired:
		return "https://httpstatuses.io/428"
	case http.StatusInternalServerError:
		return "https://httpstatuses.io/500"
	default:
		return "about:blank"
	}
}
