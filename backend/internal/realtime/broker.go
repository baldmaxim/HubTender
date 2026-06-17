package realtime

import (
	"encoding/json"
	"sync"
	"time"

	"github.com/rs/zerolog"
)

// publishPayload is the JSON shape written to every subscribed client.
type publishPayload struct {
	Table    string `json:"table"`
	Op       string `json:"op"`
	ID       string `json:"id"`
	TenderID string `json:"tender_id,omitempty"`
}

// Broker receives Events from the Listener, maps each event to one or more
// topic strings, debounces per topic, and calls hub.Publish when the
// debounce timer fires.
//
// Debounce behaviour: receiving a new event on a topic that already has a
// pending timer resets that timer to debounceDuration from now, so rapidly
// successive changes coalesce into a single publish call.
type Broker struct {
	hub              *Hub
	debounceDuration time.Duration
	logger           zerolog.Logger

	mu      sync.Mutex
	timers  map[string]*time.Timer
	pending map[string][]byte // last payload per topic (timer fires this)
}

// NewBroker constructs a Broker wired to the given Hub.
func NewBroker(hub *Hub, debounceDuration time.Duration, logger zerolog.Logger) *Broker {
	return &Broker{
		hub:              hub,
		debounceDuration: debounceDuration,
		logger:           logger.With().Str("component", "broker").Logger(),
		timers:           make(map[string]*time.Timer),
		pending:          make(map[string][]byte),
	}
}

// Close cancels every pending debounce timer and clears pending payloads,
// so no more publishes happen after this point. Safe to call once during
// graceful shutdown.
func (b *Broker) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()

	for topic, t := range b.timers {
		t.Stop()
		delete(b.timers, topic)
	}
	for topic := range b.pending {
		delete(b.pending, topic)
	}

	b.logger.Debug().Msg("broker closed; pending timers cancelled")
}

// Send implements EventSink. It is called by the Listener for each received
// pg_notify payload and dispatches the event to the appropriate topics.
func (b *Broker) Send(e Event) {
	topics := b.topicsFor(e)
	if len(topics) == 0 {
		return
	}

	payload, err := json.Marshal(publishPayload{
		Table:    e.Table,
		Op:       e.Op,
		ID:       e.ID,
		TenderID: e.TenderID,
	})
	if err != nil {
		b.logger.Error().Err(err).Msg("failed to marshal publish payload")
		return
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	for _, topic := range topics {
		b.schedulePublish(topic, payload)
	}
}

// schedulePublish (re)sets the debounce timer for topic. Must be called with
// b.mu held.
func (b *Broker) schedulePublish(topic string, payload []byte) {
	b.pending[topic] = payload

	if t, exists := b.timers[topic]; exists {
		// Reset the existing timer instead of creating a new one to avoid
		// timer leaks from frequent events on the same topic.
		t.Reset(b.debounceDuration)
		return
	}

	// Capture for the closure.
	capturedTopic := topic
	b.timers[topic] = time.AfterFunc(b.debounceDuration, func() {
		b.mu.Lock()
		data := b.pending[capturedTopic]
		delete(b.timers, capturedTopic)
		delete(b.pending, capturedTopic)
		b.mu.Unlock()

		b.hub.Publish(capturedTopic, data)

		b.logger.Debug().Str("topic", capturedTopic).Msg("debounced publish fired")
	})
}

// topicsFor maps a single Event to the set of topic strings that should
// receive it, following the routing rules from the Phase 4 spec:
//
//   - table == "notifications" → "notifications:{user_id}"
//   - table == "tenders"       → "tenders" AND "tender:{id}"
//   - global / reference tables → dedicated global topic (see cases below)
//   - all other tables         → "tender:{tender_id}" (if tender_id non-empty)
func (b *Broker) topicsFor(e Event) []string {
	switch e.Table {
	case "notifications":
		if e.UserID == "" {
			b.logger.Warn().Str("id", e.ID).Msg("notification event missing user_id; skipping")
			return nil
		}
		return []string{"notifications:" + e.UserID}

	case "tenders":
		// Broadcast to both the global tenders list and the per-tender topic
		// so consumers watching either get the event.
		topics := []string{"tenders"}
		if e.ID != "" {
			topics = append(topics, "tender:"+e.ID)
		}
		return topics

	// --- Global / reference tables → dedicated topics (no tender_id) ---
	case "user_tasks":
		return []string{"tasks"}
	case "users":
		return []string{"users"}
	case "materials_library", "works_library", "material_names", "work_names", "units":
		return []string{"references"}
	case "templates", "template_items":
		return []string{"templates"}
	case "markup_tactics", "markup_parameters":
		return []string{"markup"}
	case "import_sessions":
		return []string{"imports"}
	case "projects", "project_additional_agreements", "project_monthly_completion":
		return []string{"projects"}
	case "tender_registry":
		// The registry backs the tenders list/dashboard; reuse the `tenders` topic.
		return []string{"tenders"}

	default:
		// boq_items, client_positions, cost_redistribution_results,
		// construction_cost_volumes, and the tender-scoped config tables
		// (tender_markup_percentage, tender_pricing_distribution,
		// tender_insurance, tender_notes, tender_documents,
		// subcontract_growth_exclusions) — all carry a tender_id.
		if e.TenderID == "" {
			b.logger.Warn().
				Str("table", e.Table).
				Str("id", e.ID).
				Msg("event has no tender_id; skipping")
			return nil
		}
		return []string{"tender:" + e.TenderID}
	}
}
