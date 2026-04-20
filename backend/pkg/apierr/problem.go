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
	case http.StatusInternalServerError:
		return "https://httpstatuses.io/500"
	default:
		return "about:blank"
	}
}
