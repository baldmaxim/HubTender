// _copy.mjs — NDJSON I/O + batched parameterized INSERT for PROD → Yandex.
//
// Ported from scripts/old-to-prod/_copy.mjs. Generic over any connected pg
// client (PROD Supabase for export reads, Yandex for import writes).
//
// Why NDJSON: one row per line, streaming, language-agnostic, inspectable.
// Why batched INSERT (not COPY): keeps fail-by-default conflict detection and
// the optional resume DO-NOTHING mode. Target is verified empty before import,
// so the default policy is a plain INSERT that raises on any duplicate PK.

import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { sha256OfRow } from './_checksums.mjs';
import { pkColumnsFor } from './_tables.mjs';
import { redactEmail } from './_lib.mjs';

/** Stream rows to an NDJSON file. Awaits backpressure. */
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

/** Stream rows from an NDJSON file. Yields parsed objects one at a time. */
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

// PG Bind-message Int16 param-count cap. Stay well under 32767.
const PG_BIND_PARAM_CAP = 30000;

// Per-target column-type cache. jsonb/json vs text[] need different shapes.
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
 * NDJSON values from JSON.parse need PG-correct shapes by TARGET column type:
 *   - jsonb/json: raw PG canonical text string passes straight through (raw
 *     parsers store it as a string in NDJSON); objects fall back to stringify.
 *   - ARRAY (text[], int[]): pass JS array as-is (pg serializes to {...}).
 *   - else: pass through.
 * A JS Date here means raw temporal parsers did not take effect → fail loud.
 */
function normalizeForPg(v, colType) {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) {
    throw new Error(
      'normalizeForPg: received a JS Date for a temporal column — raw temporal ' +
      'parsers are not installed. Aborting to prevent ±1-day / µs corruption.',
    );
  }
  const isJsonb = colType?.data_type === 'jsonb' || colType?.data_type === 'json';
  const isPgArray = colType?.data_type === 'ARRAY';
  if (isJsonb) return typeof v === 'string' ? v : JSON.stringify(v);
  if (typeof v === 'object') {
    if (isPgArray && Array.isArray(v)) return v;
    if (!Array.isArray(v)) return JSON.stringify(v);
    return v;
  }
  return v;
}

function redactKeyValue(v) {
  if (v == null) return 'null';
  const s = String(v);
  return s.length <= 12 ? s : s.slice(0, 8) + '…';
}

/**
 * Insert a batch of rows into the target.
 *   policy 'FAIL_BY_DEFAULT'  — plain INSERT; PG raises 23505 on duplicate.
 *   policy 'RESUME_DO_NOTHING'— ON CONFLICT (pk) DO NOTHING (resume only).
 * Auto sub-batches when rows*columns exceeds the Bind param cap. Returns
 * { inserted, skipped }.
 */
export async function batchInsert(client, { schema, table, columns, rows, policy = 'FAIL_BY_DEFAULT', auth = false }) {
  if (rows.length === 0) return { inserted: 0, skipped: 0 };

  const maxRowsPerInsert = Math.max(1, Math.floor(PG_BIND_PARAM_CAP / Math.max(1, columns.length)));
  if (rows.length > maxRowsPerInsert) {
    const agg = { inserted: 0, skipped: 0 };
    for (let i = 0; i < rows.length; i += maxRowsPerInsert) {
      const r = await batchInsert(client, {
        schema, table, columns, rows: rows.slice(i, i + maxRowsPerInsert), policy, auth,
      });
      agg.inserted += r.inserted;
      agg.skipped += r.skipped;
    }
    return agg;
  }

  const cols = columns.map((c) => `"${c}"`).join(', ');
  const valuesSql = rows
    .map((_, ri) => '(' + columns.map((__, ci) => `$${ri * columns.length + ci + 1}`).join(', ') + ')')
    .join(', ');
  const colTypes = await getColumnTypes(client, schema, table);
  const params = [];
  for (const row of rows) {
    for (const c of columns) params.push(normalizeForPg(row[c], colTypes.get(c)));
  }

  let conflictSql = '';
  if (policy === 'RESUME_DO_NOTHING') {
    const pk = pkColumnsFor(table);
    conflictSql = ` ON CONFLICT (${pk.map((c) => `"${c}"`).join(', ')}) DO NOTHING`;
  }

  const sql = `INSERT INTO "${schema}"."${table}" (${cols}) VALUES ${valuesSql}${conflictSql}`;
  try {
    const res = await client.query(sql, params);
    const affected = res.rowCount ?? 0;
    return { inserted: affected, skipped: rows.length - affected };
  } catch (e) {
    if (e && e.code === '23505') {
      const pk = pkColumnsFor(table).join(', ');
      const safeDetail = (e.detail || '').replace(/=\([^)]*\)/g, '=(<redacted>)');
      const err = new Error(
        `Duplicate key on ${schema}.${table} (${pk}): ${safeDetail || 'unique_violation'}. ` +
        (auth
          ? 'Auth tables are NEVER overwritten. '
          : '') +
        `The Yandex target must be empty before import. Resolve: re-run with ` +
        `--clean-yandex --confirm + ALLOW_CLEAN_YANDEX=true to wipe target tables, ` +
        `or --resume to skip already-imported rows. (--allow-overwrite is NOT supported.)`,
      );
      err.code = '23505';
      err.table = `${schema}.${table}`;
      throw err;
    }
    if (e && e.code === '23503') {
      // FK violation — surface table + constraint, never row values.
      const err = new Error(
        `Foreign-key violation inserting into ${schema}.${table}` +
        (e.constraint ? ` (constraint ${e.constraint})` : '') +
        '. A parent row was not imported yet — check import order / NDJSON ' +
        'completeness. No row values logged.',
      );
      err.code = '23503';
      err.table = `${schema}.${table}`;
      throw err;
    }
    throw e;
  }
}

