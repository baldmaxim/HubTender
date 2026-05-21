#!/usr/bin/env node
// scripts/app-auth/00_check_app_auth_schema.mjs
//
// READ-ONLY verifier for the Phase 6 app-auth DB layer.
//
// Checks (against YANDEX_DATABASE_URL):
//   * schema  app_auth exists
//   * tables  app_auth.refresh_tokens, app_auth.password_reset_tokens,
//             app_auth.auth_events     (columns + data types)
//   * indexes 4 on refresh_tokens, 3 on password_reset_tokens
//   * column  auth.users.encrypted_password exists (type text)
//
// Output: docs/yandex-migration/31_APP_AUTH_SCHEMA_VERIFY_RESULT.md
// Exit  : 0 = all OK, 1 = any MISSING / TYPE_MISMATCH, 2 = config error.
//
// Never prints DSN or secrets — only host (and only after stripping creds).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const REPORT_PATH = join(REPO_ROOT, 'docs', 'yandex-migration', '31_APP_AUTH_SCHEMA_VERIFY_RESULT.md');

function loadDotenv() {
  const path = join(__dirname, '.env.app-auth');
  try {
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!m) continue;
      if (process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch { /* absent */ }
}

function hostOnly(dsn) {
  try {
    const u = new URL(dsn);
    return `${u.host}${u.pathname || ''}`;
  } catch {
    return '<unparsable>';
  }
}

const EXPECTED_COLUMNS = {
  'app_auth.refresh_tokens': {
    id:              { data_type: 'uuid',        is_nullable: 'NO'  },
    user_id:         { data_type: 'uuid',        is_nullable: 'NO'  },
    token_hash:      { data_type: 'text',        is_nullable: 'NO'  },
    token_family_id: { data_type: 'uuid',        is_nullable: 'NO'  },
    issued_at:       { data_type: 'timestamp with time zone', is_nullable: 'NO'  },
    expires_at:      { data_type: 'timestamp with time zone', is_nullable: 'NO'  },
    revoked_at:      { data_type: 'timestamp with time zone', is_nullable: 'YES' },
    replaced_by:     { data_type: 'uuid',        is_nullable: 'YES' },
    user_agent:      { data_type: 'text',        is_nullable: 'YES' },
    ip_address:      { data_type: 'inet',        is_nullable: 'YES' },
    created_at:      { data_type: 'timestamp with time zone', is_nullable: 'NO'  },
  },
  'app_auth.password_reset_tokens': {
    id:           { data_type: 'uuid',        is_nullable: 'NO'  },
    user_id:      { data_type: 'uuid',        is_nullable: 'NO'  },
    token_hash:   { data_type: 'text',        is_nullable: 'NO'  },
    requested_at: { data_type: 'timestamp with time zone', is_nullable: 'NO'  },
    expires_at:   { data_type: 'timestamp with time zone', is_nullable: 'NO'  },
    used_at:      { data_type: 'timestamp with time zone', is_nullable: 'YES' },
    user_agent:   { data_type: 'text',        is_nullable: 'YES' },
    ip_address:   { data_type: 'inet',        is_nullable: 'YES' },
  },
  'app_auth.auth_events': {
    id:         { data_type: 'uuid',        is_nullable: 'NO'  },
    user_id:    { data_type: 'uuid',        is_nullable: 'YES' },
    event_type: { data_type: 'text',        is_nullable: 'NO'  },
    created_at: { data_type: 'timestamp with time zone', is_nullable: 'NO'  },
    ip_address: { data_type: 'inet',        is_nullable: 'YES' },
    user_agent: { data_type: 'text',        is_nullable: 'YES' },
    metadata:   { data_type: 'jsonb',       is_nullable: 'NO'  },
  },
};

const EXPECTED_INDEXES = {
  'app_auth.refresh_tokens': [
    'idx_app_auth_refresh_tokens_user_id',
    'idx_app_auth_refresh_tokens_token_family',
    'idx_app_auth_refresh_tokens_expires_at',
    'idx_app_auth_refresh_tokens_revoked_at',
  ],
  'app_auth.password_reset_tokens': [
    'idx_app_auth_password_reset_tokens_user_id',
    'idx_app_auth_password_reset_tokens_expires_at',
    'idx_app_auth_password_reset_tokens_used_at',
  ],
};

function writeReport(lines) {
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, lines.join('\n') + '\n', 'utf8');
}

