// Convenience wrapper over useRealtimeTopic that adds a self-echo guard.
//
// Problem: an optimistic local mutation already updates the UI and also emits a
// pg_notify, which comes back as a WS event ~200 ms later (broker debounce).
// Without a guard the page refetches on its own echo and flickers.
//
// Two ways to mark a local mutation:
//   1. The returned `markLocalMutation()` — when the mutation lives in the same
//      hook as the subscription (e.g. useClientPositions).
//   2. The module-level `markRealtimeMutation(topic)` — when the mutation lives
//      in a different hook/component than the subscription (e.g. PositionItems'
//      edit forms mutate, while useBoqItems subscribes). Both sides reference
//      the same topic string (`tender:<id>`), so the echo is suppressed.
import { useCallback, useRef } from 'react';
import { useRealtimeTopic, type RealtimeTopicHandler } from './useRealtimeTopic';
import type { RealtimeEvent } from './ws';

const DEFAULT_ECHO_MS = 1500;

// Module-level registry of the last local-mutation timestamp per topic. Shared
// across hook instances so a mutation site and a subscription in different hooks
// can coordinate via the topic string alone.
const lastMutationByTopic = new Map<string, number>();

/** Stamp `topic` as just locally mutated, suppressing the imminent WS echo. */
export function markRealtimeMutation(topic: string | null | undefined): void {
  if (topic) lastMutationByTopic.set(topic, Date.now());
}

function mutatedWithin(topic: string, ms: number): boolean {
  const t = lastMutationByTopic.get(topic);
  return t !== undefined && Date.now() - t < ms;
}

export interface RealtimeRefetchOptions {
  /** When false the subscription is inactive (same as useRealtimeTopic). */
  enabled?: boolean;
  /** Window after a local mutation during which echoed events are ignored. */
  echoMs?: number;
  /** Optional extra filter; return false to skip the refetch for this event. */
  shouldRefetch?: (event: RealtimeEvent) => boolean;
  /**
   * Suppress only THIS instance's own echo (via the local mutatedAtRef), and
   * ignore the module-level cross-hook registry.
   *
   * Needed for keep-alive sibling views on the same topic: the ClientPositions
   * table and the PositionItems detail tab are both mounted and both subscribe
   * to `tender:<id>`. A mutation in PositionItems stamps the shared registry and
   * would otherwise suppress the table's legitimate refetch (e.g. a GP-note edit
   * never reaching the table). The table's own optimistic mutations still go
   * through markLocalMutation → mutatedAtRef, so self-echo stays suppressed.
   */
  selfEchoOnly?: boolean;
}

export interface RealtimeRefetchResult {
  /** Call in a local mutation's success branch to suppress the WS echo. */
  markLocalMutation: () => void;
  /** True when the underlying subscription is active. */
  active: boolean;
}

export function useRealtimeRefetch(
  topic: string | null,
  refetch: RealtimeTopicHandler,
  opts: RealtimeRefetchOptions = {},
): RealtimeRefetchResult {
  const { enabled = true, echoMs = DEFAULT_ECHO_MS, shouldRefetch, selfEchoOnly = false } = opts;
  const mutatedAtRef = useRef<number>(0);

  const active = useRealtimeTopic(
    topic,
    (event) => {
      if (Date.now() - mutatedAtRef.current < echoMs) return;
      // selfEchoOnly: skip the shared cross-hook registry so a sibling keep-alive
      // view's mutation can't suppress this subscription's refetch.
      if (!selfEchoOnly && topic && mutatedWithin(topic, echoMs)) return;
      if (shouldRefetch && !shouldRefetch(event)) return;
      refetch(event);
    },
    enabled,
  );

  // Stable identity so callers can list it in dependency arrays without churn.
  const markLocalMutation = useCallback(() => {
    mutatedAtRef.current = Date.now();
    markRealtimeMutation(topic);
  }, [topic]);

  return { markLocalMutation, active };
}
