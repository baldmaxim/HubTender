#!/usr/bin/env node
// migrate.mjs — orchestrator for the full OLD → PROD pipeline.
//
// Default pipeline: check → introspect-old → introspect-prod → compare →
//                   export → prepare → import → verify → verify-auth → smoke.
//
// Each step is a separate child process (so failures don't compromise the
// orchestrator's pg connection pool). CLI flags are forwarded to children.

import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { loadDotenv, parseCliArgs, tag, fatal, assertMcpPreflightOk } from './_lib.mjs';

loadDotenv();

const __dirname = dirname(fileURLToPath(import.meta.url));

const { values } = parseCliArgs({
  name: 'migrate.mjs',
  description: 'Orchestrate the full OLD → PROD pipeline. Each phase is a child process.',
  options: {
    'dry-run':                  { type: 'boolean', default: false },
    'export-only':              { type: 'boolean', default: false },
    'import-only':              { type: 'boolean', default: false },
    'verify-only':              { type: 'boolean', default: false },
    'auth-only':                { type: 'boolean', default: false, describe: 'Import auth schema only' },
    'public-only':              { type: 'boolean', default: false, describe: 'Skip auth schema entirely' },
    'resume':                   { type: 'boolean', default: false },
    'clean-prod':               { type: 'boolean', default: false },
    'clean-prod-include-seeds': { type: 'boolean', default: false, describe: 'Forward to :import. Also TRUNCATE the 7 seed tables so they re-import byte-exact from OLD. Same 3-key gate as --clean-prod; NOT --allow-overwrite / ALLOW_PROD_OVERWRITE.' },
    'clean-auth':               { type: 'boolean', default: false, describe: 'DELETE rows from PROD auth schema before auth import (3-key guard: requires ALLOW_CLEAN_AUTH=true + ALLOW_AUTH_IMPORT=true + this flag)' },
    'confirm':                  { type: 'boolean', default: false, describe: 'Required when --clean-prod is set (forwarded to :import)' },
    'allow-overwrite':          { type: 'boolean', default: false, describe: 'Pass --allow-overwrite to import step (requires ALLOW_PROD_OVERWRITE=true)' },
    'overwrite':                { type: 'boolean', default: false, describe: 'Alias for --allow-overwrite' },
    'batch-size':               { type: 'string',  default: '1000' },
    'export-dir':               { type: 'string',  default: '' },
    'skip-smoke':               { type: 'boolean', default: false, describe: 'Skip 09_smoke_go_bff' },
    'allow-write-smoke-tests':  { type: 'boolean', default: false },
    'allow-import-dedup-for-rehearsal': { type: 'boolean', default: false, describe: 'Forward to :import (requires ALLOW_IMPORT_DEDUP_FOR_REHEARSAL=true). Downgrades VERIFY status from OK to OK_WITH_WARNINGS if duplicates were dropped.' },
    'pool-safe-export':         { type: 'boolean', default: false, describe: 'Forward to :export. Per-table connection + no global REPEATABLE READ snapshot. Use when OLD pool is shared with live traffic; requires operator-confirmed no-writes window.' },
    'use-mcp-preflight':        { type: 'boolean', default: false, describe: 'Trust .old-to-prod-export/schema_diff.json (source=mcp); skip introspect/compare stages and forward flag to :prepare/:import' },
  },
});

const exportDir = values['export-dir'] || process.env.EXPORT_DIR || './.old-to-prod-export';
const useMcpPreflight = values['use-mcp-preflight'];
const dryRun = values['dry-run'];

