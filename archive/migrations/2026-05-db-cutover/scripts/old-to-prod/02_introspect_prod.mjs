#!/usr/bin/env node
// 02_introspect_prod — capture PROD Supabase schema, row counts, and auth stats.
// Read-only. Writes to EXPORT_DIR/prod_schema.json, prod_rowcounts.json,
// prod_auth_stats.json.

import { loadDotenv, requireEnv } from './_lib.mjs';
import { introspect } from './_introspect.mjs';

loadDotenv();

try {
  const url = requireEnv('PROD_SUPABASE_DB_URL');
  await introspect({ label: 'PROD', url, fileLabel: 'prod' });
  process.exit(0);
} catch (e) {
  console.error(`✗ ${e.message}`);
  console.error(e.stack);
  process.exit(1);
}
