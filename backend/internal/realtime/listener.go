package realtime

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog"
)

// Event is the parsed payload from a pg_notify 'rowchange' notification.
// Field names match the JSON produced by the notify_row_change() trigger function.
type Event struct {
	Table    string `json:"table"`
	Op       string `json:"op"`
	ID       string `json:"id"`
	TenderID string `json:"tender_id"`
	UserID   string `json:"user_id"`
}

// EventSink is anything that can receive an Event from the listener.
// Broker implements this interface.
type EventSink interface {
	Send(e Event)
}

// Listener owns a dedicated *pgx.Conn (NOT a pool connection) and runs
// LISTEN rowchange in a loop. A dedicated connection is required because
// LISTEN/NOTIFY holds the connection for the entire lifetime of the
// subscription — borrowing a connection from the pool would starve it.
type Listener struct {
	initialConn *pgx.Conn
	dsn         string
	sink        EventSink
	logger      zerolog.Logger
}

// NewListener constructs a Listener.
//   - initialConn is the already-opened *pgx.Conn passed from main.go; it is
//     used on the first iteration so we get an error at startup if the DB is
//     unreachable, rather than silently falling into the retry loop.
//   - dsn is used for subsequent reconnect attempts after any connection error.
func NewListener(initialConn *pgx.Conn, dsn string, sink EventSink, logger zerolog.Logger) *Listener {
	return &Listener{
		initialConn: initialConn,
		dsn:         dsn,
		sink:        sink,
		logger:      logger.With().Str("component", "listener").Logger(),
	}
}

// Run blocks until ctx is cancelled. On the first iteration it uses the
// pre-opened initialConn; on subsequent iterations it dials via dsn.
// Reconnects with exponential backoff (500 ms → 30 s) on any error.
func (l *Listener) Run(ctx context.Context) {
	const (
		backoffMin = 500 * time.Millisecond
		backoffMax = 30 * time.Second
	)

	backoff := backoffMin
	first := true

	for {
		// Exit immediately if the context is already done.
		if ctx.Err() != nil {
			return
		}

		var conn *pgx.Conn
		if first && l.initialConn != nil {
			conn = l.initialConn
			first = false
		} else {
			var err error
			conn, err = pgx.Connect(ctx, l.dsn)
			if err != nil {
				l.logger.Error().Err(err).Dur("retry_in", backoff).Msg("failed to connect; retrying")
				select {
				case <-ctx.Done():
					return
				case <-time.After(backoff):
				}
				backoff = min(backoff*2, backoffMax)
				continue
			}
		}

		l.logger.Info().Msg("connected; listening on channel 'rowchange'")

		if _, err := conn.Exec(ctx, "LISTEN rowchange"); err != nil {
			l.logger.Error().Err(err).Msg("LISTEN failed; reconnecting")
			_ = conn.Close(ctx)
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			backoff = min(backoff*2, backoffMax)
			continue
		}

		// receive loop — runs until the connection breaks or ctx is cancelled.
		err := l.receiveLoop(ctx, conn)

		_ = conn.Close(context.Background())

		if ctx.Err() != nil {
			l.logger.Info().Msg("context cancelled; listener stopped")
			return
		}

		if err != nil {
			// Abnormal disconnect: log and wait with current backoff.
			l.logger.Error().Err(err).Dur("retry_in", backoff).Msg("receive loop error; reconnecting")
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			backoff = min(backoff*2, backoffMax)
		} else {
			// receiveLoop returned nil without ctx cancellation — treat as
			// connection closed cleanly; reset backoff for the next attempt.
			backoff = backoffMin
		}
	}
}

// receiveLoop waits for notifications and forwards them to the sink.
// Returns nil on clean ctx cancellation, or an error on connection failure.
func (l *Listener) receiveLoop(ctx context.Context, conn *pgx.Conn) error {
	for {
		notification, err := conn.WaitForNotification(ctx)
		if err != nil {
			if ctx.Err() != nil {
				// Context cancelled — clean shutdown, not an error.
				return nil
			}
			return err
		}

		var e Event
		if err := json.Unmarshal([]byte(notification.Payload), &e); err != nil {
			l.logger.Warn().
				Str("payload", notification.Payload).
				Err(err).
				Msg("failed to parse notification payload; skipping")
			continue
		}

		l.logger.Debug().
			Str("table", e.Table).
			Str("op", e.Op).
			Str("id", e.ID).
			Msg("notification received")

		// Reset backoff in the caller on each successful receive.
		// We signal this by returning nil; the caller re-enters receiveLoop
		// immediately (backoff reset happens in Run before reconnect).
		l.sink.Send(e)
	}
}

