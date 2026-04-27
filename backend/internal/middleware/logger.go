package middleware

import (
	"bufio"
	"errors"
	"net"
	"net/http"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// responseWriter wraps http.ResponseWriter to capture the status code for
// structured logging after the handler completes.
type responseWriter struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (rw *responseWriter) WriteHeader(status int) {
	if !rw.wrote {
		rw.status = status
		rw.wrote = true
	}
	rw.ResponseWriter.WriteHeader(status)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	if !rw.wrote {
		rw.status = http.StatusOK
		rw.wrote = true
	}
	return rw.ResponseWriter.Write(b)
}

// Hijack delegates to the underlying ResponseWriter so WebSocket upgrades work
// when this wrapper sits in the middleware chain. Returns an error if the
// underlying writer does not support hijacking.
func (rw *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := rw.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("underlying ResponseWriter does not support Hijack")
	}
	return h.Hijack()
}

// Flush propagates Flush() so streaming endpoints (SSE etc.) keep working.
func (rw *responseWriter) Flush() {
	if f, ok := rw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// RequestLogger returns a chi-compatible middleware that logs each request
// using zerolog structured logging. It records method, path, status, duration,
// and the remote address.
func RequestLogger(logger zerolog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			wrapped := &responseWriter{
				ResponseWriter: w,
				status:         http.StatusOK,
			}

			next.ServeHTTP(wrapped, r)

			duration := time.Since(start)

			event := logger.Info()
			if wrapped.status >= 500 {
				event = logger.Error()
			} else if wrapped.status >= 400 {
				event = logger.Warn()
			}

			event.
				Str("method", r.Method).
				Str("path", r.URL.Path).
				Int("status", wrapped.status).
				Dur("duration_ms", duration).
				Str("remote", r.RemoteAddr).
				Str("request_id", requestIDFromCtx(r)).
				Msg("request")
		})
	}
}

// Recoverer returns a middleware that catches panics, logs the stack trace,
// and responds with 500 Internal Server Error so the server keeps running.
func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Error().
					Interface("panic", rec).
					Str("path", r.URL.Path).
					Msg("panic recovered")

				http.Error(w, "internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// requestIDFromCtx extracts X-Request-ID for logging. Returns empty string if absent.
func requestIDFromCtx(r *http.Request) string {
	return r.Header.Get("X-Request-ID")
}
