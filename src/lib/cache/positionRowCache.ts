// Per-row cache for ClientPosition records, backed by localStorage so that
// rows registered on the ClientPositions page (parent tab) are instantly
// readable from PositionItems opened via window.open() (child tab).
//
// TTL: 60 s. Storage is best-effort: any quota or parse error is swallowed
// and treated as a cache miss so the caller falls back to a real fetch.

import type { ClientPosition } from '../types';

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

// Sweep expired/corrupt entries from this cache's namespace. Keeps the cache
// bounded to roughly the rows touched within the TTL window, instead of letting
// per-id keys accumulate forever (which eventually exhausts the localStorage
// quota and breaks unrelated writers like the auth session).
function pruneExpired(now: number): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      try {
        const raw = localStorage.getItem(k);
        const parsed = raw ? (JSON.parse(raw) as Entry) : null;
        if (!parsed || typeof parsed.ts !== 'number' || now - parsed.ts > TTL_MS) {
          stale.push(k);
        }
      } catch {
        stale.push(k);
      }
    }
    stale.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore
  }
}

/**
 * Точечная запись ОДНОЙ строки — сид перед навигацией на позицию.
 *
 * Намеренно без pruneExpired: тот сканирует весь localStorage и делает JSON.parse каждой
 * записи (~10-17 мс на 500-1000 строк даже на десктопе, на телефоне кратно больше). В
 * обработчике клика это залипание перед переходом — ради одного ключа скан не нужен.
 * Границы кэша держат TTL на чтении (getRow удаляет протухшее) и bulk-setRows на загрузке
 * списка позиций.
 */
export function setRow(row: ClientPosition): void {
  const entry = JSON.stringify({ row, ts: Date.now() });
  try {
    localStorage.setItem(key(row.id), entry);
  } catch {
    // Квота — единственный случай, когда скан оправдан: чистим протухшее и пробуем ещё раз.
    // В отличие от setRows НЕ зовём invalidateAll(): затирать весь namespace из-за одной
    // строки нельзя — это обнулило бы гидратацию всех остальных позиций.
    pruneExpired(Date.now());
    try {
      localStorage.setItem(key(row.id), entry);
    } catch {
      // Всё равно не влезло — тихо пропускаем: промах кэша даёт скелетон, а не поломку.
    }
  }
}

export function setRows(rows: ClientPosition[]): void {
  const now = Date.now();
  // Evict stale entries first so the cache can't grow without bound.
  pruneExpired(now);
  for (const row of rows) {
    try {
      localStorage.setItem(key(row.id), JSON.stringify({ row, ts: now }));
    } catch {
      // Quota exceeded — reclaim our whole namespace so we don't leave the
      // store full for other writers, then stop for this batch.
      invalidateAll();
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
