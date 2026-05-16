// _copy.mjs — NDJSON I/O + batched parameterized INSERT for OLD → PROD import.
//
// Why NDJSON: one row per line, streaming, language-agnostic, easy to inspect
// with `head/tail/wc -l` during a long import.
//
// Why batched INSERT (not COPY): for our scale (~165K rows max table), batched
// parameterized INSERT is fast enough (~30s for the biggest table) and keeps
// the four conflict-policy modes (FAIL_BY_DEFAULT / SKIP_IF_IDENTICAL /
// OVERWRITE / RESUME_DO_NOTHING) that COPY can't express.

import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { CONFLICT_POLICY, AUTH_CONFLICT_POLICY, buildConflictSql, getConflictTarget } from './_mapping.mjs';
import { sha256OfRow, authUserFingerprint, isAuthUserRowIdentical } from './_checksums.mjs';
import { redactEmail } from './_lib.mjs';

/**
 * Stream rows to an NDJSON file. Awaits backpressure.
 *
 * @param {string} path
 * @param {AsyncIterable<object>} rows
 * @returns {Promise<{rowCount: number, bytes: number}>}
 */
export async function writeNdjson(path, rows) {
  const stream = createWriteStream(path, { encoding: 'utf8' });
  let rowCount = 0;
  let bytes = 0;
  try {
    for await (const row of rows) {
      const line = JSON.stringify(row) + '\n';
      bytes += Buffer.byteLength(line, 'utf8');
      if (!stream.write(line)) {
        await new Promise((resolve) => stream.once('drain', resolve));
      }
      rowCount++;
    }
  } finally {
    await new Promise((resolve, reject) => {
      stream.end((err) => (err ? reject(err) : resolve()));
    });
  }
  return { rowCount, bytes };
}

/**
 * Stream rows from an NDJSON file. Yields parsed objects one at a time.
 *
 * @param {string} path
 * @returns {AsyncIterable<object>}
 */
export async function* readNdjson(path) {
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    if (line.trim() === '') continue;
    try {
      yield JSON.parse(line);
    } catch (e) {
      throw new Error(`Invalid NDJSON at ${path}:${lineNo}: ${e.message}`);
    }
  }
}

/**
 * PostgreSQL Bind-message parameter-count safety cap.
 *
 * PG protocol Int16-encodes the parameter list length; pg-node treats it as
 * signed (max 32767) and will throw or get OOPS-ed by the server with
 * `bind message has N parameter formats but 0 parameters` when this is
 * exceeded. Even when pg-node accepts higher values, the server may still
 * misbehave above 32767.
 *
 * We cap to 30000 to leave a safety margin. Sub-batching is automatic in
 * `batchInsert`: if `rows * columns > 30000`, we split the rows into chunks
 * of size `floor(30000 / columns)` and INSERT each chunk separately.
 *
 * For a 23-column table (e.g. public.client_positions) this caps to ~1304
 * rows per Bind message — well below 32767 even at peak.
 */
const PG_BIND_PARAM_CAP = 30000;

/**
 * Per-table column-type cache. Keys: `schema.table`. Values: Map<colName, {data_type, udt_name}>.
 *
 * Why: pg-node's auto-inference treats JS arrays as PostgreSQL array literals
 * (`{...}`). For a `jsonb` target column, PG then refuses the value
 * (`invalid input syntax for type json`). For a real `text[]` target column,
 * pg-node's default IS correct. So we must dispatch per column type.
 *
 * Lookup is performed lazily, cached for the lifetime of the import (the
 * import-script process runs once per migration).
 */
const __columnTypeCache = new Map();
async function getColumnTypes(client, schema, table) {
  const key = `${schema}.${table}`;
  if (__columnTypeCache.has(key)) return __columnTypeCache.get(key);
  const { rows } = await client.query(
    `SELECT column_name, data_type, udt_name
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2`,
    [schema, table],
  );
  const m = new Map();
  for (const r of rows) m.set(r.column_name, { data_type: r.data_type, udt_name: r.udt_name });
  __columnTypeCache.set(key, m);
  return m;
}

