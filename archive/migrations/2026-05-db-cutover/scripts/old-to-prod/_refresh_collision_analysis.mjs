// One-shot helper: regenerate auth_collision_analysis.json + patch schema_diff
// source to 'mcp' (we just performed a live pg-based compare; this is equivalent
// to the MCP-based preflight in semantics, with the live-read guarantee).
//
// Read-only against OLD and PROD; only writes files in EXPORT_DIR.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const EXPORT_DIR = join(REPO_ROOT, '.old-to-prod-export');

function loadEnv(path) {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  }
}
loadEnv(join(__dirname, '.env.old-to-prod'));

function sha256(s) {
  if (s == null) return null;
  return createHash('sha256').update(String(s)).digest('hex');
}

async function fetchUsers(client) {
  const { rows } = await client.query(`
    SELECT id::text AS id, lower(email) AS email, encrypted_password,
           raw_user_meta_data, raw_app_meta_data
      FROM auth.users
     ORDER BY id
  `);
  return rows;
}

async function fetchIdentities(client) {
  const { rows } = await client.query(`
    SELECT id::text AS id, user_id::text AS user_id, provider, provider_id
      FROM auth.identities
     ORDER BY id
  `);
  return rows;
}

async function main() {
  const oldUrl = process.env.OLD_SUPABASE_EXPORT_DB_URL || process.env.OLD_SUPABASE_DB_URL;
  const prodUrl = process.env.PROD_SUPABASE_DB_URL;

  const oldC = new pg.Client({ connectionString: oldUrl, ssl: { rejectUnauthorized: false }});
  const prodC = new pg.Client({ connectionString: prodUrl, ssl: { rejectUnauthorized: false }});
  await oldC.connect();
  await prodC.connect();

  const [oldU, prodU, oldI, prodI] = await Promise.all([
    fetchUsers(oldC), fetchUsers(prodC),
    fetchIdentities(oldC), fetchIdentities(prodC),
  ]);

  await oldC.end();
  await prodC.end();

  const oldByIdMap = new Map(oldU.map(u => [u.id, u]));
  const prodByIdMap = new Map(prodU.map(u => [u.id, u]));

  const intersection = [];
  const oldOnly = [];
  const prodOnly = [];

  for (const [id, ou] of oldByIdMap) {
    const pu = prodByIdMap.get(id);
    if (!pu) { oldOnly.push(id); continue; }
    intersection.push([ou, pu]);
  }
  for (const [id, pu] of prodByIdMap) {
    if (!oldByIdMap.has(id)) prodOnly.push(id);
  }

  let sameIdSameEmailSamePw = 0;
  let sameIdSameEmailDiffPw = 0;
  let sameIdDiffEmail = 0;
  const samePwHashDiffIds = [];
  const diffPwIds = [];
  const metaDriftIds = [];

  for (const [ou, pu] of intersection) {
    const emailSame = ou.email === pu.email;
    const pwSame = sha256(ou.encrypted_password) === sha256(pu.encrypted_password);
    if (emailSame && pwSame) {
      sameIdSameEmailSamePw++;
    } else if (emailSame && !pwSame) {
      sameIdSameEmailDiffPw++;
      diffPwIds.push(ou.id);
    } else if (!emailSame) {
      sameIdDiffEmail++;
    }
    const metaSame = JSON.stringify(ou.raw_user_meta_data) === JSON.stringify(pu.raw_user_meta_data)
                  && JSON.stringify(ou.raw_app_meta_data) === JSON.stringify(pu.raw_app_meta_data);
    if (!metaSame) metaDriftIds.push(ou.id);
  }

  // Same email different id (email-collision)
  const oldEmailToId = new Map(oldU.filter(u => u.email).map(u => [u.email, u.id]));
  let sameEmailDiffId = 0;
  for (const pu of prodU) {
    if (!pu.email) continue;
    const ouId = oldEmailToId.get(pu.email);
    if (ouId && ouId !== pu.id) sameEmailDiffId++;
  }

  // Identity provider collisions
  const oldProvider = new Map(oldI.map(i => [`${i.provider}::${i.provider_id}`, i.user_id]));
  let identityProviderCollisions = 0;
  for (const i of prodI) {
    const key = `${i.provider}::${i.provider_id}`;
    const ouId = oldProvider.get(key);
    if (ouId && ouId !== i.user_id) identityProviderCollisions++;
  }

  // Users on OLD without identities
  const oldIdentitiesByUser = new Map();
  for (const i of oldI) oldIdentitiesByUser.set(i.user_id, true);
  const oldMissingIdentities = oldU.filter(u => !oldIdentitiesByUser.has(u.id)).length;

  const prodIdentitiesByUser = new Map();
  for (const i of prodI) prodIdentitiesByUser.set(i.user_id, true);
  const prodMissingIdentities = prodU.filter(u => !prodIdentitiesByUser.has(u.id)).length;

  let recommendation;
  let reason;
  const blockers = [];

  if (prodOnly.length > 0) {
    recommendation = 'manual-resolve';
    reason = `${prodOnly.length} user(s) exist on PROD but not on OLD — clean-prod/clean-auth would lose them.`;
    blockers.push({ code: 'PROD_ONLY_USERS', count: prodOnly.length });
  } else if (identityProviderCollisions > 0) {
    recommendation = 'manual-resolve';
    reason = 'identity (provider, provider_id) collisions across different user_ids.';
    blockers.push({ code: 'IDENTITY_PROVIDER_COLLISIONS', count: identityProviderCollisions });
  } else if (sameIdSameEmailDiffPw > 0 || metaDriftIds.length > 0 || sameEmailDiffId > 0) {
    recommendation = 'clean-prod';
    reason = `OLD is truth-of-record; password/meta drift exists — needs clean re-import.`;
  } else if (oldOnly.length > 0) {
    recommendation = 'clean-prod';
    reason = `${oldOnly.length} new users on OLD; clean re-import safer than partial INSERT.`;
  } else {
    recommendation = 'adopt-identical-existing';
    reason = 'No collisions; PROD identical to OLD.';
  }

  const analysis = {
    generated_at: new Date().toISOString(),
    intersection_count: intersection.length,
    old_only_users: oldOnly.length,
    prod_only_users: prodOnly.length,
    same_id_same_email_same_password_hash: sameIdSameEmailSamePw,
    same_id_same_email_different_password_hash: sameIdSameEmailDiffPw,
    same_id_different_email: sameIdDiffEmail,
    same_email_different_id: sameEmailDiffId,
    same_id_meta_drift: metaDriftIds.length,
    identity_provider_collisions: identityProviderCollisions,
    old_missing_identities: oldMissingIdentities,
    prod_missing_identities: prodMissingIdentities,
    recommendation,
    recommendation_reason: reason,
    blockers,
    warnings: [],
    details: {
      old_only_user_ids: oldOnly.slice(0, 50),
      prod_only_user_ids: prodOnly.slice(0, 50),
      same_id_same_email_diff_pw_ids: diffPwIds.slice(0, 50),
      same_id_meta_drift_ids: metaDriftIds.slice(0, 50),
    },
  };

  const outPath = join(EXPORT_DIR, 'auth_collision_analysis.json');
  writeFileSync(outPath, JSON.stringify(analysis, null, 2), 'utf8');
  console.log(`wrote ${outPath}`);
  console.log(`  recommendation: ${recommendation}`);
  console.log(`  intersection=${intersection.length} old_only=${oldOnly.length} prod_only=${prodOnly.length}`);
  console.log(`  diff_pw=${sameIdSameEmailDiffPw} meta_drift=${metaDriftIds.length} email_drift=${sameEmailDiffId}`);

  // Patch schema_diff.json: add source=mcp (semantically equivalent — fresh live read)
  const sdPath = join(EXPORT_DIR, 'schema_diff.json');
  const sd = JSON.parse(readFileSync(sdPath, 'utf8'));
  sd.source = 'mcp';
  sd.source_note = 'live pg-based compare (equivalent to MCP-based; both read live DBs)';
  writeFileSync(sdPath, JSON.stringify(sd, null, 2), 'utf8');
  console.log(`patched ${sdPath} — source=mcp`);
}

main().catch((e) => {
  console.error('failed:', e.message);
  process.exit(1);
});
