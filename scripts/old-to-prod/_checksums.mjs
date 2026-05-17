// _checksums.mjs — sha256 helpers for byte-to-byte verification.
//
// Never logs or returns the actual hash payload. Public API exposes only
// boolean "match" results or aggregate counts.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * sha256 of a string. Returned hex digest — caller decides whether to log
 * (for file checksums in manifest.json, OK) or compare locally (for password
 * hashes, NEVER log).
 */
export function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * sha256 of an entire file, streaming (constant memory).
 * Used for manifest.json table checksums.
 */
export async function sha256OfFile(path) {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

/**
 * Compare two encrypted_password values from auth.users. Returns true if they
 * are byte-identical. NEVER returns or logs the hash content; both inputs are
 * compared via constant-ish-time sha256 fingerprint (still timing-leak-prone
 * to a local attacker, but adequate for migration verification).
 *
 * Caller MUST NOT log either input.
 */
export function compareEncryptedPasswords(oldHash, prodHash) {
  if (oldHash == null && prodHash == null) return true; // both OAuth-only
  if (oldHash == null || prodHash == null) return false; // one side missing
  if (oldHash.length !== prodHash.length) return false;
  return sha256(oldHash) === sha256(prodHash);
}

/**
 * Compute a deterministic row checksum for verification. Used to detect
 * accidental column drift between OLD export and PROD import.
 *
 * The input MUST be a plain object with primitive-serializable fields.
 * Order-stable: keys are sorted alphabetically.
 */
export function sha256OfRow(row) {
  const keys = Object.keys(row).sort();
  const serialized = keys.map((k) => `${k}=${jsonStable(row[k])}`).join('');
  return sha256(serialized);
}

function jsonStable(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

/**
 * SQL that computes a deterministic md5 fingerprint of a whole table by
 * concatenating each row's text representation in stable PK order.
 *
 * Pitfalls:
 *   - jsonb columns may have different in-memory key order on OLD vs PROD
 *     after import. If the table has jsonb, set `hasJsonb: true` so the
 *     caller can downgrade VERIFY_OK to VERIFY_OK_WITH_WARNINGS on mismatch.
 *   - Columns of type bytea / encrypted_password leak into text() output.
 *     For auth.users we deliberately DO NOT compute this checksum — see
 *     08_verify_auth.mjs for the row-by-row sha256 path that never logs.
 *
 * @param {string} schema
 * @param {string} table
 * @param {string} orderBy - PK column expression (e.g. "id" or "code" or "tender_id, name")
 * @returns {string} SQL returning one row with one md5 column called "checksum"
 */
export function tableChecksumSql(schema, table, orderBy = 'id') {
  // Identifier safety: schema/table validated by caller; orderBy allowed chars only.
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error(`unsafe schema: ${schema}`);
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error(`unsafe table: ${table}`);
  if (!/^[a-zA-Z_][a-zA-Z0-9_, ]*$/.test(orderBy)) throw new Error(`unsafe orderBy: ${orderBy}`);
  // md5(string_agg(t::text, ',' ORDER BY <pk>)) — `t::text` gives PG's stable
  // tuple text rep including jsonb canonical form. NULL aggregates to NULL,
  // which we coalesce to empty md5 of empty string.
  return `SELECT COALESCE(md5(string_agg(t::text, ',' ORDER BY ${orderBy})), md5('')) AS checksum
            FROM "${schema}"."${table}" t`;
}

/** md5 hex of a string (node crypto) — used to fold chunk digests. */
function md5(input) {
  return createHash('md5').update(input).digest('hex');
}

/**
 * Default chunk size for the chunked heavy-table checksum. A single
 * md5(string_agg(t::text ORDER BY pk)) over 100k–400k rows (esp. tables with
 * large jsonb columns like boq_items) pegs CPU / exceeds statement timeout on
 * the Supabase pooler. Computing per-keyset-chunk digests and folding them is
 * bounded per query and still fully deterministic.
 */
export const HEAVY_CHECKSUM_CHUNK = 10000;

/**
 * Chunked, deterministic table checksum for heavy tables. Walks the table by
 * keyset on `orderBy` (a single PK column), computing
 * `md5(string_agg(t::text, ',' ORDER BY pk))` over each chunk, then folds the
 * ordered chunk digests via md5. Uses PG's own `t::text` (same canonical
 * representation as tableChecksumSql) — NOT a JS row serialization — so it is
 * byte-identical OLD↔PROD when run with the SAME `chunkSize` + raw type
 * parsers + UTC/ISO session. Caller MUST persist the chunkSize so verify
 * recomputes with the identical partitioning.
 *
 * @param {object} client - connected pg client (raw parsers + UTC/ISO)
 * @param {{schema:string, table:string, orderBy?:string, chunkSize?:number}} o
 * @returns {Promise<string>} md5 hex digest
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
                COUNT(*)::int AS n, MAX("${orderBy}")::text AS maxpk
         FROM chunk c`
      : `WITH chunk AS (
           SELECT * FROM "${schema}"."${table}" WHERE "${orderBy}" > $2 ORDER BY "${orderBy}" LIMIT $1
         )
         SELECT COALESCE(md5(string_agg(c::text, ',' ORDER BY "${orderBy}")), md5('')) AS d,
                COUNT(*)::int AS n, MAX("${orderBy}")::text AS maxpk
         FROM chunk c`;
    const params = lastPk === null ? [lim] : [lim, lastPk];
    const { rows: [r] } = await client.query(sql, params);
    if (!r || r.n === 0) break;
    chunkDigests.push(r.d);
    if (r.n < lim) break;
    lastPk = r.maxpk;
  }
  if (chunkDigests.length === 0) return md5(''); // empty table — same as tableChecksumSql NULL path
  // Deterministic fold of ordered chunk digests.
  return md5(chunkDigests.join(','));
}

/**
 * Compute a stable fingerprint of an auth.users row for collision detection
 * and identical-resume comparisons. Excludes `encrypted_password` from the
 * payload — that column is compared separately via sha256 below.
 *
 * Returns a hex digest. NEVER returns or logs `encrypted_password` content.
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
 * Compare two auth.users rows for AUTH_RESUME_IF_IDENTICAL_ONLY semantics.
 * Returns:
 *   { identical: boolean, reason: string|null }
 * `reason` is a short, safe diagnostic — masked email at most, no values.
 */
export function isAuthUserRowIdentical(exportRow, prodRow) {
  const fpA = authUserFingerprint(exportRow);
  const fpB = authUserFingerprint(prodRow);
  if (fpA !== fpB) return { identical: false, reason: 'non-password fields differ' };
  // Password compare via sha256 (constant-output, never logged).
  const pwOk = compareEncryptedPasswords(exportRow.encrypted_password, prodRow.encrypted_password);
  if (!pwOk) return { identical: false, reason: 'encrypted_password sha256 differs' };
  return { identical: true, reason: null };
}

/**
 * Tables known to contain jsonb columns whose key order may legitimately
 * differ between OLD and PROD even when content is semantically equal. A
 * checksum mismatch on these is a WARNING, not a hard failure.
 */
export const JSONB_TABLES = new Set([
  'tenders',          // (none in baseline, but future-proof)
  'tender_registry',  // chronology_items, tender_package_items
  'markup_tactics',   // sequences, base_costs
  'boq_items_audit',  // old_data, new_data, changed_fields
  'roles',            // allowed_pages
  'users',            // allowed_pages, tender_deadline_extensions
  'import_sessions',  // positions_snapshot
  'cost_redistribution_results', // redistribution_rules
]);