/**
 * Insert a batch of rows into PROD according to a conflict policy.
 *
 * Modes (selected by `opts.policy`):
 *   - FAIL_BY_DEFAULT: plain INSERT. PG raises unique-violation on duplicate;
 *     we re-throw with a clear `{table, conflictKey, hint}`.
 *   - SKIP_IF_IDENTICAL: SELECT-existing per row → compare row fingerprint;
 *     if equal, skip; if differs, throw with diff hint. Inserts the rest as
 *     FAIL_BY_DEFAULT.
 *   - OVERWRITE_REQUIRES_TWO_KEY_GUARD: ON CONFLICT (pk) DO UPDATE SET …
 *     Caller MUST have verified ALLOW_PROD_OVERWRITE=true and the CLI flag.
 *   - RESUME_DO_NOTHING: ON CONFLICT (pk) DO NOTHING. Only used during
 *     --resume for rows already marked completed.
 *
 * Returns {inserted, skipped_identical, overwritten, errors[]} aggregate.
 * On policy-violation (FAIL duplicate, SKIP_IF_IDENTICAL mismatch) the error
 * is thrown — the importer's per-table loop handles abort/resume semantics.
 *
 * @param {object} client - pg.Client connected to PROD
 * @param {object} opts
 *   @param {string} opts.schema  - 'public' or 'auth'
 *   @param {string} opts.table   - table name
 *   @param {string[]} opts.columns - columns to insert (subset of row keys)
 *   @param {object[]} opts.rows  - rows to insert
 *   @param {string} opts.policy  - one of CONFLICT_POLICY values
 * @returns {Promise<{inserted: number, skipped_identical: number, overwritten: number}>}
 */
export async function batchInsert(client, { schema, table, columns, rows, policy }) {
  if (rows.length === 0) return { inserted: 0, skipped_identical: 0, overwritten: 0 };
  if (!policy) throw new Error('batchInsert requires opts.policy');

  // SKIP_IF_IDENTICAL takes a different path — we filter rows in-app before
  // INSERT to surface diffs explicitly.
  if (policy === CONFLICT_POLICY.SKIP_IF_IDENTICAL) {
    return batchInsertSkipIfIdentical(client, { schema, table, columns, rows });
  }

  // AUTH_FAIL_BY_DEFAULT is treated like FAIL_BY_DEFAULT but with auth-aware
  // error messages and masked email diagnostics.
  if (policy === AUTH_CONFLICT_POLICY.AUTH_FAIL_BY_DEFAULT) {
    return batchInsertAuthFailFast(client, { schema, table, columns, rows });
  }

  // AUTH_RESUME_IF_IDENTICAL_ONLY is SKIP-style but with strict auth-row
  // comparison (non-password fields + sha256(encrypted_password)).
  if (policy === AUTH_CONFLICT_POLICY.AUTH_RESUME_IF_IDENTICAL_ONLY) {
    return batchInsertAuthResumeIfIdentical(client, { schema, table, columns, rows });
  }

  const conflictSql = buildConflictSql(table, columns, policy);
  // null means caller used a path that's not supported here.
  if (conflictSql === null) {
    throw new Error(`batchInsert: policy ${policy} requires SELECT-first path on ${schema}.${table}`);
  }

  // Sub-batch if rows * columns exceeds the PG Bind parameter cap. This is
  // independent of the caller's batchSize: a wide table (e.g. 23-col
  // client_positions) at batch=5000 produces 115k params, which violates the
  // PG Int16 limit. We split internally and aggregate the result counts.
  const maxRowsPerInsert = Math.max(1, Math.floor(PG_BIND_PARAM_CAP / Math.max(1, columns.length)));
  if (rows.length > maxRowsPerInsert) {
    let agg = { inserted: 0, skipped_identical: 0, overwritten: 0 };
    for (let i = 0; i < rows.length; i += maxRowsPerInsert) {
      const slice = rows.slice(i, i + maxRowsPerInsert);
      const r = await batchInsert(client, { schema, table, columns, rows: slice, policy });
      agg.inserted += r.inserted ?? 0;
      agg.skipped_identical += r.skipped_identical ?? 0;
      agg.overwritten += r.overwritten ?? 0;
    }
    return agg;
  }

  const cols = columns.map((c) => `"${c}"`).join(', ');
  const valuesSql = rows
    .map((_, rowIdx) =>
      '(' +
      columns
        .map((_, colIdx) => `$${rowIdx * columns.length + colIdx + 1}`)
        .join(', ') +
      ')'
    )
    .join(', ');

  // Look up target column types once per batch — needed to decide
  // jsonb-array vs text[]-array serialization (see normalizeForPg).
  const colTypes = await getColumnTypes(client, schema, table);
  const params = [];
  for (const row of rows) {
    for (const c of columns) {
      params.push(normalizeForPg(row[c], colTypes.get(c)));
    }
  }

  const sql = `INSERT INTO "${schema}"."${table}" (${cols}) VALUES ${valuesSql}${conflictSql ? ' ' + conflictSql : ''}`;
  let res;
  try {
    res = await client.query(sql, params);
  } catch (e) {
    if (e && e.code === '23505' && policy === CONFLICT_POLICY.FAIL_BY_DEFAULT) {
      // unique_violation: surface table + (best-effort) conflict key, never row values.
      const { conflictTarget } = getConflictTarget(table);
      const err = new Error(
        `Duplicate key on ${schema}.${table}: ${e.detail ? '(' + e.detail.replace(/=\([^)]*\)/g, '=(<redacted>)') + ')' : 'unique_violation'} on ${conflictTarget}. ` +
        `Resolve: pass --allow-overwrite + ALLOW_PROD_OVERWRITE=true to update, ` +
        `or --clean-prod + ALLOW_CLEAN_PROD=true to wipe target tables first, ` +
        `or manually delete the conflicting row.`
      );
      err.code = '23505';
      err.table = `${schema}.${table}`;
      throw err;
    }
    throw e;
  }
  const affected = res.rowCount ?? 0;
  if (policy === CONFLICT_POLICY.OVERWRITE_REQUIRES_TWO_KEY_GUARD) {
    // PG returns total affected (inserted + updated). We can't distinguish
    // exactly without RETURNING, but for reporting we attribute all as
    // overwritten when the input batch length matches affected.
    return { inserted: 0, skipped_identical: 0, overwritten: affected };
  }
  return { inserted: affected, skipped_identical: 0, overwritten: 0 };
}