async function main() {
  loadDotenv();

  const dsn = process.env.YANDEX_DATABASE_URL;
  if (!dsn) {
    console.error('[FAIL] YANDEX_DATABASE_URL is not set (expected in scripts/app-auth/.env.app-auth).');
    writeReport([
      '# 31 — app_auth schema verify result',
      '',
      `Timestamp (UTC): ${new Date().toISOString()}`,
      '',
      'Status: **CONFIG_ERROR** — YANDEX_DATABASE_URL not set.',
    ]);
    process.exit(2);
  }

  const host = hostOnly(dsn);
  const checks = []; // { name, status: 'OK'|'MISSING'|'TYPE_MISMATCH'|'EXTRA', detail }

  const client = new Client({ connectionString: dsn });
  try {
    await client.connect();
  } catch (err) {
    console.error(`[FAIL] Could not connect to ${host}: ${err.message}`);
    writeReport([
      '# 31 — app_auth schema verify result',
      '',
      `Timestamp (UTC): ${new Date().toISOString()}`,
      `Target host: \`${host}\``,
      '',
      `Status: **CONNECT_ERROR** — ${err.message}`,
    ]);
    process.exit(2);
  }

  try {
    // 1) schema app_auth exists
    {
      const r = await client.query(
        `SELECT 1 FROM pg_namespace WHERE nspname = 'app_auth' LIMIT 1`
      );
      checks.push({
        name: 'schema app_auth exists',
        status: r.rowCount === 1 ? 'OK' : 'MISSING',
        detail: r.rowCount === 1 ? '' : 'pg_namespace has no row for app_auth',
      });
    }

    // 2) columns per expected table
    for (const fqtn of Object.keys(EXPECTED_COLUMNS)) {
      const [schema, table] = fqtn.split('.');
      const r = await client.query(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2`,
        [schema, table]
      );
      const actual = new Map(r.rows.map((row) => [row.column_name, row]));
      if (r.rowCount === 0) {
        checks.push({ name: `table ${fqtn}`, status: 'MISSING', detail: 'no columns found' });
        continue;
      }
      checks.push({ name: `table ${fqtn}`, status: 'OK', detail: `${r.rowCount} columns` });

      for (const [col, expected] of Object.entries(EXPECTED_COLUMNS[fqtn])) {
        const got = actual.get(col);
        if (!got) {
          checks.push({ name: `${fqtn}.${col}`, status: 'MISSING', detail: 'column not found' });
          continue;
        }
        if (got.data_type !== expected.data_type || got.is_nullable !== expected.is_nullable) {
          checks.push({
            name: `${fqtn}.${col}`,
            status: 'TYPE_MISMATCH',
            detail: `expected ${expected.data_type} ${expected.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}, got ${got.data_type} ${got.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`,
          });
        } else {
          checks.push({ name: `${fqtn}.${col}`, status: 'OK', detail: '' });
        }
      }
    }

    // 3) indexes
    for (const fqtn of Object.keys(EXPECTED_INDEXES)) {
      const [schema, table] = fqtn.split('.');
      const r = await client.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = $2`,
        [schema, table]
      );
      const got = new Set(r.rows.map((row) => row.indexname));
      for (const idx of EXPECTED_INDEXES[fqtn]) {
        checks.push({
          name: `index ${fqtn}.${idx}`,
          status: got.has(idx) ? 'OK' : 'MISSING',
          detail: got.has(idx) ? '' : 'pg_indexes has no matching row',
        });
      }
    }

    // 4) auth.users.encrypted_password column
    {
      const r = await client.query(
        `SELECT data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'encrypted_password'`
      );
      if (r.rowCount === 0) {
        checks.push({ name: 'auth.users.encrypted_password', status: 'MISSING', detail: 'column not found' });
      } else if (r.rows[0].data_type !== 'text') {
        checks.push({
          name: 'auth.users.encrypted_password',
          status: 'TYPE_MISMATCH',
          detail: `expected text, got ${r.rows[0].data_type}`,
        });
      } else {
        checks.push({ name: 'auth.users.encrypted_password', status: 'OK', detail: `text (${r.rows[0].is_nullable === 'NO' ? 'NOT NULL' : 'NULL'})` });
      }
    }
  } finally {
    await client.end().catch(() => {});
  }

  const failed = checks.filter((c) => c.status !== 'OK');

  const lines = [];
  lines.push('# 31 — app_auth schema verify result');
  lines.push('');
  lines.push(`Timestamp (UTC): ${new Date().toISOString()}`);
  lines.push(`Target host: \`${host}\``);
  lines.push('');
  lines.push(`Status: **${failed.length === 0 ? 'OK' : 'FAIL'}** (${failed.length} issue${failed.length === 1 ? '' : 's'})`);
  lines.push('');
  lines.push('| Check | Status | Detail |');
  lines.push('|---|---|---|');
  for (const c of checks) {
    lines.push(`| \`${c.name}\` | ${c.status} | ${c.detail || ''} |`);
  }
  lines.push('');
  lines.push(`Final status: ${failed.length === 0 ? 'APP_AUTH_SCHEMA_VERIFY_OK' : 'APP_AUTH_SCHEMA_VERIFY_FAIL'}`);
  writeReport(lines);

  if (failed.length === 0) {
    console.log(`[OK] all ${checks.length} checks passed. Report: ${REPORT_PATH}`);
    process.exit(0);
  } else {
    console.error(`[FAIL] ${failed.length}/${checks.length} checks failed. See ${REPORT_PATH}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[FAIL] ${err.message}`);
  process.exit(2);
});
