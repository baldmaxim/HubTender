// React hook for subscribing to a realtime topic via the Go WS hub.
// Handles mount/unmount and the race where the component unmounts before
// the WS subscribe frame resolves.
import { useEffect, useRef } from 'react';
import { isRealtimeEnabled } from '../api/featureFlags';
import { subscribeRealtime, type RealtimeEvent } from './ws';

export type RealtimeTopicHandler = (event: RealtimeEvent) => void;

/**
 * Subscribes to `topic` via the Go BFF WebSocket hub when
 * VITE_API_REALTIME_ENABLED=true and `enabled` is truthy.
 *
 * Returns true when the hook is active (flag on + enabled). Callers use the
 * return value to decide whether to also keep their Supabase fallback.
 */
export function useRealtimeTopic(
  topic: string | null,
  handler: RealtimeTopicHandler,
  enabled: boolean = true,
): boolean {
  // Keep the latest handler in a ref so resubscribing isn't required
  // when the handler identity changes.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const active = isRealtimeEnabled() && enabled && !!topic;

  useEffect(() => {
    if (!active || !topic) return;

    let cancelled = false;
    let unsub: (() => void) | null = null;

    subscribeRealtime(topic, (ev) => {
      handlerRef.current(ev);
    })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unsub = fn;
      })
      .catch((err) => {
        console.error('[realtime] subscribe failed:', err);
      });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [active, topic]);

  return active;
}