/**
 * SKIP_IF_IDENTICAL path: for each row, SELECT the existing row in PROD; if
 * every (table_columns ∩ row_columns) value matches via sha256OfRow, skip-
 * and-report. If any column differs, throw with a redacted diff hint. Rows
 * not found in PROD fall through to a FAIL_BY_DEFAULT batch insert.
 */
async function batchInsertSkipIfIdentical(client, { schema, table, columns, rows }) {
  const { pkColumns } = getConflictTarget(table);
  if (pkColumns.length === 0) {
    throw new Error(`SKIP_IF_IDENTICAL requires PK; ${table} has none`);
  }
  let skipped = 0;
  const toInsert = [];

  const colTypes = await getColumnTypes(client, schema, table);
  for (const row of rows) {
    const whereSql = pkColumns.map((c, i) => `"${c}" = $${i + 1}`).join(' AND ');
    const cols = columns.map((c) => `"${c}"`).join(', ');
    const params = pkColumns.map((c) => normalizeForPg(row[c], colTypes.get(c)));
    const { rows: existing } = await client.query(
      `SELECT ${cols} FROM "${schema}"."${table}" WHERE ${whereSql} LIMIT 1`,
      params,
    );
    if (existing.length === 0) {
      toInsert.push(row);
      continue;
    }
    const exportFp = sha256OfRow(pickColumns(row, columns));
    const prodFp = sha256OfRow(pickColumns(existing[0], columns));
    if (exportFp === prodFp) {
      skipped++;
      continue;
    }
    // Row exists but differs — surface column-level diff WITHOUT values.
    const diffCols = columns.filter((c) => sha256OfRow({ v: row[c] }) !== sha256OfRow({ v: existing[0][c] }));
    const keyDesc = pkColumns.map((c) => `${c}=${redactKeyValue(row[c])}`).join(', ');
    const err = new Error(
      `SKIP_IF_IDENTICAL mismatch on ${schema}.${table} (${keyDesc}): ` +
      `${diffCols.length} column(s) differ: [${diffCols.join(', ')}]. ` +
      `Resolve: use --allow-overwrite + ALLOW_PROD_OVERWRITE=true to overwrite, ` +
      `or manually align the row.`
    );
    err.code = 'SKIP_IF_IDENTICAL_MISMATCH';
    err.table = `${schema}.${table}`;
    throw err;
  }

  let inserted = 0;
  if (toInsert.length > 0) {
    const r = await batchInsert(client, {
      schema, table, columns, rows: toInsert,
      policy: CONFLICT_POLICY.FAIL_BY_DEFAULT,
    });
    inserted = r.inserted;
  }
  return { inserted, skipped_identical: skipped, overwritten: 0 };
}

