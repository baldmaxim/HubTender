package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/coder/websocket"
	"github.com/rs/zerolog"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/realtime"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

const (
	wsMaxMessageBytes = 4 * 1024       // 4 KB — enough for subscribe frames
	wsReadDeadline    = 60 * time.Second
	wsWriteDeadline   = 10 * time.Second
	wsPingInterval    = 30 * time.Second
)

// wsFrame is the JSON shape expected from the browser client.
// type is either "subscribe" or "unsubscribe"; topic is the target topic string.
type wsFrame struct {
	Type  string `json:"type"`
	Topic string `json:"topic"`
}

// WsHandler serves GET /api/v1/ws and manages the WebSocket lifecycle.
type WsHandler struct {
	hub    *realtime.Hub
	kf     keyfunc.Keyfunc
	issuer string
	logger zerolog.Logger
}

// NewWsHandler constructs a WsHandler. kf and issuer are the same values used
// by the JWTAuth middleware — the handler does its own token verification
// because the browser WebSocket API cannot set an Authorization header.
func NewWsHandler(hub *realtime.Hub, kf keyfunc.Keyfunc, issuer string, logger zerolog.Logger) *WsHandler {
	return &WsHandler{
		hub:    hub,
		kf:     kf,
		issuer: issuer,
		logger: logger.With().Str("component", "ws_handler").Logger(),
	}
}

// Serve is the HTTP handler for GET /api/v1/ws.
// It reads the JWT from the ?token= query parameter, validates it, upgrades
// the connection, then runs reader and writer goroutines until disconnect.
func (h *WsHandler) Serve(w http.ResponseWriter, r *http.Request) {
	// 1. Read and validate the JWT from the query string.
	raw := r.URL.Query().Get("token")
	if raw == "" {
		apierr.Unauthorized("missing token query parameter").Render(w)
		return
	}

	authed, err := middleware.VerifyToken(h.kf, h.issuer, raw)
	if err != nil {
		apierr.Unauthorized("invalid or expired token").Render(w)
		return
	}

	// 2. Upgrade to WebSocket.
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// Allow any origin; the JWT already authenticates the caller.
		// Fine-grained origin checking is not needed for a WS-only endpoint.
		InsecureSkipVerify: true,
	})
	if err != nil {
		h.logger.Error().Err(err).Str("client_id", authed.ID).Msg("websocket upgrade failed")
		return
	}
	conn.SetReadLimit(wsMaxMessageBytes)

	// 3. Register client with the hub.
	client := realtime.NewClient(authed.ID, authed.Email)
	h.hub.Register(client)
	defer h.hub.Unregister(client)

	h.logger.Info().Str("client_id", authed.ID).Msg("websocket client connected")

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// 4. Launch writer goroutine — drains client.Send() and writes WS frames.
	writerDone := make(chan struct{})
	go func() {
		defer close(writerDone)
		h.runWriter(ctx, conn, client, cancel)
	}()

	// 5. Run reader on the current goroutine — blocks until disconnect or ctx cancel.
	h.runReader(ctx, conn, client, authed)

	// Signal the writer to stop and wait for it to finish.
	cancel()
	<-writerDone

	h.logger.Info().Str("client_id", authed.ID).Msg("websocket client disconnected")
}

// runReader reads subscribe/unsubscribe frames from the browser client.
// It returns when the connection closes or ctx is cancelled.
func (h *WsHandler) runReader(
	ctx context.Context,
	conn *websocket.Conn,
	client *realtime.Client,
	authed *middleware.AuthUser,
) {
	for {
		// Renew the read deadline on every iteration (acts as a pong handler:
		// any frame, including pings, resets the deadline).
		readCtx, readCancel := context.WithTimeout(ctx, wsReadDeadline)
		msgType, data, err := conn.Read(readCtx)
		readCancel()

		if err != nil {
			// ctx cancelled or connection closed — normal exit.
			return
		}
		if msgType != websocket.MessageText {
			continue // ignore binary frames
		}

		var frame wsFrame
		if err := json.Unmarshal(data, &frame); err != nil {
			h.logger.Warn().Str("client_id", authed.ID).Msg("unparseable WS frame; ignoring")
			continue
		}

		topic := strings.TrimSpace(frame.Topic)
		if topic == "" {
			continue
		}

		switch frame.Type {
		case "subscribe":
			if !h.authoriseTopic(authed, topic) {
				h.writeError(ctx, conn, "forbidden: "+topic)
				continue
			}
			h.hub.Subscribe(client, topic)

		case "unsubscribe":
			h.hub.Unsubscribe(client, topic)

		default:
			h.logger.Warn().
				Str("client_id", authed.ID).
				Str("type", frame.Type).
				Msg("unknown WS frame type; ignoring")
		}
	}
}

// runWriter flushes the client's send channel to the WS connection.
// It also sends periodic pings to keep the connection alive.
// It returns when the send channel is closed or ctx is cancelled.
func (h *WsHandler) runWriter(
	ctx context.Context,
	conn *websocket.Conn,
	client *realtime.Client,
	cancel context.CancelFunc,
) {
	ticker := time.NewTicker(wsPingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			_ = conn.Close(websocket.StatusNormalClosure, "server shutdown")
			return

		case payload, ok := <-client.Send():
			if !ok {
				// Channel closed by hub.Unregister — clean shutdown.
				_ = conn.Close(websocket.StatusNormalClosure, "")
				return
			}
			writeCtx, writeCancel := context.WithTimeout(ctx, wsWriteDeadline)
			err := conn.Write(writeCtx, websocket.MessageText, payload)
			writeCancel()
			if err != nil {
				h.logger.Debug().Err(err).Str("client_id", client.ID).Msg("write error; closing")
				cancel()
				return
			}

		case <-ticker.C:
			pingCtx, pingCancel := context.WithTimeout(ctx, wsWriteDeadline)
			err := conn.Ping(pingCtx)
			pingCancel()
			if err != nil {
				h.logger.Debug().Err(err).Str("client_id", client.ID).Msg("ping failed; closing")
				cancel()
				return
			}
		}
	}
}

// authoriseTopic enforces per-topic access control:
//
//   - "notifications:<uid>"  → uid must exactly match authed.ID
//   - "tender:<uuid>"        → any authenticated user (RLS parity deferred to 4b)
//   - "tenders"              → any authenticated user
//   - everything else        → denied
func (h *WsHandler) authoriseTopic(authed *middleware.AuthUser, topic string) bool {
	if strings.HasPrefix(topic, "notifications:") {
		uid := strings.TrimPrefix(topic, "notifications:")
		return uid == authed.ID
	}
	if strings.HasPrefix(topic, "tender:") {
		return true
	}
	if topic == "tenders" {
		return true
	}
	return false
}

// writeError sends a plain-text error message to the client.
// Used to surface authorisation denials without closing the connection.
func (h *WsHandler) writeError(ctx context.Context, conn *websocket.Conn, msg string) {
	payload, _ := json.Marshal(map[string]string{"error": msg})
	writeCtx, cancel := context.WithTimeout(ctx, wsWriteDeadline)
	defer cancel()
	_ = conn.Write(writeCtx, websocket.MessageText, payload)
}
