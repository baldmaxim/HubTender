package apierr

import (
	"net/http"

	"github.com/rs/zerolog/log"
)

// InternalFromErr is the recommended way for handlers to surface an
// internal error: it logs the underlying err (with method/path/request id +
// any caller-supplied k/v context) to zerolog at ERROR level, then renders
// the safe RFC 7807 "Internal Server Error" body to the client.
//
// Why a helper:
//
//	handlers historically did `apierr.InternalError("...").Render(w)` and
//	threw away the inner err. That made schema-drift / pgx errors invisible
//	in prod — operators had to add ad-hoc logging or attach a debugger to
//	diagnose every new 500. This helper keeps the response surface
//	identical (same problem+json body, same status, no leak of error text
//	to the client) while making the server-side log self-sufficient.
//
// detail is the user-facing summary (RFC 7807 `detail`). err is logged but
// NEVER sent to the client. Extra k/v pairs are added to the log event as
// "kN" / "vN" — keep them short (tender_id, position_id, etc.). Caller is
// responsible for NOT putting tokens / passwords / DSNs into either.
func InternalFromErr(w http.ResponseWriter, r *http.Request, err error, detail string, kv ...any) {
	event := log.Error().
		Err(err).
		Str("method", r.Method).
		Str("path", r.URL.Path)
	if rid := r.Header.Get("X-Request-ID"); rid != "" {
		event = event.Str("request_id", rid)
	}
	// Pairwise k/v: even index = string key, odd index = value.
	for i := 0; i+1 < len(kv); i += 2 {
		k, ok := kv[i].(string)
		if !ok {
			continue
		}
		event = event.Interface(k, kv[i+1])
	}
	event.Msg("internal error")

	New(http.StatusInternalServerError, "Internal Server Error", detail).Render(w)
}