/**
 * AUTH_FAIL_BY_DEFAULT: plain INSERT into auth.users / auth.identities.
 * On unique-violation (id, email, or provider+provider_id) — surface a
 * redacted diagnostic and remediation hint. NEVER prints encrypted_password,
 * tokens, or full emails (emails are masked through redactEmail).
 */
async function batchInsertAuthFailFast(client, { schema, table, columns, rows }) {
  // Sub-batch if exceeding PG Bind param cap (same logic as batchInsert).
  const maxRowsPerInsert = Math.max(1, Math.floor(PG_BIND_PARAM_CAP / Math.max(1, columns.length)));
  if (rows.length > maxRowsPerInsert) {
    let agg = { inserted: 0, skipped_identical: 0, overwritten: 0 };
    for (let i = 0; i < rows.length; i += maxRowsPerInsert) {
      const slice = rows.slice(i, i + maxRowsPerInsert);
      const r = await batchInsertAuthFailFast(client, { schema, table, columns, rows: slice });
      agg.inserted += r.inserted ?? 0;
    }
    return agg;
  }
  const cols = columns.map((c) => `"${c}"`).join(', ');
  const valuesSql = rows
    .map((_, rowIdx) =>
      '(' +
      columns.map((_, colIdx) => `$${rowIdx * columns.length + colIdx + 1}`).join(', ') +
      ')'
    )
    .join(', ');
  const colTypes = await getColumnTypes(client, schema, table);
  const params = [];
  for (const row of rows) {
    for (const c of columns) params.push(normalizeForPg(row[c], colTypes.get(c)));
  }
  const sql = `INSERT INTO "${schema}"."${table}" (${cols}) VALUES ${valuesSql}`;
  try {
    const res = await client.query(sql, params);
    return { inserted: res.rowCount ?? 0, skipped_identical: 0, overwritten: 0 };
  } catch (e) {
    if (e && e.code === '23505') {
      // Strip potential PII from PG detail message.
      const safeDetail = (e.detail || '').replace(/=\([^)]*\)/g, '=(<redacted>)');
      const err = new Error(
        `Auth conflict on ${schema}.${table}: ${safeDetail || 'unique_violation'}. ` +
        `Auth tables are NEVER overwritten and ALLOW_PROD_OVERWRITE does not apply here. ` +
        `Resolve: re-run with --resume (only allows skip when row is byte-equal + sha256(encrypted_password) matches), ` +
        `or run :prepare to surface the precise collision list, ` +
        `or use --clean-prod + ALLOW_CLEAN_PROD=true with extreme caution (drops PROD auth rows).`,
      );
      err.code = '23505';
      err.table = `${schema}.${table}`;
      throw err;
    }
    throw e;
  }
}

/**
 * AUTH_RESUME_IF_IDENTICAL_ONLY: only used during --resume.
 * For each row: SELECT existing PROD row by PK; if not present, INSERT
 * (FAIL_BY_DEFAULT semantics); if present, compare every column (excluding
 * encrypted_password) by sha256 fingerprint AND compare sha256(encrypted_password).
 * On match → silently skip (counted as skipped_identical).
 * On mismatch → throw with masked diagnostic; no values logged.
 */