// Build the pipeline based on flags.
function buildPipeline() {
  const all = [
    { script: '00_check_connections.mjs', name: 'check',           forward: [] },
    { script: '01_introspect_old.mjs',    name: 'introspect-old',  forward: ['export-dir'] },
    { script: '02_introspect_prod.mjs',   name: 'introspect-prod', forward: ['export-dir'] },
    { script: '03_compare_schemas.mjs',   name: 'compare',         forward: ['export-dir'] },
    { script: '04_export_old.mjs',        name: 'export',          forward: ['dry-run', 'batch-size', 'export-dir', 'pool-safe-export'] },
    { script: '05_prepare_prod.mjs',      name: 'prepare',         forward: ['dry-run', 'export-dir', 'use-mcp-preflight', 'clean-auth', 'clean-prod', 'confirm'] },
    { script: '06_import_prod.mjs',       name: 'import',          forward: ['dry-run', 'auth-only', 'public-only', 'resume', 'clean-prod', 'clean-prod-include-seeds', 'clean-auth', 'confirm', 'allow-overwrite', 'overwrite', 'batch-size', 'export-dir', 'use-mcp-preflight', 'allow-import-dedup-for-rehearsal'] },
    { script: '07_verify.mjs',            name: 'verify',          forward: ['dry-run', 'export-dir'] },
    { script: '08_verify_auth.mjs',       name: 'verify-auth',     forward: ['dry-run', 'export-dir'] },
    { script: '09_smoke_go_bff.mjs',      name: 'smoke',           forward: ['dry-run', 'allow-write-smoke-tests'] },
  ];

  if (values['export-only']) return all.filter((s) => ['check', 'introspect-old', 'introspect-prod', 'compare', 'export'].includes(s.name));
  if (values['import-only']) return all.filter((s) => ['prepare', 'import'].includes(s.name));
  if (values['verify-only']) return all.filter((s) => ['verify', 'verify-auth'].includes(s.name));

  let pipeline = all;

  if (useMcpPreflight) {
    // MCP-first mode: the live MCP preflight produced schema_diff.json already;
    // introspect/compare stages would only duplicate that work AND require
    // direct OLD/PROD pg connectivity from this host. Drop them unconditionally.
    pipeline = pipeline.filter((s) => !['introspect-old', 'introspect-prod', 'compare'].includes(s.name));
    console.log(`${tag('ORCH')} --use-mcp-preflight → skipping introspect-old / introspect-prod / compare`);
  } else {
    // Skip introspection if schema_diff.json is fresher than 1 hour (legacy behavior).
    const schemaDiff = join(exportDir, 'schema_diff.json');
    if (existsSync(schemaDiff)) {
      const ageMs = Date.now() - statSync(schemaDiff).mtimeMs;
      if (ageMs < 60 * 60 * 1000) {
        pipeline = pipeline.filter((s) => !['introspect-old', 'introspect-prod', 'compare'].includes(s.name));
        console.log(`${tag('ORCH')} schema_diff.json < 1h old → skipping introspect/compare`);
      }
    }
  }

  if (values['skip-smoke']) {
    pipeline = pipeline.filter((s) => s.name !== 'smoke');
  }
  return pipeline;
}

function forwardArgs(step) {
  const args = [];
  for (const key of step.forward) {
    const v = values[key];
    if (v === undefined || v === '' || v === false) continue;
    if (typeof v === 'boolean' && v) args.push(`--${key}`);
    else if (typeof v === 'string') args.push(`--${key}=${v}`);
  }
  // allow-write-smoke-tests is named differently in the smoke script.
  if (step.name === 'smoke' && values['allow-write-smoke-tests']) {
    args.push('--allow-write-tests');
  }
  return args;
}

function runStep(step) {
  return new Promise((resolve, reject) => {
    const scriptPath = join(__dirname, step.script);
    const args = forwardArgs(step);
    console.log(`${tag('ORCH')} ▶ ${step.name} (${step.script}${args.length ? ' ' + args.join(' ') : ''})`);
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => {
      if (code === 0) {
        console.log(`${tag('ORCH')} ✓ ${step.name}`);
        resolve();
      } else {
        reject(new Error(`step "${step.name}" exited with code ${code}`));
      }
    });
    child.on('error', reject);
  });
}

async function main() {
  // Orchestrator-level MCP gate. The same helper runs again inside 05 (no
  // import gates) and 06 (with import gates) — child processes can be invoked
  // directly, so each stage validates for itself. Doing it here too gives a
  // fast, friendly error before any child is spawned.
  if (useMcpPreflight) {
    // enforceImportGates=true means: real (non-dry-run) runs require
    // ALLOW_AUTH_IMPORT=true and ALLOW_DISABLE_IMPORT_TRIGGERS=true.
    assertMcpPreflightOk({ exportDir, dryRun, enforceImportGates: true });
  }

  const pipeline = buildPipeline();
  console.log(`${tag('ORCH')} pipeline: ${pipeline.map((s) => s.name).join(' → ')}`);
  console.log(`${tag('ORCH')} dry-run: ${dryRun ? 'YES' : 'no'}`);
  if (useMcpPreflight) console.log(`${tag('ORCH')} preflight source: MCP (.old-to-prod-export/schema_diff.json)`);
  console.log('');

  for (const step of pipeline) {
    await runStep(step);
  }

  console.log('');
  console.log(`${tag('ORCH')} ✓ pipeline complete`);
}

main().catch((e) => fatal(e));
