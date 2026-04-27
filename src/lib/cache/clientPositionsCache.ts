// Stale-while-revalidate cache for the ClientPositions page aggregate.
// Persists positions + boqItems + tender per tenderId in sessionStorage so that
// returning to the page after navigation renders instantly from cache while a
// background refetch revalidates against the server.
//
// Storage layer: sessionStorage (per-tab, cleared on tab close).
// TTL: 5 minutes — protects against stale renders if tab stays open all day.
// Quota: write is best-effort; if sessionStorage throws (QuotaExceededError),
// the entry is silently skipped.

const PREFIX = 'hubtender:clientPositions:';
const TTL_MS = 5 * 60 * 1000;

interface CachedAggregate<TPositions, TBoqItems, TTender> {
  positions: TPositions;
  boqItems: TBoqItems;
  tender: TTender;
  ts: number;
}

function key(tenderId: string): string {
  return `${PREFIX}${tenderId}`;
}

export function readCache<TPositions, TBoqItems, TTender>(
  tenderId: string,
): CachedAggregate<TPositions, TBoqItems, TTender> | null {
  try {
    const raw = sessionStorage.getItem(key(tenderId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAggregate<TPositions, TBoqItems, TTender>;
    if (!parsed || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > TTL_MS) {
      sessionStorage.removeItem(key(tenderId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeCache<TPositions, TBoqItems, TTender>(
  tenderId: string,
  positions: TPositions,
  boqItems: TBoqItems,
  tender: TTender,
): void {
  try {
    const payload: CachedAggregate<TPositions, TBoqItems, TTender> = {
      positions,
      boqItems,
      tender,
      ts: Date.now(),
    };
    sessionStorage.setItem(key(tenderId), JSON.stringify(payload));
  } catch {
    // Storage quota exceeded — best effort, ignore.
  }
}

export function dropCache(tenderId: string): void {
  try {
    sessionStorage.removeItem(key(tenderId));
  } catch {
    // ignore
  }
}

export function dropAll(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // ignore
  }
}