async function batchInsertAuthResumeIfIdentical(client, { schema, table, columns, rows }) {
  const { pkColumns } = getConflictTarget(table);
  if (pkColumns.length === 0) throw new Error(`AUTH_RESUME requires PK; ${table} has none`);
  let skipped = 0;
  const toInsert = [];

  const colTypes = await getColumnTypes(client, schema, table);
  for (const row of rows) {
    const whereSql = pkColumns.map((c, i) => `"${c}" = $${i + 1}`).join(' AND ');
    const colsSql = columns.map((c) => `"${c}"`).join(', ');
    const params = pkColumns.map((c) => normalizeForPg(row[c], colTypes.get(c)));
    const { rows: existing } = await client.query(
      `SELECT ${colsSql} FROM "${schema}"."${table}" WHERE ${whereSql} LIMIT 1`,
      params,
    );
    if (existing.length === 0) {
      toInsert.push(row);
      continue;
    }
    let cmp;
    if (table === 'users' && schema === 'auth') {
      cmp = isAuthUserRowIdentical(row, existing[0]);
    } else {
      // For auth.identities: compare full row fingerprint (no password column).
      const sameFp = authUserFingerprint(pickColumns(row, columns)) === authUserFingerprint(pickColumns(existing[0], columns));
      cmp = { identical: sameFp, reason: sameFp ? null : 'fields differ' };
    }
    if (cmp.identical) {
      skipped++;
      continue;
    }
    const keyDesc = pkColumns.map((c) => `${c}=${redactKeyValue(row[c])}`).join(', ');
    const emailDesc = row.email ? ` email=${redactEmail(row.email)}` : '';
    const err = new Error(
      `Auth resume mismatch on ${schema}.${table} (${keyDesc}${emailDesc}): ${cmp.reason}. ` +
      `--resume only skips rows whose PROD copy is byte-equal AND has the same sha256(encrypted_password). ` +
      `Resolve: align manually or restart without --resume after clearing import_state.json.`,
    );
    err.code = 'AUTH_RESUME_MISMATCH';
    err.table = `${schema}.${table}`;
    throw err;
  }

  let inserted = 0;
  if (toInsert.length > 0) {
    const r = await batchInsertAuthFailFast(client, { schema, table, columns, rows: toInsert });
    inserted = r.inserted;
  }
  return { inserted, skipped_identical: skipped, overwritten: 0 };
}

function pickColumns(row, columns) {
  const out = {};
  for (const c of columns) out[c] = row[c];
  return out;
}

/** Mask a PK value for log output: keep first 8 chars of UUID, redact rest. */
function redactKeyValue(v) {
  if (v == null) return 'null';
  const s = String(v);
  if (s.length <= 12) return s; // short codes like roles.code are fine
  return s.slice(0, 8) + '…';
}

/**
 * Some NDJSON values arrive as plain JS values from JSON.parse but pg expects
 * specific shapes. The right shape depends on the TARGET column type:
 *
 *   jsonb / json column:
 *     - JS object → JSON.stringify (text) → PG casts to jsonb
 *     - JS array  → JSON.stringify (text) → PG casts to jsonb (arrays are
 *       valid jsonb). DO NOT pass JS array as-is — pg-node would serialize
 *       it as PG array literal `{...}` which is NOT valid jsonb syntax and
 *       PG rejects with `invalid input syntax for type json`.
 *
 *   ARRAY column (text[], int[]):
 *     - JS array → pass as-is. pg-node serializes to PG array literal `{...}`
 *       which PG correctly parses as an array.
 *     - JSON.stringify here would BREAK text[] (PG sees a literal string
 *       `"[\"a\",\"b\"]"` and refuses to cast to text[]).
 *
 *   Everything else: pass through (PG handles primitives fine).
 *
 * @param {unknown} v - JS value from NDJSON
 * @param {{data_type?: string, udt_name?: string}|undefined} colType
 *   Type info from information_schema.columns. May be undefined when caller
 *   doesn't have it (e.g. auth-schema helpers); in that case we fall back to
 *   "stringify only objects" which is the safe minimum.
 */
function normalizeForPg(v, colType) {
  if (v === undefined) return null;
  if (v === null) return null;

  const isJsonb = colType?.data_type === 'jsonb' || colType?.data_type === 'json';
  const isPgArray = colType?.data_type === 'ARRAY';

  if (typeof v === 'object' && !(v instanceof Date)) {
    if (isJsonb) return JSON.stringify(v);
    if (isPgArray && Array.isArray(v)) return v;
    // Fallback when caller didn't introspect: serialize objects (the historical
    // behavior); leave arrays alone so text[] columns continue to work even
    // without colType context (auth.* paths).
    if (!Array.isArray(v)) return JSON.stringify(v);
    return v;
  }
  return v;
}

