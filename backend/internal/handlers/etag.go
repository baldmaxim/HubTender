package handlers

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// computeResourceETag returns a quoted ETag derived from the row's id and
// updated_at. Format: base64url(updated_at_rfc3339nano) + ":" + first-8-hex
// of sha256(id + "|" + updated_at_rfc3339nano), wrapped in double quotes per
// RFC 7232.
func computeResourceETag(id string, updatedAt time.Time) string {
	ts := updatedAt.UTC().Format(time.RFC3339Nano)
	tsB64 := base64.RawURLEncoding.EncodeToString([]byte(ts))
	sum := sha256.Sum256([]byte(id + "|" + ts))
	hashHex := fmt.Sprintf("%x", sum[:4]) // 8 hex chars
	return `"` + tsB64 + ":" + hashHex + `"`
}

// checkIfMatch compares the request's If-Match header to the ETag computed
// from id + updatedAt. Returns true when they match (request may proceed).
func checkIfMatch(r *http.Request, id string, updatedAt time.Time) bool {
	ifMatch := strings.TrimSpace(r.Header.Get("If-Match"))
	if ifMatch == "" {
		return false
	}
	want := computeResourceETag(id, updatedAt)
	// Strip surrounding quotes from the client value for a lenient comparison.
	got := strings.Trim(ifMatch, `"`)
	exp := strings.Trim(want, `"`)
	return got == exp
}

// setResourceETag writes the ETag header for a row-level resource.
func setResourceETag(w http.ResponseWriter, id string, updatedAt time.Time) {
	w.Header().Set("ETag", computeResourceETag(id, updatedAt))
}
