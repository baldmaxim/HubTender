package realtime

import (
	"sync"

	"github.com/rs/zerolog"
)

// Client represents a single connected WebSocket client.
// The send channel is buffered so that a slow client does not block
// the Publish hot path; messages are dropped (non-blocking send) when full.
type Client struct {
	// ID is the authenticated Supabase user UUID.
	ID string

	// Email is the authenticated user's email (for logging).
	Email string

	// send is the outbound byte queue consumed by the WS writer goroutine.
	// Buffered at 64 to absorb short bursts before the writer catches up.
	send chan []byte

	// topics is the set of topic strings this client is subscribed to.
	topics map[string]struct{}

	mu sync.Mutex
}

// NewClient allocates a Client ready for use.
func NewClient(id, email string) *Client {
	return &Client{
		ID:     id,
		Email:  email,
		send:   make(chan []byte, 64),
		topics: make(map[string]struct{}),
	}
}

// Send returns the outbound channel so the WS writer goroutine can read from it.
func (c *Client) Send() <-chan []byte {
	return c.send
}

// Hub is a thread-safe registry that maps topic strings to the set of clients
// subscribed to that topic. It is the central dispatch point for Publish.
type Hub struct {
	// topics maps topic → set of clients.
	topics map[string]map[*Client]struct{}
	mu     sync.RWMutex

	// clients is the full set of registered clients (for cleanup on Unregister).
	clients map[*Client]struct{}
	cmu     sync.Mutex

	logger zerolog.Logger
}

// NewHub constructs an empty Hub.
func NewHub(logger zerolog.Logger) *Hub {
	return &Hub{
		topics:  make(map[string]map[*Client]struct{}),
		clients: make(map[*Client]struct{}),
		logger:  logger.With().Str("component", "hub").Logger(),
	}
}

// Register adds a client to the hub's tracking set.
// It does not subscribe the client to any topic; call Subscribe for that.
func (h *Hub) Register(c *Client) {
	h.cmu.Lock()
	h.clients[c] = struct{}{}
	h.cmu.Unlock()

	h.logger.Debug().Str("client_id", c.ID).Msg("client registered")
}

// Unregister removes a client from all topic subscriptions and closes its
// send channel so the writer goroutine terminates cleanly.
func (h *Hub) Unregister(c *Client) {
	// Remove from all topics using the write lock.
	h.mu.Lock()
	c.mu.Lock()
	for topic := range c.topics {
		if subs, ok := h.topics[topic]; ok {
			delete(subs, c)
			if len(subs) == 0 {
				delete(h.topics, topic)
			}
		}
	}
	c.topics = make(map[string]struct{})
	c.mu.Unlock()
	h.mu.Unlock()

	// Remove from client registry.
	h.cmu.Lock()
	delete(h.clients, c)
	h.cmu.Unlock()

	// Close the send channel so the WS writer goroutine drains and exits.
	close(c.send)

	h.logger.Debug().Str("client_id", c.ID).Msg("client unregistered")
}

// Subscribe adds the client to the given topic.
func (h *Hub) Subscribe(c *Client, topic string) {
	h.mu.Lock()
	if h.topics[topic] == nil {
		h.topics[topic] = make(map[*Client]struct{})
	}
	h.topics[topic][c] = struct{}{}
	h.mu.Unlock()

	c.mu.Lock()
	c.topics[topic] = struct{}{}
	c.mu.Unlock()

	h.logger.Debug().Str("client_id", c.ID).Str("topic", topic).Msg("subscribed")
}

// Unsubscribe removes the client from the given topic.
func (h *Hub) Unsubscribe(c *Client, topic string) {
	h.mu.Lock()
	if subs, ok := h.topics[topic]; ok {
		delete(subs, c)
		if len(subs) == 0 {
			delete(h.topics, topic)
		}
	}
	h.mu.Unlock()

	c.mu.Lock()
	delete(c.topics, topic)
	c.mu.Unlock()

	h.logger.Debug().Str("client_id", c.ID).Str("topic", topic).Msg("unsubscribed")
}

// Publish sends payload to every client subscribed to topic.
// The send is non-blocking: if a client's buffer is full the message is
// dropped rather than blocking the entire Publish path.
func (h *Hub) Publish(topic string, payload []byte) {
	h.mu.RLock()
	subs := h.topics[topic]
	// Copy the client set so we can release the read lock before sending.
	targets := make([]*Client, 0, len(subs))
	for c := range subs {
		targets = append(targets, c)
	}
	h.mu.RUnlock()

	dropped := 0
	for _, c := range targets {
		select {
		case c.send <- payload:
		default:
			dropped++
		}
	}

	if dropped > 0 {
		h.logger.Warn().
			Str("topic", topic).
			Int("dropped", dropped).
			Msg("slow clients: messages dropped")
	}
}
