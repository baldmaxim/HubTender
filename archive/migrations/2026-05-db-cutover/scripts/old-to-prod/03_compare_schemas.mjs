#!/usr/bin/env node
// 03_compare_schemas — diff old_schema.json vs prod_schema.json.
// Pure file → file, no DB connections. Writes EXPORT_DIR/schema_diff.json and
// schema_diff.md (human-readable).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadDotenv, getExportDir, writeJson } from './_lib.mjs';

loadDotenv();

const exportDir = getExportDir();
const oldPath = join(exportDir, 'old_schema.json');
const prodPath = join(exportDir, 'prod_schema.json');

if (!existsSync(oldPath) || !existsSync(prodPath)) {
  console.error(
    `✗ Missing ${!existsSync(oldPath) ? oldPath : prodPath}. ` +
    `Run npm run old-to-prod:introspect-old and old-to-prod:introspect-prod first.`
  );
  process.exit(2);
}

const oldSchema = JSON.parse(readFileSync(oldPath, 'utf8'));
const prodSchema = JSON.parse(readFileSync(prodPath, 'utf8'));

const diff = {
  generated_at: new Date().toISOString(),
  postgres_versions: {
    old: oldSchema.postgres_version,
    prod: prodSchema.postgres_version,
  },
  schemas: diffArrays(oldSchema.schemas, prodSchema.schemas),
  tables: diffTables(oldSchema.tables, prodSchema.tables),
  enums: diffEnums(oldSchema.enums, prodSchema.enums),
  functions: diffFunctions(oldSchema.functions, prodSchema.functions),
  triggers: diffTriggers(oldSchema.triggers, prodSchema.triggers),
  rls_policies: diffPolicies(oldSchema.rls_policies, prodSchema.rls_policies),
};

// Machine-readable classification for downstream import scripts.
const { blockers, risks, info } = classify(diff);
diff.blockers = blockers;
diff.risks = risks;
diff.info = info;
diff.old = {
  postgres_version: oldSchema.postgres_version,
  tables: (oldSchema.tables || []).length,
};
diff.prod = {
  postgres_version: prodSchema.postgres_version,
  tables: (prodSchema.tables || []).length,
};

writeJson(join(exportDir, 'schema_diff.json'), diff);
console.log(`✓ wrote ${join(exportDir, 'schema_diff.json')}`);

const md = renderMarkdown(diff);
writeFileSync(join(exportDir, 'schema_diff.md'), md, 'utf8');
console.log(`✓ wrote ${join(exportDir, 'schema_diff.md')}`);

const summary = summarize(diff);
console.log('--- summary ---');
console.log(summary);

// ---------- diff helpers ----------

function diffArrays(a, b) {
  const aSet = new Set(a || []);
  const bSet = new Set(b || []);
  return {
    only_in_old: [...aSet].filter((x) => !bSet.has(x)).sort(),
    only_in_prod: [...bSet].filter((x) => !aSet.has(x)).sort(),
    in_both: [...aSet].filter((x) => bSet.has(x)).sort(),
  };
}

function tableKey(t) { return `${t.schema}.${t.table}`; }

function diffTables(oldTables, prodTables) {
  const oldMap = new Map(oldTables.map((t) => [tableKey(t), t]));
  const prodMap = new Map(prodTables.map((t) => [tableKey(t), t]));

  const onlyOld = [...oldMap.keys()].filter((k) => !prodMap.has(k)).sort();
  const onlyProd = [...prodMap.keys()].filter((k) => !oldMap.has(k)).sort();
  const inBoth = [...oldMap.keys()].filter((k) => prodMap.has(k)).sort();

  const tableDiffs = [];
  for (const k of inBoth) {
    const o = oldMap.get(k);
    const p = prodMap.get(k);
    const td = diffTablePair(o, p);
    if (td) tableDiffs.push({ key: k, ...td });
  }

  return {
    only_in_old: onlyOld,
    only_in_prod: onlyProd,
    table_diffs: tableDiffs,
  };
}

