// Этап 3.1 (§21): machine-readable release fingerprint.
//   node scripts/readiness/gen-release-manifest.mjs
// Пишет artifacts/release/{frontend-build-manifest.json,release-manifest.json}.
// Секреты не читает и не сохраняет. generated_at НЕ входит в content fingerprint.

import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:');
const OUT = join(ROOT, 'artifacts/release');
const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const fileHash = (p) => sha256(readFileSync(p));
// SHA-256 LF-нормализованного содержимого: не зависит от CRLF checkout и
// git-индекса (новые файлы релиза ещё могут быть unstaged на момент генерации).
const gitBlobHash = (rel) =>
  sha256(readFileSync(join(ROOT, rel)).toString('utf8').replaceAll('\r\n', '\n'));

const commit = sh('git rev-parse HEAD');
const branch = sh('git branch --show-current');

// 1. Миграции: git-blob-хэши в порядке применения.
const migDir = join(ROOT, 'db/yandex/incremental');
const migrations = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => ({ file: f, sha256_blob: gitBlobHash(`db/yandex/incremental/${f}`) }));
const baseline = readdirSync(join(ROOT, 'db/yandex/sql')).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => ({ file: f, sha256_blob: gitBlobHash(`db/yandex/sql/${f}`) }));

// 2. Lock-файлы.
const locks = {
  'go.mod': gitBlobHash('backend/go.mod'),
  'go.sum': gitBlobHash('backend/go.sum'),
  'package-lock.json': gitBlobHash('package-lock.json'),
};

// 3. Frontend build manifest (dist/ уже должен быть собран).
const dist = join(ROOT, 'dist');
let buildManifest = null;
if (existsSync(dist)) {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(dist);
  files.sort();
  buildManifest = {
    release: process.env.HUBTENDER_RELEASE_NAME || 'hubtender-rc1',
    commit_sha: commit,
    node: process.version,
    files: files.map((p) => ({
      file: p.slice(dist.length + 1).replaceAll('\\', '/'),
      bytes: statSync(p).size,
      sha256: fileHash(p),
    })),
  };
  buildManifest.total_bytes = buildManifest.files.reduce((s, f) => s + f.bytes, 0);
  writeFileSync(join(OUT, 'frontend-build-manifest.json'), JSON.stringify(buildManifest, null, 2));
}

// 4. Content fingerprint: только детерминированные входы.
const canonical = JSON.stringify({
  report_version: 1,
  commit,
  migrations,
  baseline,
  locks,
  frontend_files: buildManifest ? buildManifest.files : null,
});
const fingerprint = sha256(canonical);

const manifest = {
  release_name: process.env.HUBTENDER_RELEASE_NAME || 'hubtender-rc1',
  commit_sha: commit,
  short_sha: commit.slice(0, 7),
  branch,
  generated_at: new Date().toISOString(),
  toolchain: {
    go: sh('go version'),
    node: process.version,
    npm: sh('npm --version'),
    postgres_gate: 'postgres:17 (disposable docker)',
  },
  migration_files: migrations,
  baseline_files: baseline,
  lock_hashes: locks,
  frontend_build: buildManifest
    ? { files: buildManifest.files.length, total_bytes: buildManifest.total_bytes, manifest: 'frontend-build-manifest.json' }
    : 'dist/ отсутствует на момент генерации',
  release_content_fingerprint: fingerprint,
  openrouter_rollout_default: 'off',
  notes: 'test/race/e2e/schema/secret результаты — в соседних *.json/*.log этого каталога; generated_at не входит в fingerprint',
};
writeFileSync(join(OUT, 'release-manifest.json'), JSON.stringify(manifest, null, 2));
console.log('release_content_fingerprint:', fingerprint);
console.log('written: artifacts/release/release-manifest.json' + (buildManifest ? ', frontend-build-manifest.json' : ''));
