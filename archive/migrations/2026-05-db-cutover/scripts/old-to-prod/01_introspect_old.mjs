#!/usr/bin/env node
// 01_introspect_old — capture OLD Supabase schema, row counts, and auth stats.
// Read-only. Writes to EXPORT_DIR/old_schema.json, old_rowcounts.json,
// old_auth_stats.json.

import { loadDotenv, requireEnv } from './_lib.mjs';
import { introspect } from './_introspect.mjs';

loadDotenv();

try {
  const url = requireEnv('OLD_SUPABASE_DB_URL');
  await introspect({ label: 'OLD', url, fileLabel: 'old' });
  process.exit(0);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