function diffTablePair(o, p) {
  const oCols = new Map(o.columns.map((c) => [c.name, c]));
  const pCols = new Map(p.columns.map((c) => [c.name, c]));

  const columnsOnlyOld = [...oCols.keys()].filter((n) => !pCols.has(n));
  const columnsOnlyProd = [...pCols.keys()].filter((n) => !oCols.has(n));

  const typeMismatch = [];
  const nullableMismatch = [];
  const defaultMismatch = [];

  for (const name of [...oCols.keys()].filter((n) => pCols.has(n))) {
    const oc = oCols.get(name);
    const pc = pCols.get(name);
    if (oc.udt_name !== pc.udt_name || oc.data_type !== pc.data_type) {
      typeMismatch.push({
        column: name,
        old: `${oc.data_type}/${oc.udt_name}`,
        prod: `${pc.data_type}/${pc.udt_name}`,
      });
    }
    if (oc.nullable !== pc.nullable) {
      nullableMismatch.push({
        column: name,
        old_nullable: oc.nullable,
        prod_nullable: pc.nullable,
      });
    }
    if ((oc.default || null) !== (pc.default || null)) {
      defaultMismatch.push({
        column: name,
        old_default: oc.default,
        prod_default: pc.default,
      });
    }
  }

  const pkMismatch =
    JSON.stringify(o.pk || []) !== JSON.stringify(p.pk || [])
      ? { old: o.pk, prod: p.pk }
      : null;

  const fkDiff = diffNamed(o.fks, p.fks, (x) => x.name);
  const uniqDiff = diffNamed(o.uniques, p.uniques, (x) => x.name);
  const idxDiff = diffNamed(o.indexes, p.indexes, (x) => x.name);

  const rlsMismatch =
    !!o.rls_enabled !== !!p.rls_enabled
      ? { old: !!o.rls_enabled, prod: !!p.rls_enabled }
      : null;

  if (
    columnsOnlyOld.length === 0 &&
    columnsOnlyProd.length === 0 &&
    typeMismatch.length === 0 &&
    nullableMismatch.length === 0 &&
    defaultMismatch.length === 0 &&
    !pkMismatch &&
    fkDiff.only_in_old.length === 0 &&
    fkDiff.only_in_prod.length === 0 &&
    uniqDiff.only_in_old.length === 0 &&
    uniqDiff.only_in_prod.length === 0 &&
    idxDiff.only_in_old.length === 0 &&
    idxDiff.only_in_prod.length === 0 &&
    !rlsMismatch
  ) {
    return null; // identical
  }

  return {
    columns_only_in_old: columnsOnlyOld,
    columns_only_in_prod: columnsOnlyProd,
    type_mismatch: typeMismatch,
    nullable_mismatch: nullableMismatch,
    default_mismatch: defaultMismatch,
    pk_mismatch: pkMismatch,
    fks: fkDiff,
    uniques: uniqDiff,
    indexes: idxDiff,
    rls_mismatch: rlsMismatch,
  };
}

function diffNamed(oldArr, prodArr, getKey) {
  const oMap = new Map((oldArr || []).map((x) => [getKey(x), x]));
  const pMap = new Map((prodArr || []).map((x) => [getKey(x), x]));
  return {
    only_in_old: [...oMap.keys()].filter((k) => !pMap.has(k)).sort(),
    only_in_prod: [...pMap.keys()].filter((k) => !oMap.has(k)).sort(),
  };
}

function enumKey(e) { return `${e.schema}.${e.name}`; }

function diffEnums(oldEnums, prodEnums) {
  const oMap = new Map(oldEnums.map((e) => [enumKey(e), e.values]));
  const pMap = new Map(prodEnums.map((e) => [enumKey(e), e.values]));

  const onlyOld = [...oMap.keys()].filter((k) => !pMap.has(k)).sort();
  const onlyProd = [...pMap.keys()].filter((k) => !oMap.has(k)).sort();

  const valuesDiff = [];
  for (const k of [...oMap.keys()].filter((k) => pMap.has(k))) {
    const ov = new Set(oMap.get(k));
    const pv = new Set(pMap.get(k));
    const valOnlyOld = [...ov].filter((x) => !pv.has(x));
    const valOnlyProd = [...pv].filter((x) => !ov.has(x));
    if (valOnlyOld.length || valOnlyProd.length) {
      valuesDiff.push({ enum: k, values_only_in_old: valOnlyOld, values_only_in_prod: valOnlyProd });
    }
  }

  return { only_in_old: onlyOld, only_in_prod: onlyProd, values_diff: valuesDiff };
}

