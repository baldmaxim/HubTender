// WebSocket client for the Go BFF realtime hub (Phase 4a).
// Singleton connection, multiplexes topics via subscribe/unsubscribe frames.
// Lazy — connects on first subscribe(), tears down when no subscribers remain.
import { supabase } from '../supabase';
import { API_BASE_URL } from '../api/featureFlags';

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

class WsClient {
  private ws: WebSocket | null = null;
  private topics = new Map<string, TopicState>();
  private connecting: Promise<void> | null = null;
  private backoffMs = MIN_BACKOFF_MS;
  private reconnectTimer: number | null = null;
  private shouldReconnect = true;

  async subscribe(topic: string, listener: Listener): Promise<Unsubscribe> {
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
        this.close();
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
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('WS connect: no Supabase session');

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
        this.ws = null;
        if (!opened) reject(new Error('WS closed before open'));
        if (this.shouldReconnect && this.topics.size > 0) {
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

  private close(): void {
    this.shouldReconnect = false;
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
