// _checksums.mjs — sha256 / md5 helpers for byte-to-byte PROD↔Yandex verify.
//
// Ported from scripts/old-to-prod/_checksums.mjs. Never logs or returns the
// actual hash payload for sensitive columns. Public API exposes only boolean
// "match" results or aggregate counts. Raw-type-safe (works with the raw
// json/jsonb/temporal parsers installed by _lib.installPgRawTypeParsers()).

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** sha256 hex of a string. */
export function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

/** sha256 of an entire file, streaming (constant memory). */
export async function sha256OfFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** md5 hex of a string (used to fold chunk digests). */
function md5(input) {
  return createHash('md5').update(input).digest('hex');
}

/**
 * Compare two encrypted_password values byte-identically via sha256 fingerprint.
 * NEVER returns or logs the hash content. Caller MUST NOT log either input.
 */
export function compareEncryptedPasswords(a, b) {
  if (a == null && b == null) return true;      // both OAuth-only / both empty
  if (a == null || b == null) return false;     // one side missing
  if (a.length !== b.length) return false;
  return sha256(a) === sha256(b);
}

function jsonStable(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

/** Deterministic row checksum (keys sorted). Primitive-serializable fields. */
export function sha256OfRow(row) {
  const keys = Object.keys(row).sort();
  return sha256(keys.map((k) => `${k}=${jsonStable(row[k])}`).join(''));
}

/**
 * Fingerprint of an auth.users row EXCLUDING encrypted_password (compared
 * separately, byte-safe). NEVER logs encrypted_password content.
 */
export function authUserFingerprint(row) {
  const safe = {};
  for (const k of Object.keys(row)) {
    if (k === 'encrypted_password') continue;
    safe[k] = row[k];
  }
  return sha256OfRow(safe);
}

/**
 * SQL computing a deterministic md5 fingerprint of a whole table by
 * concatenating each row's text representation in stable PK order. `t::text`
 * gives PG's stable tuple text rep including jsonb canonical form; combined
 * with raw parsers + UTC/ISO it is byte-deterministic PROD↔Yandex.
 *
 * @returns one row, one md5 column "checksum".
 */
export function tableChecksumSql(schema, table, orderBy = 'id') {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error(`unsafe schema: ${schema}`);
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error(`unsafe table: ${table}`);
  if (!/^[a-zA-Z_][a-zA-Z0-9_, ]*$/.test(orderBy)) throw new Error(`unsafe orderBy: ${orderBy}`);
  return `SELECT COALESCE(md5(string_agg(t::text, ',' ORDER BY ${orderBy})), md5('')) AS checksum
            FROM "${schema}"."${table}" t`;
}

/** Default chunk size for the chunked heavy-table checksum. */
export const HEAVY_CHECKSUM_CHUNK = 10000;

/**
 * Chunked deterministic table checksum for heavy tables. Walks the table by
 * keyset on a single-column PK, computing md5(string_agg(t::text ORDER BY pk))
 * per chunk, then folds the ordered chunk digests via md5. Byte-identical
 * PROD↔Yandex when run with the SAME chunkSize + raw parsers + UTC/ISO. The
 * keyset boundary is taken via ORDER BY pk DESC LIMIT 1 (NOT MAX(pk) — there
 * is no max() aggregate for uuid; uuid/int/text all have btree ordering).
 *
 * Caller MUST persist chunkSize so verify recomputes with identical partitioning.
 */
export async function chunkedTableChecksum(client, { schema, table, orderBy = 'id', chunkSize = HEAVY_CHECKSUM_CHUNK }) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error(`unsafe schema: ${schema}`);
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error(`unsafe table: ${table}`);
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(orderBy)) throw new Error(`unsafe orderBy (single col required): ${orderBy}`);
  const lim = Number.isInteger(chunkSize) && chunkSize > 0 ? chunkSize : HEAVY_CHECKSUM_CHUNK;

  const chunkDigests = [];
  let lastPk = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const sql = lastPk === null
      ? `WITH chunk AS (
           SELECT * FROM "${schema}"."${table}" ORDER BY "${orderBy}" LIMIT $1
         )
         SELECT COALESCE(md5(string_agg(c::text, ',' ORDER BY "${orderBy}")), md5('')) AS d,
                COUNT(*)::int AS n,
                (SELECT "${orderBy}"::text FROM chunk ORDER BY "${orderBy}" DESC LIMIT 1) AS maxpk
         FROM chunk c`
      : `WITH chunk AS (
           SELECT * FROM "${schema}"."${table}" WHERE "${orderBy}" > $2 ORDER BY "${orderBy}" LIMIT $1
         )
         SELECT COALESCE(md5(string_agg(c::text, ',' ORDER BY "${orderBy}")), md5('')) AS d,
                COUNT(*)::int AS n,
                (SELECT "${orderBy}"::text FROM chunk ORDER BY "${orderBy}" DESC LIMIT 1) AS maxpk
         FROM chunk c`;
    const params = lastPk === null ? [lim] : [lim, lastPk];
    const { rows: [r] } = await client.query(sql, params);
    if (!r || r.n === 0) break;
    chunkDigests.push(r.d);
    if (r.n < lim) break;
    lastPk = r.maxpk;
  }
  if (chunkDigests.length === 0) return md5(''); // empty table — same as full NULL path
  return md5(chunkDigests.join(','));
}

/**
 * Tables whose jsonb columns may legitimately differ in key order between
 * PROD and Yandex. With raw json/jsonb parsers this should NOT happen (text
 * round-trips identically), but kept for future-proof reporting.
 */
export const JSONB_TABLES = new Set([
  'tender_registry',
  'markup_tactics',
  'boq_items_audit',
  'roles',
  'users',
  'import_sessions',
  'cost_redistribution_results',
]);