function fnKey(f) { return `${f.schema}.${f.name}(${f.args})`; }

function diffFunctions(oldFns, prodFns) {
  const oMap = new Map(oldFns.map((f) => [fnKey(f), f]));
  const pMap = new Map(prodFns.map((f) => [fnKey(f), f]));
  const inBoth = [...oMap.keys()].filter((k) => pMap.has(k));
  const bodyDiff = inBoth
    .filter((k) => oMap.get(k).body_md5 !== pMap.get(k).body_md5)
    .map((k) => ({ function: k, old_md5: oMap.get(k).body_md5, prod_md5: pMap.get(k).body_md5 }));
  return {
    only_in_old: [...oMap.keys()].filter((k) => !pMap.has(k)).sort(),
    only_in_prod: [...pMap.keys()].filter((k) => !oMap.has(k)).sort(),
    body_mismatch: bodyDiff,
  };
}

function trigKey(t) { return `${t.schema}.${t.table}.${t.name}`; }

function diffTriggers(oldTrigs, prodTrigs) {
  const oMap = new Map(oldTrigs.map((t) => [trigKey(t), t]));
  const pMap = new Map(prodTrigs.map((t) => [trigKey(t), t]));
  return {
    only_in_old: [...oMap.keys()].filter((k) => !pMap.has(k)).sort(),
    only_in_prod: [...pMap.keys()].filter((k) => !oMap.has(k)).sort(),
  };
}

function polKey(p) { return `${p.schema}.${p.table}.${p.name}`; }

function diffPolicies(oldPols, prodPols) {
  const oMap = new Map(oldPols.map((p) => [polKey(p), p]));
  const pMap = new Map(prodPols.map((p) => [polKey(p), p]));
  return {
    only_in_old: [...oMap.keys()].filter((k) => !pMap.has(k)).sort(),
    only_in_prod: [...pMap.keys()].filter((k) => !oMap.has(k)).sort(),
  };
}

// ---------- structured classification ----------

/**
 * Sort diff findings into three buckets for downstream tooling (e.g. import
 * scripts that abort on non-empty blockers). Each entry has:
 *   { code, title, detail: string[] }
 * Codes are stable strings; downstream policy can whitelist specific codes
 * (e.g. allow `prod_only_table:public.auth_users` because it's expected).
 */