/**
 * Temporarily DISABLE the listed triggers on a table, run `fn`, then ENABLE
 * them in a finally block (even on error). Returns whatever `fn` returns.
 *
 * Caller MUST verify ALLOW_DISABLE_IMPORT_TRIGGERS=true before calling.
 *
 * Uses ALTER TABLE ... DISABLE TRIGGER <name> — NEVER session_replication_role
 * (requires superuser; Supabase service_role lacks it).
 */
export async function withTempDisabledTriggers(client, { schema, table, triggerNames }, fn) {
  if (!Array.isArray(triggerNames) || triggerNames.length === 0) {
    return fn();
  }
  // Sanitize identifiers — only allow [a-zA-Z0-9_] (PostgreSQL identifier-safe).
  for (const name of triggerNames) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`unsafe trigger name: ${name}`);
    }
  }

  const disableSql = triggerNames
    .map((t) => `ALTER TABLE "${schema}"."${table}" DISABLE TRIGGER "${t}";`)
    .join('\n');
  const enableSql = triggerNames
    .map((t) => `ALTER TABLE "${schema}"."${table}" ENABLE TRIGGER "${t}";`)
    .join('\n');

  await client.query(disableSql);
  try {
    return await fn();
  } finally {
    // Best-effort re-enable; if this throws we still want the original error
    // (if any) to surface, so we don't swallow it.
    try {
      await client.query(enableSql);
    } catch (e) {
      // Log to stderr; do not throw from finally.
      console.error(`✗ FAILED to re-enable triggers on ${schema}.${table}: ${e.message}`);
      console.error('  Re-enable manually: ' + enableSql);
    }
  }
}

/**
 * Topologically sort rows by a self-referencing FK so parents appear before
 * children. Used for tables in SELF_FK_TABLES (e.g. client_positions:
 * parent_position_id → id). FK violation during INSERT would otherwise fail
 * the import when a child precedes its parent in NDJSON order.
 *
 * Algorithm (Kahn-style, two-phase):
 *   1. Emit all rows with parent IS NULL or parent NOT in row-set (roots /
 *      dangling — dangling means parent points outside this batch; those FKs
 *      will still fail at INSERT but at least we won't artificially block
 *      them on row-order).
 *   2. Repeat: emit rows whose parent is already emitted. Stop when no
 *      progress (cycle) — emit remaining in source order (cycles surface as
 *      FK violations, which is the correct outcome).
 *
 * Stable: rows with no parent dependency preserve their input order.
 *
 * @param {object[]} rows
 * @param {string} idCol
 * @param {string} parentCol
 * @returns {object[]} sorted rows (same length, same elements, no copies)
 */
export function topoSortBySelfFK(rows, idCol, parentCol) {
  if (rows.length <= 1) return rows.slice();
  const allIds = new Set(rows.map((r) => r[idCol]));
  const emitted = new Set();
  const out = [];
  const remaining = rows.slice();

  // Pass 1: roots (parent is null OR parent points outside this batch).
  const next = [];
  for (const r of remaining) {
    const p = r[parentCol];
    if (p == null || !allIds.has(p)) {
      out.push(r);
      emitted.add(r[idCol]);
    } else {
      next.push(r);
    }
  }

  // Subsequent passes: parent already emitted.
  let pool = next;
  while (pool.length > 0) {
    const carry = [];
    let added = 0;
    for (const r of pool) {
      if (emitted.has(r[parentCol])) {
        out.push(r);
        emitted.add(r[idCol]);
        added++;
      } else {
        carry.push(r);
      }
    }
    if (added === 0) {
      // Cycle (or all remaining depend on each other) — emit in input order;
      // any FK violation will be surfaced by PG.
      out.push(...carry);
      break;
    }
    pool = carry;
  }
  return out;
}

/**
 * SELECT * FROM a public-schema table in stable order, yielding rows in batches.
 * Used by 04_export_old.mjs for full-table dumps.
 *
 * ⚠ Uses LIMIT/OFFSET, which is NOT safe on a live table — concurrent inserts
 * can cause row drift between pages (same row in two batches OR missed rows).
 * Prefer `streamTableKeyset` for reliable exports. Kept here for backward
 * compatibility with callers that pass a multi-column `orderBy` we can't
 * trivially translate to keyset.
 */
