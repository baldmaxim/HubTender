// Drop-in replacement for `useState<boolean>` holding a page/table `loading`
// flag. Behaves exactly like useState, EXCEPT it ignores `setLoading(true)`
// while a realtime WS refetch is in flight (see isRealtimeRefetchActive).
//
// Effect: the initial load and user-initiated actions still show the spinner,
// but realtime-triggered background refetches swap data in silently — no
// flicker on every WS update.
//
// Usage: const [loading, setLoading] = useRealtimeAwareLoading(false);
import { useCallback, useState } from 'react';
import { isRealtimeRefetchActive } from './useRealtimeTopic';

export function useRealtimeAwareLoading(
  initial = false,
): [boolean, (value: boolean) => void] {
  const [loading, setLoadingRaw] = useState<boolean>(initial);

  const setLoading = useCallback((value: boolean) => {
    // Suppress only the "turn on" during a realtime refetch; "turn off" and all
    // non-realtime updates pass through unchanged.
    if (value && isRealtimeRefetchActive()) return;
    setLoadingRaw(value);
  }, []);

  return [loading, setLoading];
}