/**
 * Temporarily DISABLE the listed triggers on a table, run fn, then ENABLE in
 * finally (even on error). Caller MUST verify ALLOW_DISABLE_IMPORT_TRIGGERS=true.
 * Uses ALTER TABLE ... DISABLE TRIGGER <name> — NEVER session_replication_role,
 * NEVER system/internal triggers.
 */
export async function withTempDisabledTriggers(client, { schema, table, triggerNames }, fn) {
  if (!Array.isArray(triggerNames) || triggerNames.length === 0) return fn();
  for (const name of triggerNames) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`unsafe trigger name: ${name}`);
  }
  const disableSql = triggerNames.map((t) => `ALTER TABLE "${schema}"."${table}" DISABLE TRIGGER "${t}";`).join('\n');
  const enableSql = triggerNames.map((t) => `ALTER TABLE "${schema}"."${table}" ENABLE TRIGGER "${t}";`).join('\n');
  await client.query(disableSql);
  try {
    return await fn();
  } finally {
    try {
      await client.query(enableSql);
    } catch (e) {
      console.error(`✗ FAILED to re-enable triggers on ${schema}.${table}: ${e.message}`);
      console.error('  Re-enable manually: ' + enableSql);
    }
  }
}

/**
 * Discover which of `candidateNames` actually exist as NON-internal user
 * triggers on schema.table of the target. Returns the present subset.
 */
export async function discoverTriggers(client, schema, table, candidateNames) {
  if (!candidateNames || candidateNames.length === 0) return [];
  const { rows } = await client.query(
    `SELECT t.tgname
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2
        AND NOT t.tgisinternal
        AND t.tgname = ANY($3)`,
    [schema, table, candidateNames],
  );
  return rows.map((r) => r.tgname).filter((n) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(n));
}

/**
 * Topologically sort rows by a self-referencing FK so parents precede children
 * (Kahn-style, stable). Cycles emit remaining in source order (FK violation
 * surfaces correctly).
 */
export function topoSortBySelfFK(rows, idCol, parentCol) {
  if (rows.length <= 1) return rows.slice();
  const allIds = new Set(rows.map((r) => r[idCol]));
  const emitted = new Set();
  const out = [];
  const next = [];
  for (const r of rows) {
    const p = r[parentCol];
    if (p == null || !allIds.has(p)) { out.push(r); emitted.add(r[idCol]); }
    else next.push(r);
  }
  let pool = next;
  while (pool.length > 0) {
    const carry = [];
    let added = 0;
    for (const r of pool) {
      if (emitted.has(r[parentCol])) { out.push(r); emitted.add(r[idCol]); added++; }
      else carry.push(r);
    }
    if (added === 0) { out.push(...carry); break; }
    pool = carry;
  }
  return out;
}

/**
 * Keyset-paginated streaming SELECT. Safe on live tables (no window shift),
 * fast on big tables. Single sortable PK column required.
 */
export async function* streamTableKeyset(client, { schema, table, pkColumn = 'id', batchSize = 1000 }) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(pkColumn)) throw new Error(`unsafe pkColumn: ${pkColumn}`);
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
 * Validate an NDJSON file for duplicate primary-key values. Returns
 * { total, distinct, duplicates, sample_duplicate_pks }. Duplicates ALWAYS
 * indicate export inconsistency (pagination drift / trigger artefacts).
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

/** Cheap exact row count. */
export async function countRows(client, schema, table) {
  const { rows: [{ n }] } = await client.query(
    `SELECT COUNT(*)::int AS n FROM "${schema}"."${table}"`,
  );
  return n;
}

/** to_regclass-based existence check (schema-qualified). */
export async function tableExists(client, schema, table) {
  const { rows } = await client.query('SELECT to_regclass($1) AS reg', [`${schema}.${table}`]);
  return rows[0]?.reg != null;
}

export { sha256OfRow, redactKeyValue, redactEmail };
