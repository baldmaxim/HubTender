// Shared introspection routine used by 01_introspect_old.mjs / 02_introspect_prod.mjs.
// Captures schema, row counts, and auth statistics WITHOUT logging any
// secrets, email addresses, or password hashes.

import { join } from 'node:path';
import { getClient, getExportDir, writeJson, redactEmail, tag } from './_lib.mjs';

// Schemas we care about. Anything else (storage, realtime, vault, graphql,
// extensions, pgsodium) is ignored — they belong to Supabase platform and are
// not migrated by this project.
const SCHEMAS_OF_INTEREST = ['public', 'auth'];

async function fetchSchemas(client) {
  const { rows } = await client.query(`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    ORDER BY schema_name
  `);
  return rows.map((r) => r.schema_name);
}

async function fetchTables(client, schema) {
  const { rows } = await client.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = $1 AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
    [schema]
  );
  return rows.map((r) => r.table_name);
}

async function fetchColumns(client, schema, table) {
  const { rows } = await client.query(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default,
            character_maximum_length, numeric_precision, numeric_scale
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position`,
    [schema, table]
  );
  return rows.map((r) => ({
    name: r.column_name,
    data_type: r.data_type,
    udt_name: r.udt_name,
    nullable: r.is_nullable === 'YES',
    default: r.column_default,
    char_max_length: r.character_maximum_length,
    numeric_precision: r.numeric_precision,
    numeric_scale: r.numeric_scale,
  }));
}

async function fetchPrimaryKey(client, schema, table) {
  const { rows } = await client.query(
    `SELECT a.attname AS column
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = ($1 || '.' || $2)::regclass AND i.indisprimary
      ORDER BY array_position(i.indkey, a.attnum)`,
    [schema, table]
  );
  return rows.map((r) => r.column);
}

async function fetchForeignKeys(client, schema, table) {
  const { rows } = await client.query(
    `SELECT
        c.conname AS name,
        (SELECT array_agg(att.attname ORDER BY u.ord)
           FROM unnest(c.conkey) WITH ORDINALITY u(attnum, ord)
           JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = u.attnum
        ) AS columns,
        rn.nspname AS ref_schema,
        cr.relname AS ref_table,
        (SELECT array_agg(att.attname ORDER BY u.ord)
           FROM unnest(c.confkey) WITH ORDINALITY u(attnum, ord)
           JOIN pg_attribute att ON att.attrelid = c.confrelid AND att.attnum = u.attnum
        ) AS ref_columns,
        c.confdeltype AS on_delete
       FROM pg_constraint c
       JOIN pg_class cl ON cl.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
       JOIN pg_class cr ON cr.oid = c.confrelid
       JOIN pg_namespace rn ON rn.oid = cr.relnamespace
      WHERE c.contype = 'f' AND n.nspname = $1 AND cl.relname = $2
      ORDER BY c.conname`,
    [schema, table]
  );
  return rows.map((r) => ({
    name: r.name,
    columns: r.columns,
    ref_schema: r.ref_schema,
    ref_table: r.ref_table,
    ref_columns: r.ref_columns,
    on_delete: r.on_delete, // a=NO ACTION r=RESTRICT c=CASCADE n=SET NULL d=SET DEFAULT
  }));
}

async function fetchUniqueConstraints(client, schema, table) {
  const { rows } = await client.query(
    `SELECT c.conname AS name,
            (SELECT array_agg(att.attname ORDER BY u.ord)
               FROM unnest(c.conkey) WITH ORDINALITY u(attnum, ord)
               JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = u.attnum
            ) AS columns
       FROM pg_constraint c
       JOIN pg_class cl ON cl.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE c.contype = 'u' AND n.nspname = $1 AND cl.relname = $2
      ORDER BY c.conname`,
    [schema, table]
  );
  return rows.map((r) => ({ name: r.name, columns: r.columns }));
}

async function fetchIndexes(client, schema, table) {
  const { rows } = await client.query(
    `SELECT indexname, indexdef
       FROM pg_indexes
      WHERE schemaname = $1 AND tablename = $2
      ORDER BY indexname`,
    [schema, table]
  );
  return rows.map((r) => ({ name: r.indexname, def: r.indexdef }));
}

async function fetchEnums(client) {
  const { rows } = await client.query(`
    SELECT n.nspname AS schema, t.typname AS name,
           array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_enum e ON e.enumtypid = t.oid
     WHERE t.typtype = 'e' AND n.nspname IN ('public', 'auth')
     GROUP BY n.nspname, t.typname
     ORDER BY n.nspname, t.typname
  `);
  return rows;
}

async function fetchFunctions(client) {
  const { rows } = await client.query(`
    SELECT n.nspname AS schema, p.proname AS name,
           pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_function_result(p.oid) AS return_type,
           CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS security,
           l.lanname AS language,
           md5(pg_get_functiondef(p.oid)) AS body_md5
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE n.nspname = 'public'
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.objid = p.oid
            AND d.classid = 'pg_proc'::regclass
            AND d.deptype = 'e'
       )
     ORDER BY n.nspname, p.proname, args
  `);
  return rows;
}

async function fetchTriggers(client) {
  const { rows } = await client.query(`
    SELECT n.nspname AS schema, c.relname AS table, t.tgname AS name,
           CASE WHEN t.tgtype & 2 = 2 THEN 'BEFORE'
                WHEN t.tgtype & 64 = 64 THEN 'INSTEAD OF'
                ELSE 'AFTER' END AS timing,
           CASE WHEN t.tgtype & 1 = 1 THEN 'ROW' ELSE 'STATEMENT' END AS level,
           CASE WHEN t.tgtype & 4 = 4 THEN 'INSERT' ELSE NULL END AS ev_insert,
           CASE WHEN t.tgtype & 8 = 8 THEN 'DELETE' ELSE NULL END AS ev_delete,
           CASE WHEN t.tgtype & 16 = 16 THEN 'UPDATE' ELSE NULL END AS ev_update,
           CASE WHEN t.tgtype & 32 = 32 THEN 'TRUNCATE' ELSE NULL END AS ev_truncate,
           p.proname AS function_name
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE NOT t.tgisinternal
       AND n.nspname IN ('public', 'auth')
     ORDER BY n.nspname, c.relname, t.tgname
  `);
  return rows.map((r) => ({
    schema: r.schema,
    table: r.table,
    name: r.name,
    timing: r.timing,
    level: r.level,
    events: [r.ev_insert, r.ev_delete, r.ev_update, r.ev_truncate].filter(Boolean),
    function: r.function_name,
  }));
}

async function fetchRlsPolicies(client) {
  const { rows } = await client.query(`
    SELECT schemaname AS schema, tablename AS table, policyname AS name,
           cmd, roles, permissive, qual, with_check
      FROM pg_policies
     WHERE schemaname IN ('public', 'auth')
     ORDER BY schemaname, tablename, policyname
  `);
  return rows;
}

async function fetchTablesRlsEnabled(client) {
  const { rows } = await client.query(`
    SELECT n.nspname AS schema, c.relname AS table, c.relrowsecurity AS rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r' AND n.nspname IN ('public', 'auth')
     ORDER BY n.nspname, c.relname
  `);
  return rows;
}

async function fetchRowCount(client, schema, table) {
  // Trade exactness for portability: COUNT(*) is slow on huge tables but
  // accurate. Migration is one-shot; precision matters more than throughput.
  try {
    const { rows } = await client.query(
      `SELECT COUNT(*)::bigint AS n FROM ${quoteIdent(schema)}.${quoteIdent(table)}`
    );
    return Number(rows[0].n);
  } catch {
    return null; // table may not be SELECT-able by service role (auth.* edge cases)
  }
}

function quoteIdent(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}

async function fetchAuthStats(client) {
  const stats = {
    auth_users_count: 0,
    encrypted_password_null: 0, // potential OAuth-only
    email_confirmed_null: 0,
    public_users_count: 0,
    orphan_auth_users: 0, // in auth.users, not in public.users
    orphan_public_users: 0, // in public.users, not in auth.users
    duplicate_emails_in_auth: [], // [{email_masked, count}, ...]
    auth_identities_count: null,
    auth_identities_by_provider: [],
  };

  // auth.users — wrap each in try/catch in case role lacks SELECT on a column.
  try {
    const r = await client.query(`
      SELECT COUNT(*)::bigint AS total,
             COUNT(*) FILTER (WHERE encrypted_password IS NULL)::bigint AS enc_null,
             COUNT(*) FILTER (WHERE email_confirmed_at IS NULL)::bigint AS conf_null
        FROM auth.users
    `);
    stats.auth_users_count = Number(r.rows[0].total);
    stats.encrypted_password_null = Number(r.rows[0].enc_null);
    stats.email_confirmed_null = Number(r.rows[0].conf_null);
  } catch (e) {
    stats._auth_users_error = e.message;
  }

  try {
    const r = await client.query(`SELECT COUNT(*)::bigint AS n FROM public.users`);
    stats.public_users_count = Number(r.rows[0].n);
  } catch (e) {
    stats._public_users_error = e.message;
  }

  try {
    const r = await client.query(`
      SELECT COUNT(*)::bigint AS n
        FROM auth.users au
        LEFT JOIN public.users pu ON pu.id = au.id
       WHERE pu.id IS NULL
    `);
    stats.orphan_auth_users = Number(r.rows[0].n);
  } catch (e) {
    stats._orphan_auth_users_error = e.message;
  }

  try {
    const r = await client.query(`
      SELECT COUNT(*)::bigint AS n
        FROM public.users pu
        LEFT JOIN auth.users au ON au.id = pu.id
       WHERE au.id IS NULL
    `);
    stats.orphan_public_users = Number(r.rows[0].n);
  } catch (e) {
    stats._orphan_public_users_error = e.message;
  }

  try {
    const r = await client.query(`
      SELECT email, COUNT(*)::bigint AS n
        FROM auth.users
       WHERE email IS NOT NULL
       GROUP BY email
      HAVING COUNT(*) > 1
       ORDER BY n DESC
       LIMIT 50
    `);
    stats.duplicate_emails_in_auth = r.rows.map((row) => ({
      email_masked: redactEmail(row.email),
      count: Number(row.n),
    }));
  } catch (e) {
    stats._duplicate_emails_error = e.message;
  }

  try {
    const r = await client.query(`SELECT COUNT(*)::bigint AS n FROM auth.identities`);
    stats.auth_identities_count = Number(r.rows[0].n);
    const byProv = await client.query(`
      SELECT provider, COUNT(*)::bigint AS n
        FROM auth.identities
       GROUP BY provider
       ORDER BY provider
    `);
    stats.auth_identities_by_provider = byProv.rows.map((row) => ({
      provider: row.provider,
      count: Number(row.n),
    }));
  } catch (e) {
    stats._auth_identities_error = e.message;
  }

  return stats;
}

/**
 * Main entrypoint used by 01_introspect_old / 02_introspect_prod.
 * `label` is 'OLD' or 'PROD'; output files are prefixed accordingly.
 */
export async function introspect({ label, url, fileLabel }) {
  const exportDir = getExportDir();
  console.log(`${tag(label)} starting introspection → ${exportDir}/${fileLabel}_schema.json`);
  const client = await getClient(url);

  try {
    const schemas = await fetchSchemas(client);

    const tablesBySchema = {};
    for (const schema of SCHEMAS_OF_INTEREST) {
      tablesBySchema[schema] = await fetchTables(client, schema);
    }

    const rlsEnabled = await fetchTablesRlsEnabled(client);
    const rlsLookup = new Map(rlsEnabled.map((r) => [`${r.schema}.${r.table}`, r.rls_enabled]));

    const tableDetails = [];
    for (const schema of SCHEMAS_OF_INTEREST) {
      for (const table of tablesBySchema[schema]) {
        const [columns, pk, fks, uniques, indexes] = await Promise.all([
          fetchColumns(client, schema, table),
          fetchPrimaryKey(client, schema, table),
          fetchForeignKeys(client, schema, table),
          fetchUniqueConstraints(client, schema, table),
          fetchIndexes(client, schema, table),
        ]);
        tableDetails.push({
          schema,
          table,
          rls_enabled: rlsLookup.get(`${schema}.${table}`) || false,
          columns,
          pk,
          fks,
          uniques,
          indexes,
        });
      }
    }

    const enums = await fetchEnums(client);
    const functions = await fetchFunctions(client);
    const triggers = await fetchTriggers(client);
    const rls_policies = await fetchRlsPolicies(client);

    const { rows: [v] } = await client.query('SELECT version() AS v');

    const schemaPayload = {
      generated_at: new Date().toISOString(),
      label,
      postgres_version: v.v,
      schemas,
      tables: tableDetails,
      enums,
      functions,
      triggers,
      rls_policies,
    };

    writeJson(join(exportDir, `${fileLabel}_schema.json`), schemaPayload);
    console.log(`${tag(label)} wrote ${fileLabel}_schema.json (${tableDetails.length} tables, ${enums.length} enums, ${functions.length} functions)`);

    // Row counts
    const rowCounts = {};
    for (const schema of SCHEMAS_OF_INTEREST) {
      rowCounts[schema] = {};
      for (const table of tablesBySchema[schema]) {
        rowCounts[schema][table] = await fetchRowCount(client, schema, table);
      }
    }
    writeJson(join(exportDir, `${fileLabel}_rowcounts.json`), {
      generated_at: new Date().toISOString(),
      label,
      counts: rowCounts,
    });
    const totalPublic = Object.values(rowCounts.public || {}).reduce((s, n) => s + (n || 0), 0);
    console.log(`${tag(label)} wrote ${fileLabel}_rowcounts.json (public total rows: ${totalPublic})`);

    // Auth stats
    const authStats = await fetchAuthStats(client);
    writeJson(join(exportDir, `${fileLabel}_auth_stats.json`), {
      generated_at: new Date().toISOString(),
      label,
      ...authStats,
    });
    console.log(
      `${tag(label)} wrote ${fileLabel}_auth_stats.json ` +
      `(auth.users=${authStats.auth_users_count}, ` +
      `public.users=${authStats.public_users_count}, ` +
      `orphans auth/public=${authStats.orphan_auth_users}/${authStats.orphan_public_users}, ` +
      `enc_null=${authStats.encrypted_password_null})`
    );
  } finally {
    await client.end().catch(() => {});
  }
}
