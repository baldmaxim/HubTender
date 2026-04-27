// Per-row cache for ClientPosition records, backed by localStorage so that
// rows registered on the ClientPositions page (parent tab) are instantly
// readable from PositionItems opened via window.open() (child tab).
//
// TTL: 60 s. Storage is best-effort: any quota or parse error is swallowed
// and treated as a cache miss so the caller falls back to a real fetch.

import type { ClientPosition } from '../supabase';

const PREFIX = 'hubtender:positionRow:';
const TTL_MS = 60 * 1000;

interface Entry {
  row: ClientPosition;
  ts: number;
}

function key(positionId: string): string {
  return `${PREFIX}${positionId}`;
}

export function getRow(positionId: string): ClientPosition | null {
  try {
    const raw = localStorage.getItem(key(positionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Entry;
    if (!parsed || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > TTL_MS) {
      localStorage.removeItem(key(positionId));
      return null;
    }
    return parsed.row;
  } catch {
    return null;
  }
}

export function setRows(rows: ClientPosition[]): void {
  const now = Date.now();
  for (const row of rows) {
    try {
      localStorage.setItem(key(row.id), JSON.stringify({ row, ts: now }));
    } catch {
      // Quota exceeded — stop trying for this batch; partial cache is fine.
      return;
    }
  }
}

export function invalidateRow(positionId: string): void {
  try {
    localStorage.removeItem(key(positionId));
  } catch {
    // ignore
  }
}

export function invalidateAll(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}
