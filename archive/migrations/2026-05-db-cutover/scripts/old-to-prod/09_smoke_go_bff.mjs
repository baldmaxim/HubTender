#!/usr/bin/env node
// 09_smoke_go_bff — verify PROD Supabase + Go BFF end-to-end after import.
//
// Steps:
//  1. smoke-login against PROD Supabase Auth (REST).
//  2. hit ~11 read-only Go BFF endpoints with the bearer token.
//  3. optionally probe per-tender / per-position endpoints if env IDs set.
//  4. optionally probe /api/v1/ws handshake (no write).
//  5. write-tests only if --allow-write-tests + ALLOW_WRITE_SMOKE_TESTS=true
//     and a clearly-marked test tender exists (currently: skipped — we don't
//     have a tagged "test" tender concept yet).
//
// Status: READY_FOR_YANDEX_MIGRATION (only if all reads succeed and no warnings
// from prior verify-* reports), READY_WITH_WARNINGS, NOT_READY.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

import {
  loadDotenv, parseCliArgs, redactEmail, twoKeyGuard, fatal, tag,
} from './_lib.mjs';
import { smokeLogin } from './_auth.mjs';

loadDotenv();

const { values } = parseCliArgs({
  name: '09_smoke_go_bff.mjs',
  description: 'Smoke-test PROD Supabase Auth + Go BFF after import.',
  options: {
    'dry-run':            { type: 'boolean', default: false, describe: 'Print URLs that would be called; do not fetch' },
    'base-url':           { type: 'string',  default: '',    describe: 'Override GO_BFF_BASE_URL' },
    'email':              { type: 'string',  default: '',    describe: 'Override MIGRATION_SMOKE_EMAIL' },
    'password':           { type: 'string',  default: '',    describe: 'Override MIGRATION_SMOKE_PASSWORD' },
    'tender-id':          { type: 'string',  default: '',    describe: 'Override MIGRATION_TEST_TENDER_ID' },
    'position-id':        { type: 'string',  default: '',    describe: 'Override MIGRATION_TEST_POSITION_ID' },
    'allow-write-tests':  { type: 'boolean', default: false, describe: 'Run safe write-tests (requires ALLOW_WRITE_SMOKE_TESTS=true)' },
  },
});

const dryRun = values['dry-run'];
const baseUrl = values['base-url'] || process.env.GO_BFF_BASE_URL;
const email = values.email || process.env.MIGRATION_SMOKE_EMAIL;
const password = values.password || process.env.MIGRATION_SMOKE_PASSWORD;
const tenderId = values['tender-id'] || process.env.MIGRATION_TEST_TENDER_ID;
const positionId = values['position-id'] || process.env.MIGRATION_TEST_POSITION_ID;