function classify(d) {
  const blockers = [];
  const risks = [];
  const info = [];

  if (d.tables.only_in_old.length) {
    blockers.push({
      code: 'tables_only_in_old',
      title: 'Tables present in OLD but missing in PROD',
      detail: d.tables.only_in_old,
    });
  }
  if (d.tables.only_in_prod.length) {
    info.push({
      code: 'tables_only_in_prod',
      title: 'Tables present in PROD but missing in OLD',
      detail: d.tables.only_in_prod,
    });
  }

  for (const t of d.tables.table_diffs) {
    if (t.columns_only_in_old.length) {
      blockers.push({
        code: `columns_only_in_old:${t.key}`,
        title: `Columns present in OLD but missing in PROD (${t.key})`,
        detail: t.columns_only_in_old,
      });
    }
    if (t.columns_only_in_prod.length) {
      info.push({
        code: `columns_only_in_prod:${t.key}`,
        title: `Columns added in PROD (${t.key})`,
        detail: t.columns_only_in_prod,
      });
    }
    if (t.type_mismatch.length) {
      risks.push({
        code: `type_mismatch:${t.key}`,
        title: `Column type drift (${t.key})`,
        detail: t.type_mismatch.map((m) => `${m.column}: OLD ${m.old} ↔ PROD ${m.prod}`),
      });
    }
    if (t.nullable_mismatch.length) {
      risks.push({
        code: `nullable_mismatch:${t.key}`,
        title: `Nullable drift (${t.key})`,
        detail: t.nullable_mismatch.map((m) => `${m.column}: OLD nullable=${m.old_nullable} ↔ PROD nullable=${m.prod_nullable}`),
      });
    }
    if (t.default_mismatch.length) {
      info.push({
        code: `default_mismatch:${t.key}`,
        title: `Default drift (${t.key})`,
        detail: t.default_mismatch.map((m) => `${m.column}: OLD default=${m.old_default} ↔ PROD default=${m.prod_default}`),
      });
    }
    if (t.pk_mismatch) {
      blockers.push({
        code: `pk_mismatch:${t.key}`,
        title: `Primary key drift (${t.key})`,
        detail: [`OLD pk=${JSON.stringify(t.pk_mismatch.old)} ↔ PROD pk=${JSON.stringify(t.pk_mismatch.prod)}`],
      });
    }
    if (t.fks.only_in_old.length) {
      info.push({ code: `fk_only_in_old:${t.key}`, title: `FK only in OLD (${t.key})`, detail: t.fks.only_in_old });
    }
    if (t.fks.only_in_prod.length) {
      info.push({ code: `fk_only_in_prod:${t.key}`, title: `FK only in PROD (${t.key})`, detail: t.fks.only_in_prod });
    }
    if (t.uniques.only_in_old.length || t.uniques.only_in_prod.length) {
      risks.push({
        code: `unique_drift:${t.key}`,
        title: `UNIQUE constraint drift (${t.key})`,
        detail: [
          ...t.uniques.only_in_old.map((n) => `only OLD: ${n}`),
          ...t.uniques.only_in_prod.map((n) => `only PROD: ${n}`),
        ],
      });
    }
    if (t.rls_mismatch) {
      risks.push({
        code: `rls_drift:${t.key}`,
        title: `RLS enabled drift (${t.key})`,
        detail: [`OLD rls=${t.rls_mismatch.old} ↔ PROD rls=${t.rls_mismatch.prod}`],
      });
    }
  }

  if (d.enums.only_in_old.length) {
    blockers.push({ code: 'enums_only_in_old', title: 'Enum types present in OLD but missing in PROD', detail: d.enums.only_in_old });
  }
  if (d.enums.only_in_prod.length) {
    info.push({ code: 'enums_only_in_prod', title: 'Enum types present in PROD but missing in OLD', detail: d.enums.only_in_prod });
  }
  for (const e of d.enums.values_diff) {
    if (e.values_only_in_old.length) {
      blockers.push({
        code: `enum_values_only_in_old:${e.enum}`,
        title: `Enum values present in OLD but missing in PROD (${e.enum})`,
        detail: e.values_only_in_old,
      });
    }
    if (e.values_only_in_prod.length) {
      info.push({
        code: `enum_values_only_in_prod:${e.enum}`,
        title: `Enum values added in PROD (${e.enum})`,
        detail: e.values_only_in_prod,
      });
    }
  }

  if (d.functions.only_in_old.length) {
    risks.push({ code: 'functions_only_in_old', title: 'Functions present in OLD but missing in PROD', detail: d.functions.only_in_old });
  }
  if (d.functions.only_in_prod.length) {
    info.push({ code: 'functions_only_in_prod', title: 'Functions present in PROD but missing in OLD', detail: d.functions.only_in_prod });
  }
  if (d.functions.body_mismatch.length) {
    info.push({
      code: 'functions_body_mismatch',
      title: 'Functions with different bodies',
      detail: d.functions.body_mismatch.map((f) => f.function),
    });
  }
  if (d.triggers.only_in_old.length) {
    risks.push({ code: 'triggers_only_in_old', title: 'Triggers present in OLD but missing in PROD', detail: d.triggers.only_in_old });
  }
  if (d.triggers.only_in_prod.length) {
    info.push({ code: 'triggers_only_in_prod', title: 'Triggers present in PROD but missing in OLD', detail: d.triggers.only_in_prod });
  }
  if (d.rls_policies.only_in_old.length) {
    info.push({ code: 'rls_only_in_old', title: 'RLS policies present only in OLD', detail: d.rls_policies.only_in_old });
  }
  if (d.rls_policies.only_in_prod.length) {
    info.push({ code: 'rls_only_in_prod', title: 'RLS policies present only in PROD', detail: d.rls_policies.only_in_prod });
  }

  return { blockers, risks, info };
}

// ---------- markdown rendering ----------