export async function* streamTable(client, { schema, table, orderBy = 'id', batchSize = 1000 }) {
  // Sanitize orderBy column name.
  if (!/^[a-zA-Z_][a-zA-Z0-9_, ]*$/.test(orderBy)) {
    throw new Error(`unsafe orderBy: ${orderBy}`);
  }
  let offset = 0;
  while (true) {
    const { rows } = await client.query(
      `SELECT * FROM "${schema}"."${table}" ORDER BY ${orderBy} LIMIT $1 OFFSET $2`,
      [batchSize, offset]
    );
    if (rows.length === 0) return;
    for (const r of rows) yield r;
    if (rows.length < batchSize) return;
    offset += batchSize;
  }
}

/**
 * Keyset-paginated streaming SELECT. Safer than OFFSET on live tables (no
 * window shift) and faster on big tables (O(B·log N) cost vs OFFSET's
 * O((N/B)·N)).
 *
 * Works for any sortable PK type — UUID, integer, text — provided the column
 * has unique non-null values and an ORDER-BY-compatible operator class.
 *
 * Inside a `REPEATABLE READ READ ONLY` transaction (which 04_export_old now
 * opens), keyset and OFFSET both produce a consistent snapshot; we choose
 * keyset for the additional speed and to make the dump independent of the
 * snapshot-isolation level (defence in depth).
 */
export async function* streamTableKeyset(client, { schema, table, pkColumn = 'id', batchSize = 1000 }) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(pkColumn)) {
    throw new Error(`unsafe pkColumn: ${pkColumn}`);
  }
  let lastPk = null;
  while (true) {
    const sql = lastPk === null
      ? `SELECT * FROM "${schema}"."${table}" ORDER BY "${pkColumn}" LIMIT $1`
      : `SELECT * FROM "${schema}"."${table}" WHERE "${pkColumn}" > $2 ORDER BY "${pkColumn}" LIMIT $1`;
    const params = lastPk === null ? [batchSize] : [batchSize, lastPk];
    const { rows } = await client.query(sql, params);
    if (rows.length === 0) return;
    for (const r of rows) yield r;
    if (rows.length < batchSize) return;
    lastPk = rows[rows.length - 1][pkColumn];
  }
}

/**
 * Validate NDJSON file for duplicate primary-key values. Returns
 * `{ total, distinct, duplicates, sample_duplicate_pks }`. Used by
 * 04_export_old as a post-export sanity check — duplicates ALWAYS indicate
 * a bug (pagination drift or trigger-induced row duplication on OLD).
 *
 * Memory: O(distinct PKs). For 350k UUIDs ≈ 12 MB Set overhead. Acceptable.
 */
export async function validateNdjsonPks(path, pkColumn = 'id') {
  const seen = new Set();
  let total = 0, duplicates = 0;
  const sample = [];
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.trim() === '') continue;
    total++;
    let pk;
    try { pk = JSON.parse(line)[pkColumn]; } catch { continue; }
    if (pk == null) continue;
    if (seen.has(pk)) {
      duplicates++;
      if (sample.length < 5) sample.push(String(pk).slice(0, 12) + '…');
    } else {
      seen.add(pk);
    }
  }
  return { total, distinct: seen.size, duplicates, sample_duplicate_pks: sample };
}

/**
 * Cheap row count. Trades accuracy for speed only on very large tables;
 * for our scale a plain COUNT(*) is fast enough (single-digit seconds).
 */
export async function countRows(client, schema, table) {
  const { rows: [{ n }] } = await client.query(
    `SELECT COUNT(*)::int AS n FROM "${schema}"."${table}"`
  );
  return n;
}

/**
 * For tables without an `id` column (e.g. roles uses `code`), pick the best
 * stable ordering column.
 */
export function defaultOrderBy(table) {
  switch (table) {
    case 'roles':
    case 'units':
      return 'code';
    default:
      return 'id';
  }
}

// Re-export Writable for consumers that want to pipe arbitrary streams.
export { Writable };
