// React hook for subscribing to a realtime topic via the Go WS hub.
// Handles mount/unmount and the race where the component unmounts before
// the WS subscribe frame resolves.
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { isRealtimeEnabled } from '../api/featureFlags';
import { useIsTabActive } from '../../hooks/useIsTabActive';
import { subscribeRealtime, type RealtimeEvent } from './ws';

export type RealtimeTopicHandler = (event: RealtimeEvent) => void;

// Tracks whether we are currently inside a realtime-triggered handler. Data
// hooks read this in their fetch functions to skip the visible loading spinner
// on realtime refetches (silent background update), while keeping it for the
// initial load and user-initiated actions. It is only truthy during the
// synchronous portion of a handler — i.e. while a fetch's pre-await prefix
// (where setLoading(true) lives) runs — so it never leaks to user fetches.
let realtimeRefetchDepth = 0;

/** True while a realtime WS event handler (and the sync prefix of the fetch it
 *  kicks off) is executing. Guard `setLoading(true)` with `!isRealtimeRefetchActive()`. */
export function isRealtimeRefetchActive(): boolean {
  return realtimeRefetchDepth > 0;
}

/** Runs `fn` as a realtime handler (see realtimeRefetchDepth above). */
export function runAsRealtime(fn: () => void): void {
  realtimeRefetchDepth++;
  try {
    fn();
  } finally {
    realtimeRefetchDepth--;
  }
}

/**
 * Pauses a realtime handler while the page lives in a hidden workspace tab (see TabHost): events
 * are not handled, only the last one is remembered, and when the tab is shown again `fn` runs
 * once with it (as a realtime handler — no spinner). Without this every keep-alive page would
 * refetch on every event — e.g. 4 pages refetching the heavy `tenders` list at once.
 * Outside a tab (useIsTabActive is always true there) it is a plain pass-through.
 *
 * Returns a stable function: call it with each incoming event.
 */
export function useDeferWhileHidden<T>(fn: (event: T) => void): (event: T) => void {
  const active = useIsTabActive();
  const activeRef = useRef(active);
  const fnRef = useRef(fn);
  const pendingRef = useRef<{ event: T } | null>(null);

  // Committed values only: a render inside a transition may be discarded.
  useLayoutEffect(() => {
    activeRef.current = active;
    fnRef.current = fn;
  });

  useEffect(() => {
    if (!active || !pendingRef.current) return;
    const { event } = pendingRef.current;
    pendingRef.current = null;
    runAsRealtime(() => fnRef.current(event));
  }, [active]);

  return useCallback((event: T) => {
    if (activeRef.current) {
      // A live event supersedes the deferred one (it can arrive between the layout and the
      // passive effect of the show): otherwise the stale replay would run a second time.
      pendingRef.current = null;
      runAsRealtime(() => fnRef.current(event));
    } else {
      pendingRef.current = { event };
    }
  }, []);
}

/**
 * Subscribes to `topic` via the Go BFF WebSocket hub when
 * VITE_API_REALTIME_ENABLED=true and `enabled` is truthy.
 *
 * While the page is in a hidden workspace tab the handler is deferred (see
 * useDeferWhileHidden); pass `deferWhenHidden: false` when the caller filters events itself
 * and defers only the work that is worth deferring (useRealtimeRefetch).
 *
 * Returns true when the hook is active (flag on + enabled). Callers use the
 * return value to decide whether to also keep their Supabase fallback.
 */
export function useRealtimeTopic(
  topic: string | null,
  handler: RealtimeTopicHandler,
  enabled: boolean = true,
  opts: { deferWhenHidden?: boolean } = {},
): boolean {
  const { deferWhenHidden = true } = opts;
  // Keep the latest handler in a ref so resubscribing isn't required
  // when the handler identity changes.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const deferRef = useRef(deferWhenHidden);
  deferRef.current = deferWhenHidden;
  const deferred = useDeferWhileHidden(handler);

  const active = isRealtimeEnabled() && enabled && !!topic;

  useEffect(() => {
    if (!active || !topic) return;

    let cancelled = false;
    let unsub: (() => void) | null = null;

    subscribeRealtime(topic, (ev) => {
      if (deferRef.current) deferred(ev);
      else runAsRealtime(() => handlerRef.current(ev));
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
  }, [active, topic, deferred]);

  return active;
}
