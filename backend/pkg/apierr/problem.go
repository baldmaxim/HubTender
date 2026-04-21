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