async function main() {
  if (!baseUrl) {
    console.error('✗ GO_BFF_BASE_URL not set (and --base-url not provided).');
    process.exit(2);
  }
  if (!email || !password) {
    console.error('✗ MIGRATION_SMOKE_EMAIL / MIGRATION_SMOKE_PASSWORD not set.');
    process.exit(2);
  }
  const supaUrl = process.env.PROD_SUPABASE_URL;
  const supaAnon = process.env.PROD_SUPABASE_ANON_KEY;
  if (!supaUrl || !supaAnon) {
    console.error('✗ PROD_SUPABASE_URL / PROD_SUPABASE_ANON_KEY not set.');
    process.exit(2);
  }

  try {
    twoKeyGuard({
      cliFlag: values['allow-write-tests'],
      envVar: 'ALLOW_WRITE_SMOKE_TESTS',
      label: 'Write smoke tests',
    });
  } catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(7);
  }

  const report = {
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    base_url: baseUrl,
    email_masked: redactEmail(email),
    steps: [],
    write_tests: { ran: false, results: [], reason: null },
    status: 'PENDING',
  };

  // ---- Login ----
  let accessToken = null;
  if (dryRun) {
    report.steps.push({ name: 'login', ok: null, note: 'dry-run' });
  } else {
    try {
      const session = await smokeLogin({ url: supaUrl, anonKey: supaAnon, email, password });
      accessToken = session.access_token;
      report.steps.push({ name: 'login', ok: typeof accessToken === 'string' && accessToken.length > 0 });
      console.log(`${tag('BFF')} login ${accessToken ? '✓' : '✗'} (${redactEmail(email)})`);
    } catch (e) {
      report.steps.push({ name: 'login', ok: false, error: e.message });
      console.error(`${tag('BFF')} login ✗ ${e.message}`);
      report.status = 'NOT_READY';
      writeReport(report);
      process.exit(1);
    }
  }

  // ---- Endpoints ----
  const endpoints = [
    'GET /health',
    'GET /health/db',
    'GET /api/v1/me',
    'GET /api/v1/me/permissions',
    'GET /api/v1/references/roles',
    'GET /api/v1/references/units',
    'GET /api/v1/references/material-names',
    'GET /api/v1/references/work-names',
    'GET /api/v1/references/cost-categories',
    'GET /api/v1/references/detail-cost-categories',
    'GET /api/v1/tenders?limit=5',
  ];

  if (tenderId) {
    endpoints.push(
      `GET /api/v1/tenders/${tenderId}/overview`,
      `GET /api/v1/tenders/${tenderId}/positions`,
      `GET /api/v1/tenders/${tenderId}/positions/with-costs`,
      `GET /api/v1/tenders/${tenderId}/boq-items-flat`,
    );
    if (positionId) {
      endpoints.push(`GET /api/v1/tenders/${tenderId}/positions/${positionId}/items`);
    }
  }

  for (const ep of endpoints) {
    const [method, path] = ep.split(' ');
    const url = `${baseUrl.replace(/\/$/, '')}${path}`;
    if (dryRun) {
      console.log(`${tag('BFF')} (dry) ${ep}`);
      report.steps.push({ name: ep, ok: null });
      continue;
    }
    try {
      const isPublic = path === '/health' || path === '/health/db';
      const headers = isPublic ? {} : { Authorization: `Bearer ${accessToken}` };
      const res = await fetch(url, { method, headers });
      const ok = res.status >= 200 && res.status < 300;
      report.steps.push({ name: ep, ok, status: res.status });
      console.log(`${tag('BFF')} ${ok ? '✓' : '✗'} ${ep} (${res.status})`);
    } catch (e) {
      report.steps.push({ name: ep, ok: false, error: e.message });
      console.log(`${tag('BFF')} ✗ ${ep} (${e.message})`);
    }
  }

  // ---- WebSocket probe (handshake only, no write) ----
  // We deliberately skip an actual ws-client open here: native fetch doesn't
  // upgrade to WS, and adding a ws client would be a new dep. The Go BFF
  // exposes /api/v1/ws?token=…; presence is implicit when /health/db is ok.
  // If the user wants a real handshake test, they should run npm run smoke
  // (scripts/smoke/go-bff.mjs) which uses a JS SDK with WS support.

  // ---- Write tests ----
  if (values['allow-write-tests']) {
    report.write_tests.ran = false;
    report.write_tests.reason =
      'Write smoke tests require a clearly-tagged test tender; none defined. ' +
      'Skipped to avoid mutating real PROD data.';
    console.log(`${tag('BFF')} write tests skipped (no test-marked tender)`);
  }

  // ---- Status ----
  const failedSteps = report.steps.filter((s) => s.ok === false).map((s) => s.name);
  if (failedSteps.length === 0) {
    // Consult prior reports if present — true READY_FOR_YANDEX requires
    // verify + verify-auth to also be OK without warnings.
    const verifyOk = readStatusLine('docs/old-to-prod/VERIFY_RESULT.md') === 'VERIFY_OK';
    const authVerifyOk = readStatusLine('docs/old-to-prod/AUTH_VERIFY_RESULT.md') === 'AUTH_VERIFY_OK';
    if (verifyOk && authVerifyOk) {
      report.status = 'READY_FOR_YANDEX_MIGRATION';
    } else {
      report.status = 'READY_WITH_WARNINGS';
      report.steps.push({ name: 'prior-reports-clean', ok: false, note: 'verify or auth-verify reported warnings/failures' });
    }
  } else {
    report.status = 'NOT_READY';
  }

  if (!dryRun) writeReport(report);
  console.log(`${tag('BFF')} status: ${report.status}`);
  if (report.status === 'NOT_READY') process.exit(1);
}

function readStatusLine(path) {
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, 'utf8');
    const m = content.match(/Final status:\s*\*?\*?(\w+)/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

function writeReport(report) {
  const path = 'docs/old-to-prod/PROD_GO_BFF_VERIFICATION.md';
  const lines = [
    '# Go BFF smoke result on PROD Supabase',
    '',
    `> Generated by 09_smoke_go_bff.mjs at ${report.generated_at}.`,
    `> Dry-run: ${report.dry_run ? 'YES' : 'no'}.`,
    `> Smoke account: \`${report.email_masked}\``,
    '',
    `## Status: **${report.status}**`,
    '',
    '## Endpoints',
    '',
    '| Endpoint | OK | Status / Error |',
    '|---|---|---|',
  ];
  for (const s of report.steps) {
    const mark = s.ok === null ? '⏭' : s.ok ? '✓' : '✗';
    const detail = s.status ?? s.error ?? s.note ?? '';
    lines.push(`| ${s.name} | ${mark} | ${detail} |`);
  }
  lines.push('');
  lines.push('## Write smoke tests');
  lines.push('');
  if (report.write_tests.ran) {
    lines.push('Ran:');
    for (const r of report.write_tests.results) lines.push(`- ${r}`);
  } else {
    lines.push(`Skipped: ${report.write_tests.reason ?? '--allow-write-tests not passed or ALLOW_WRITE_SMOKE_TESTS!=true'}`);
  }
  lines.push('');
  lines.push(`Final status: **${report.status}**`);
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
  console.log(`✓ wrote ${path}`);
}

main().catch((e) => fatal(e));
