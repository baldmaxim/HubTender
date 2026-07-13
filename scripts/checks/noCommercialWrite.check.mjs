// Stage 0.1.2.2 source guard — run via tsx:
//   npx tsx scripts/checks/noCommercialWrite.check.mjs
//
// Commercial costs (commercial_markup / total_commercial_material_cost /
// total_commercial_work_cost) are CALCULATION RESULTS. They may only be persisted
// by the internal server-side CommercialRecalcService. The public write endpoint
// PATCH /api/v1/items/bulk-commercial is RETIRED and answers 410.
//
// This check fails if production frontend code ever re-introduces a caller that
// writes them — a dead button, a fallback, or an exported helper that makes it
// easy to start writing again.
//
// Scope: production sources only (src/). Archive/docs are NOT scanned.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SRC = join(ROOT, 'src');

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs)$/;

/** Recursively collect production source files. */
function collect(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      collect(p, out);
    } else if (SOURCE_EXT.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

// Simple regex rules (any match is a violation).
const FORBIDDEN = [
  {
    name: 'call to the retired bulk-commercial endpoint',
    // matches apiFetch('/api/v1/items/bulk-commercial'…) / fetch("…/items/bulk-commercial"…)
    re: /(fetch|apiFetch)\s*(<[^>]*>)?\s*\(\s*[`'"][^`'"]*\/items\/bulk-commercial/,
  },
  {
    name: 'bulkUpdateCommercial helper (client-side commercial writer)',
    re: /\bbulkUpdateCommercial\s*[(=:]|export\s+(async\s+)?function\s+bulkUpdateCommercial\b/,
  },
];

const COMMERCIAL_FIELD = /(commercial_markup|total_commercial_(material|work)_cost)\s*:/;

/**
 * Strip // line comments and block comments, preserving offsets (replace with
 * spaces) so reported line numbers stay accurate. We scan CODE, not prose —
 * documenting the retirement (e.g. "do not reintroduce bulkUpdateCommercial")
 * must not trip the guard.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

// A commercial field is only forbidden when it is placed INSIDE an actual request
// body. Building read-shaped objects for display/comparison is fine, so we scan
// each `body:` payload region rather than the whole file.
function findCommercialInRequestBody(text) {
  const bodyStart = /body\s*:\s*JSON\.stringify\s*\(/g;
  let m;
  while ((m = bodyStart.exec(text)) !== null) {
    // Walk to the matching close paren to isolate exactly this payload.
    let depth = 1;
    let i = bodyStart.lastIndex;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
    }
    const payload = text.slice(bodyStart.lastIndex, i);
    const hit = COMMERCIAL_FIELD.exec(payload);
    if (hit) {
      return { index: bodyStart.lastIndex + hit.index, match: hit[0] };
    }
  }
  return null;
}

const violations = [];

for (const file of collect(SRC)) {
  const text = stripComments(readFileSync(file, 'utf8'));

  for (const rule of FORBIDDEN) {
    const m = rule.re.exec(text);
    if (m) {
      const line = text.slice(0, m.index).split('\n').length;
      violations.push(`${relative(ROOT, file)}:${line} — ${rule.name}\n      ${m[0].trim()}`);
    }
  }

  const bodyHit = findCommercialInRequestBody(text);
  if (bodyHit) {
    const line = text.slice(0, bodyHit.index).split('\n').length;
    violations.push(
      `${relative(ROOT, file)}:${line} — commercial cost field inside a request body\n      ${bodyHit.match.trim()}`,
    );
  }
}

console.log('noCommercialWrite.check:');
if (violations.length > 0) {
  console.error('\n  ✗ FORBIDDEN: production frontend must never write commercial costs.');
  console.error('    They are server-calculated; PATCH /api/v1/items/bulk-commercial is retired (410).\n');
  for (const v of violations) console.error('    - ' + v);
  console.error('');
  process.exit(1);
}
console.log('  ok — no frontend caller writes commercial costs');
console.log('  ok — no reference to the retired /items/bulk-commercial endpoint');
console.log('\nnoCommercialWrite.check: passed');
