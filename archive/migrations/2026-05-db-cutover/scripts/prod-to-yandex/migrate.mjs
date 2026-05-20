#!/usr/bin/env node
// migrate.mjs — orchestrator for the full PROD Supabase → Yandex pipeline.
//
// Default pipeline: check → export → import → verify → verify-passwords.
// Each step is a separate child process so a failure doesn't compromise the
// orchestrator's pg connections. CLI flags are forwarded to children.
//
// SAFETY:
//  - OLD_SUPABASE_DB_URL forbidden (assertNoOldEnv, exit 7).
//  - --dry-run forwards to export/import; NO Yandex writes occur. If export
//    produced no manifest (e.g. PROD unreachable), later stages print a CLEAR
//    expected-halt message (no stack trace) and exit non-zero cleanly.
//  - Exit codes: 0 ok · 2 precondition · 7 guard · non-zero on any step fail.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnv, env, getExportDir, parseCliArgs, tag, fatal, assertNoOldEnv } from './_lib.mjs';

loadEnv();
const __dirname = dirname(fileURLToPath(import.meta.url));

const { values } = parseCliArgs({
  name: 'migrate.mjs',
  description: 'Orchestrate the full PROD Supabase → Yandex pipeline. Each phase is a child process.',
  options: {
    'dry-run':       { type: 'boolean', default: false },
    'export-only':   { type: 'boolean', default: false },
    'import-only':   { type: 'boolean', default: false },
    'verify-only':   { type: 'boolean', default: false },
    'auth-only':     { type: 'boolean', default: false, describe: 'Import auth schema only' },
    'public-only':   { type: 'boolean', default: false, describe: 'Skip auth schema entirely' },
    'resume':        { type: 'boolean', default: false },
    'clean-yandex':  { type: 'boolean', default: false },
    'confirm':       { type: 'boolean', default: false, describe: 'Required when --clean-yandex is set' },
    'pool-safe-export': { type: 'boolean', default: false, describe: 'Forward to :export (per-table connection)' },
    'batch-size':    { type: 'string',  default: '1000' },
    'export-dir':    { type: 'string',  default: '' },
  },
});

const exportDir = values['export-dir'] || env('EXPORT_DIR') || getExportDir();
const dryRun = values['dry-run'];

function buildPipeline() {
  const all = [
    { script: '00_check_connections.mjs',     name: 'check',            forward: [] },
    { script: '03_export_prod_supabase.mjs',  name: 'export',           forward: ['dry-run', 'batch-size', 'export-dir', 'pool-safe-export'] },
    { script: '04_import_yandex.mjs',         name: 'import',           forward: ['dry-run', 'auth-only', 'public-only', 'resume', 'clean-yandex', 'confirm', 'batch-size', 'export-dir'] },
    { script: '05_verify_yandex.mjs',         name: 'verify',           forward: ['export-dir'] },
    { script: '06_verify_passwords.mjs',      name: 'verify-passwords', forward: ['export-dir'] },
  ];
  if (values['export-only']) return all.filter((s) => ['check', 'export'].includes(s.name));
  if (values['import-only']) return all.filter((s) => ['import'].includes(s.name));
  if (values['verify-only']) return all.filter((s) => ['verify', 'verify-passwords'].includes(s.name));
  return all;
}

function forwardArgs(step) {
  const args = [];
  for (const key of step.forward) {
    const v = values[key];
    if (v === undefined || v === '' || v === false) continue;
    if (typeof v === 'boolean' && v) args.push(`--${key}`);
    else if (typeof v === 'string') args.push(`--${key}=${v}`);
  }
  return args;
}

function runStep(step) {
  return new Promise((resolve, reject) => {
    const scriptPath = join(__dirname, step.script);
    const args = forwardArgs(step);
    console.log(`${tag('ORCH')} ▶ ${step.name} (${step.script}${args.length ? ' ' + args.join(' ') : ''})`);
    const child = spawn(process.execPath, [scriptPath, ...args], { stdio: 'inherit', env: process.env });
    child.on('exit', (code) => {
      if (code === 0) { console.log(`${tag('ORCH')} ✓ ${step.name}`); resolve(0); }
      else resolve(code); // do not throw — caller decides based on dry-run / expected-halt
    });
    child.on('error', reject);
  });
}

async function main() {
  try { assertNoOldEnv(); } catch (e) { console.error(`✗ ${e.message}`); process.exit(7); }

  const pipeline = buildPipeline();
  console.log(`${tag('ORCH')} pipeline: ${pipeline.map((s) => s.name).join(' → ')}`);
  console.log(`${tag('ORCH')} dry-run: ${dryRun ? 'YES' : 'no'}`);
  console.log('');

  for (const step of pipeline) {
    const code = await runStep(step);
    if (code === 0) continue;

    // Clean expected-halt: in --dry-run the export produces no manifest, so
    // import/verify/verify-passwords cannot run. Detect that and report a
    // friendly message instead of a stack trace.
    const manifestMissing = !existsSync(join(exportDir, 'manifest.json'));
    if (['import', 'verify', 'verify-passwords'].includes(step.name) && manifestMissing) {
      console.log('');
      console.log(`${tag('ORCH')} ⏹ Expected halt: step "${step.name}" cannot run because no export`);
      console.log(`${tag('ORCH')}   manifest exists in ${exportDir}.`);
      console.log(`${tag('ORCH')}   In --dry-run the export writes nothing, OR the PROD Supabase`);
      console.log(`${tag('ORCH')}   source was unreachable (see the export step output above).`);
      console.log(`${tag('ORCH')}   This is not a crash — run a real export once PROD is reachable:`);
      console.log(`${tag('ORCH')}     npm run prod-to-yandex:export`);
      process.exit(2);
    }
    console.error('');
    console.error(`${tag('ORCH')} ✗ step "${step.name}" exited with code ${code} — pipeline halted.`);
    process.exit(code);
  }

  console.log('');
  console.log(`${tag('ORCH')} ✓ pipeline complete`);
}

main().catch((e) => fatal(e));
