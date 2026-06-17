// WebSocket client for the Go BFF realtime hub (Phase 4a).
// Singleton connection, multiplexes topics via subscribe/unsubscribe frames.
// Lazy — connects on first subscribe(), tears down when no subscribers remain.
import { API_BASE_URL } from '../api/featureFlags';
import { getAccessToken as appAuthGetAccessToken } from '../auth/client';

export interface RealtimeEvent {
  table: string;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  id: string;
  tender_id: string | null;
  user_id?: string | null;
}

type Listener = (event: RealtimeEvent) => void;
type Unsubscribe = () => void;

interface TopicState {
  listeners: Set<Listener>;
}

const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 16_000;
// Keep the socket alive briefly after the last topic unsubscribes so that
// navigating between pages (old page unmounts → new page mounts) does not tear
// down and re-handshake the WS connection on every route change.
const IDLE_GRACE_MS = 5_000;

class WsClient {
  private ws: WebSocket | null = null;
  private topics = new Map<string, TopicState>();
  private connecting: Promise<void> | null = null;
  private backoffMs = MIN_BACKOFF_MS;
  private reconnectTimer: number | null = null;
  private idleTimer: number | null = null;
  private shouldReconnect = true;

  async subscribe(topic: string, listener: Listener): Promise<Unsubscribe> {
    // Cancel any pending idle teardown — a new subscriber arrived in time.
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    let state = this.topics.get(topic);
    if (!state) {
      state = { listeners: new Set() };
      this.topics.set(topic, state);
    }
    state.listeners.add(listener);

    await this.ensureConnected();
    this.sendFrame({ type: 'subscribe', topic });

    return () => {
      const s = this.topics.get(topic);
      if (!s) return;
      s.listeners.delete(listener);
      if (s.listeners.size === 0) {
        this.topics.delete(topic);
        this.sendFrame({ type: 'unsubscribe', topic });
      }
      if (this.topics.size === 0) {
        this.scheduleIdleClose();
      }
    };
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;

    this.connecting = this.connect();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async connect(): Promise<void> {
    // Unified token source — same as src/lib/api/client.ts.
    const token = await appAuthGetAccessToken();
    if (!token) throw new Error('WS connect: no active auth session');

    const httpBase = API_BASE_URL.replace(/\/$/, '');
    const wsBase = httpBase.replace(/^http/, 'ws');
    const url = `${wsBase}/api/v1/ws?token=${encodeURIComponent(token)}`;

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      let opened = false;

      ws.onopen = () => {
        opened = true;
        this.ws = ws;
        this.backoffMs = MIN_BACKOFF_MS;
        // Re-subscribe to all known topics after reconnect.
        for (const topic of this.topics.keys()) {
          ws.send(JSON.stringify({ type: 'subscribe', topic }));
        }
        resolve();
      };

      ws.onmessage = (ev) => this.onMessage(ev);
      ws.onerror = () => {
        if (!opened) reject(new Error('WS connect failed'));
      };
      ws.onclose = () => {
        // Only react if THIS socket is still the current one. A late onclose
        // from a previously-replaced socket must not null out a freshly
        // connected one (which would silently drop future subscribe frames).
        if (this.ws === ws) this.ws = null;
        if (!opened) reject(new Error('WS closed before open'));
        if (this.shouldReconnect && this.topics.size > 0 && this.ws === null) {
          this.scheduleReconnect();
        }
      };
    });
  }

  private onMessage(ev: MessageEvent): void {
    let frame: unknown;
    try {
      frame = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    if (!frame || typeof frame !== 'object') return;

    const f = frame as { type?: string; topic?: string; payload?: RealtimeEvent };
    if (f.type !== 'event' || !f.topic || !f.payload) return;

    const state = this.topics.get(f.topic);
    if (!state) return;
    for (const l of state.listeners) {
      try {
        l(f.payload);
      } catch (err) {
        // Listener errors must not break the read loop.
        console.error('[ws] listener threw:', err);
      }
    }
  }

  private sendFrame(frame: { type: string; topic: string }): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(frame));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const jitter = Math.random() * 0.3 * this.backoffMs;
    const delay = this.backoffMs + jitter;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      this.ensureConnected().catch(() => {
        // ensureConnected will re-schedule on failure via ws.onclose.
      });
    }, delay);
  }

  // scheduleIdleClose tears the connection down only if no topic re-subscribes
  // within the grace window. Cancelled by subscribe() when a new topic arrives.
  private scheduleIdleClose(): void {
    if (this.idleTimer !== null) return;
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      if (this.topics.size === 0) this.close();
    }, IDLE_GRACE_MS);
  }

  private close(): void {
    this.shouldReconnect = false;
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.shouldReconnect = true;
  }
}

const client = new WsClient();

/** Subscribe to a topic. Returns an unsubscribe function. */
export function subscribeRealtime(topic: string, listener: Listener): Promise<Unsubscribe> {
  return client.subscribe(topic, listener);
}
