package realtime

import (
	"encoding/json"
	"testing"

	"github.com/rs/zerolog"
)

// TestPublishWrapsEventEnvelope guards the wire contract with the frontend ws
// client: published frames MUST be {type:"event", topic, payload:<raw>}.
// Sending the bare payload makes the client drop every event (type != "event").
func TestPublishWrapsEventEnvelope(t *testing.T) {
	h := NewHub(zerolog.Nop())
	c := NewClient("u1", "u1@example.com")
	h.Register(c)
	h.Subscribe(c, "tender:t1")

	raw := []byte(`{"table":"client_positions","op":"UPDATE","id":"x","tender_id":"t1"}`)
	h.Publish("tender:t1", raw)

	select {
	case b := <-c.Send():
		var f struct {
			Type    string          `json:"type"`
			Topic   string          `json:"topic"`
			Payload json.RawMessage `json:"payload"`
		}
		if err := json.Unmarshal(b, &f); err != nil {
			t.Fatalf("frame is not valid JSON: %v (%s)", err, b)
		}
		if f.Type != "event" {
			t.Errorf("type = %q, want %q", f.Type, "event")
		}
		if f.Topic != "tender:t1" {
			t.Errorf("topic = %q, want %q", f.Topic, "tender:t1")
		}
		if string(f.Payload) != string(raw) {
			t.Errorf("payload = %s, want %s", f.Payload, raw)
		}
	default:
		t.Fatal("no frame delivered to subscribed client")
	}
}