function renderMarkdown(d) {
  const lines = [];
  lines.push(`# Schema diff: OLD ↔ PROD Supabase`);
  lines.push('');
  lines.push(`> Generated: ${d.generated_at}`);
  lines.push('');
  lines.push(`- OLD  PostgreSQL: \`${d.postgres_versions.old?.slice(0, 80) || 'unknown'}\``);
  lines.push(`- PROD PostgreSQL: \`${d.postgres_versions.prod?.slice(0, 80) || 'unknown'}\``);
  lines.push('');

  // Blockers
  const blockers = [];
  const risks = [];
  const info = [];

  // Tables only in OLD = blocker (data has no destination)
  if (d.tables.only_in_old.length) {
    blockers.push({
      title: 'Tables present in OLD but missing in PROD',
      detail: d.tables.only_in_old,
    });
  }

  // Tables only in PROD = info (new in PROD, no OLD data expected)
  if (d.tables.only_in_prod.length) {
    info.push({
      title: 'Tables present in PROD but missing in OLD',
      detail: d.tables.only_in_prod,
    });
  }

  // Per-table column drifts
  const tablesWithDrift = d.tables.table_diffs;
  for (const t of tablesWithDrift) {
    if (t.columns_only_in_old.length) {
      blockers.push({
        title: `Columns present in OLD but missing in PROD (${t.key})`,
        detail: t.columns_only_in_old,
      });
    }
    if (t.columns_only_in_prod.length) {
      // PROD added a NOT NULL column without default → blocker.
      // Otherwise risk only.
      info.push({
        title: `Columns added in PROD (${t.key})`,
        detail: t.columns_only_in_prod,
      });
    }
    if (t.type_mismatch.length) {
      risks.push({
        title: `Column type drift (${t.key})`,
        detail: t.type_mismatch.map((m) => `${m.column}: OLD ${m.old} ↔ PROD ${m.prod}`),
      });
    }
    if (t.nullable_mismatch.length) {
      risks.push({
        title: `Nullable drift (${t.key})`,
        detail: t.nullable_mismatch.map((m) => `${m.column}: OLD nullable=${m.old_nullable} ↔ PROD nullable=${m.prod_nullable}`),
      });
    }
    if (t.default_mismatch.length) {
      info.push({
        title: `Default drift (${t.key})`,
        detail: t.default_mismatch.map((m) => `${m.column}: OLD default=${m.old_default} ↔ PROD default=${m.prod_default}`),
      });
    }
    if (t.pk_mismatch) {
      blockers.push({
        title: `Primary key drift (${t.key})`,
        detail: [`OLD pk=${JSON.stringify(t.pk_mismatch.old)} ↔ PROD pk=${JSON.stringify(t.pk_mismatch.prod)}`],
      });
    }
    if (t.fks.only_in_old.length) {
      info.push({ title: `FK only in OLD (${t.key})`, detail: t.fks.only_in_old });
    }
    if (t.fks.only_in_prod.length) {
      info.push({ title: `FK only in PROD (${t.key})`, detail: t.fks.only_in_prod });
    }
    if (t.uniques.only_in_old.length || t.uniques.only_in_prod.length) {
      risks.push({
        title: `UNIQUE constraint drift (${t.key})`,
        detail: [
          ...t.uniques.only_in_old.map((n) => `only OLD: ${n}`),
          ...t.uniques.only_in_prod.map((n) => `only PROD: ${n}`),
        ],
      });
    }
    if (t.rls_mismatch) {
      risks.push({
        title: `RLS enabled drift (${t.key})`,
        detail: [`OLD rls=${t.rls_mismatch.old} ↔ PROD rls=${t.rls_mismatch.prod}`],
      });
    }
  }

  // Enum diffs
  if (d.enums.only_in_old.length) {
    blockers.push({ title: 'Enum types present in OLD but missing in PROD', detail: d.enums.only_in_old });
  }
  if (d.enums.only_in_prod.length) {
    info.push({ title: 'Enum types present in PROD but missing in OLD', detail: d.enums.only_in_prod });
  }
  for (const e of d.enums.values_diff) {
    if (e.values_only_in_old.length) {
      blockers.push({
        title: `Enum values present in OLD but missing in PROD (${e.enum})`,
        detail: e.values_only_in_old,
      });
    }
    if (e.values_only_in_prod.length) {
      info.push({
        title: `Enum values added in PROD (${e.enum})`,
        detail: e.values_only_in_prod,
      });
    }
  }

  // Functions / triggers / policies — informational
  if (d.functions.only_in_old.length) {
    risks.push({ title: 'Functions present in OLD but missing in PROD', detail: d.functions.only_in_old });
  }
  if (d.functions.only_in_prod.length) {
    info.push({ title: 'Functions present in PROD but missing in OLD', detail: d.functions.only_in_prod });
  }
  if (d.functions.body_mismatch.length) {
    info.push({
      title: 'Functions with different bodies',
      detail: d.functions.body_mismatch.map((f) => f.function),
    });
  }
  if (d.triggers.only_in_old.length) {
    risks.push({ title: 'Triggers present in OLD but missing in PROD', detail: d.triggers.only_in_old });
  }
  if (d.triggers.only_in_prod.length) {
    info.push({ title: 'Triggers present in PROD but missing in OLD', detail: d.triggers.only_in_prod });
  }
  if (d.rls_policies.only_in_old.length) {
    info.push({ title: 'RLS policies present only in OLD', detail: d.rls_policies.only_in_old });
  }
  if (d.rls_policies.only_in_prod.length) {
    info.push({ title: 'RLS policies present only in PROD', detail: d.rls_policies.only_in_prod });
  }

  // Render sections
  lines.push(`## 🚨 Blockers (must resolve before data import)`);
  lines.push('');
  if (blockers.length === 0) {
    lines.push('_None found._');
  } else {
    for (const b of blockers) {
      lines.push(`### ${b.title}`);
      lines.push('');
      for (const item of b.detail) lines.push(`- \`${item}\``);
      lines.push('');
    }
  }

  lines.push(`## ⚠️ Risks (review before import)`);
  lines.push('');
  if (risks.length === 0) {
    lines.push('_None found._');
  } else {
    for (const r of risks) {
      lines.push(`### ${r.title}`);
      lines.push('');
      for (const item of r.detail) lines.push(`- \`${item}\``);
      lines.push('');
    }
  }

  lines.push(`## ℹ️ Info (expected drift)`);
  lines.push('');
  if (info.length === 0) {
    lines.push('_None._');
  } else {
    for (const i of info) {
      lines.push(`### ${i.title}`);
      lines.push('');
      for (const item of i.detail) lines.push(`- \`${item}\``);
      lines.push('');
    }
  }

  lines.push(`## Stats`);
  lines.push('');
  lines.push(`- tables only in OLD: ${d.tables.only_in_old.length}`);
  lines.push(`- tables only in PROD: ${d.tables.only_in_prod.length}`);
  lines.push(`- tables with column drift: ${d.tables.table_diffs.length}`);
  lines.push(`- enums only in OLD: ${d.enums.only_in_old.length}`);
  lines.push(`- enums only in PROD: ${d.enums.only_in_prod.length}`);
  lines.push(`- enums with value drift: ${d.enums.values_diff.length}`);
  lines.push(`- functions only in OLD: ${d.functions.only_in_old.length}`);
  lines.push(`- functions only in PROD: ${d.functions.only_in_prod.length}`);
  lines.push(`- triggers only in OLD: ${d.triggers.only_in_old.length}`);
  lines.push(`- triggers only in PROD: ${d.triggers.only_in_prod.length}`);
  lines.push('');

  return lines.join('\n');
}

function summarize(d) {
  return [
    `tables: OLD-only=${d.tables.only_in_old.length}, PROD-only=${d.tables.only_in_prod.length}, drift=${d.tables.table_diffs.length}`,
    `enums:  OLD-only=${d.enums.only_in_old.length}, PROD-only=${d.enums.only_in_prod.length}, value-drift=${d.enums.values_diff.length}`,
    `fns:    OLD-only=${d.functions.only_in_old.length}, PROD-only=${d.functions.only_in_prod.length}, body-mismatch=${d.functions.body_mismatch.length}`,
    `trigs:  OLD-only=${d.triggers.only_in_old.length}, PROD-only=${d.triggers.only_in_prod.length}`,
    `policies: OLD-only=${d.rls_policies.only_in_old.length}, PROD-only=${d.rls_policies.only_in_prod.length}`,
  ].join('\n');
}
