import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeBrief } from '../lib/brief.mjs';
import { decisionOf, planApply, planRemarks, runApply } from '../lib/apply.mjs';
import { renderReview } from '../lib/review-md.mjs';
import { makeState, withRemarks } from './helpers.mjs';

const TENDER = 't-1';

/** Состояние из makeState + две копии f1 (f5 — находки в портале уже нет, f6 — вердикт уже стоит). */
const buildState = () => {
  const state = makeState();
  const base = state.items[0];
  state.items.push(
    { ...base, key: 'f5', findingId: 'fid-5', entityId: 'row-5', fingerprint: 'fp-5' },
    { ...base, key: 'f6', findingId: 'fid-6', entityId: 'row-6', fingerprint: 'fp-6' },
  );
  return state;
};

/** Свежий отчёт портала для buildState. */
const freshFindings = (patch = {}) => {
  const f = (code, entityId, fingerprint, verdict = null) => ({ rule_code: code, entity_id: entityId, fingerprint, verdict });
  return [
    f('P', 'row-1', 'fp-1'),
    f('GA', 'row-2', 'fp-2'),
    f('Q', 'pos-3', 'CHANGED'),
    f('T', 't-1', 'fp-4', 'error'),
    f('P', 'row-6', 'fp-6', 'error'),
    ...(patch.extra ?? []),
  ];
};

const fakePortal = ({ findings = freshFindings(), brief, failPost = false } = {}) => {
  const calls = { get: [], post: [], put: [] };
  return {
    baseUrl: 'https://gp.su10.ru',
    calls,
    get: async (path, query) => {
      calls.get.push({ path, query });
      if (path === `/api/v1/tenders/${TENDER}/quality`) return { findings, errors: [] };
      if (path === `/api/v1/tenders/${TENDER}/brief`) return brief;
      throw new Error(`неожиданный путь ${path}`);
    },
    post: async (path, body) => {
      if (failPost) throw new Error('HTTP 500');
      calls.post.push({ path, body });
      return null;
    },
    put: async (path, body) => {
      calls.put.push({ path, body });
      return null;
    },
  };
};

/** Папка прогона во временном outDir; marks — функция правки текста review.md. */
const withRun = async (edit, fn, { remarks = false } = {}) => {
  const outDir = mkdtempSync(join(tmpdir(), 'ai-review-apply-'));
  try {
    const runDir = join(outDir, '256-v3', '2026-10-23_1405');
    mkdirSync(runDir, { recursive: true });
    const state = remarks ? withRemarks(buildState()) : buildState();
    writeFileSync(join(runDir, 'run.json'), JSON.stringify(state), 'utf8');
    writeFileSync(join(runDir, 'positions.json'), '{}', 'utf8');
    const reviewPath = join(runDir, 'review.md');
    writeFileSync(reviewPath, edit(renderReview(state)), 'utf8');
    return await fn({ outDir, runDir, reviewPath });
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
};

/** Ставит отметку строке ‹fN› и, если задан, комментарий. */
const mark = (text, key, char, comment) =>
  text.replace(new RegExp(`^- \\[ \\](.*‹${key}›)$`, 'm'), (_m, rest) => `- [${char}]${rest}${comment ? ` // ${comment}` : ''}`);

const MARKED = (text) => {
  let out = mark(text, 'f1', '+', 'цена за м², проверить');
  out = out.replace(/^## \[ \] Похоже на шум/m, '## [+] Похоже на шум'); // f2 — отметка раздела: согласен с ИИ → «Норма»
  out = mark(out, 'f3', '+');
  out = mark(out, 'f4', '-');
  out = mark(out, 'f5', '+');
  out = mark(out, 'f6', '+');
  return out;
};

const quiet = () => {
  const lines = [];
  return { lines, log: (l) => lines.push(l) };
};

const readJsonl = (file) => readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('apply: верные ушли с правильным note, изменённые и чужие пропущены; журнал, applied.json, итог', async () => {
  await withRun(MARKED, async ({ outDir, runDir, reviewPath }) => {
    const portal = fakePortal();
    const { lines, log } = quiet();
    const now = () => new Date('2026-10-23T11:30:00.000Z');
    const code = await runApply({}, { file: reviewPath }, { portal, outDir, now, log });
    assert.equal(code, 0);

    // свежий отчёт запрошен без open_only
    assert.deepEqual(portal.calls.get[0].query, {});

    assert.equal(portal.calls.post.length, 1);
    assert.equal(portal.calls.post[0].path, `/api/v1/tenders/${TENDER}/quality/verdicts`);
    assert.deepEqual(portal.calls.post[0].body.items, [
      { rule_code: 'P', entity_id: 'row-1', fingerprint: 'fp-1', verdict: 'error', note: 'ИИ-проверка: цена за м², проверить' },
      { rule_code: 'GA', entity_id: 'row-2', fingerprint: 'fp-2', verdict: 'accepted', note: 'ИИ-проверка (отметка раздела)' },
    ]);

    const text = lines.join('\n');
    assert.match(text, /ПРОПУЩЕНО f3 .*данные изменились после прогона/);
    assert.match(text, /ПРОПУЩЕНО f4 .*в портале уже стоит другой вердикт \(«Ошибка»\)/);
    assert.match(text, /ПРОПУЩЕНО f5 .*находки больше нет/);
    assert.match(text, /Уже стоит тот же вердикт, не отправляется: 1/);

    const applied = JSON.parse(readFileSync(join(runDir, 'applied.json'), 'utf8'));
    assert.deepEqual(Object.keys(applied).sort(), ['f1', 'f2']);
    assert.equal(applied.f1.decision, 'error');
    assert.equal(applied.f1.fingerprint, 'fp-1');
    assert.equal(applied.f1.at, '2026-10-23T11:30:00.000Z');

    const journal = readJsonl(join(outDir, 'decisions.jsonl'));
    assert.equal(journal.length, 2);
    assert.deepEqual(journal[0], {
      at: '2026-10-23T11:30:00.000Z', tender_id: 't-1', tender: '256 v3', kind: 'finding', code: 'P',
      entity_type: 'boq_item', entity_id: 'row-1', item_id: 'row-1', position_id: 'pos-1', fingerprint: 'fp-1',
      finding_id: 'fid-1', money_delta: 1_200_000, ai_label: 'likely_error', ai_reason: '125 ₽/м³ при медиане 4 800',
      ai_basis: 'P-1', ai_by_model: { qwen: 'likely_error', minimax: 'likely_error' }, decision: 'error',
      note: 'цена за м², проверить', bulk: false, origin: 'review', models: ['qwen', 'minimax'],
      prompt_version: 'review-v1@1a2b3c4d', skills_rev: 'a1b2c3d', run: '256-v3/2026-10-23_1405',
      snapshot: '256-v3/2026-10-23_1405/positions.json#pos-1',
    });
    assert.equal(journal[1].bulk, true);
    assert.equal(journal[1].note, '');
    assert.equal(journal[1].decision, 'accepted');

    const itog = readFileSync(join(runDir, 'itog.md'), 'utf8');
    assert.match(itog, /Подтверждено ошибок: 1 · отклонено \(норма\): 1/);
    assert.match(itog, /1\. P · поз\. 12\.3 «Утеплитель ПСБ-С 25» · Δ 1,2 млн ₽ · \[открыть\]\(https:\/\/gp\.su10\.ru\/positions\/pos-1\/items\?[^)]*\) — цена за м², проверить/);

    // повторный apply ничего не шлёт и не дублирует журнал
    const again = fakePortal();
    const second = quiet();
    assert.equal(await runApply({}, { file: reviewPath }, { portal: again, outDir, now, log: second.log }), 0);
    assert.equal(again.calls.post.length, 0);
    assert.equal(readJsonl(join(outDir, 'decisions.jsonl')).length, 2);
    assert.match(second.lines.join('\n'), /Уже применено ранее: 2/);
  });
});

test('apply --dry-run: ничего не шлёт и не пишет, но показывает причины пропусков', async () => {
  await withRun(MARKED, async ({ outDir, runDir, reviewPath }) => {
    const portal = fakePortal();
    const { lines, log } = quiet();
    const code = await runApply({}, { file: reviewPath, dryRun: true, brief: true }, { portal, outDir, log });
    assert.equal(code, 0);
    assert.equal(portal.calls.post.length, 0);
    assert.equal(portal.calls.put.length, 0);
    assert.equal(existsSync(join(runDir, 'applied.json')), false);
    assert.equal(existsSync(join(runDir, 'itog.md')), false);
    assert.equal(existsSync(join(outDir, 'decisions.jsonl')), false);
    const text = lines.join('\n');
    assert.match(text, /Было бы отправлено:/);
    assert.match(text, /f1 .*→ Ошибка .*«ИИ-проверка: цена за м², проверить»/);
    assert.match(text, /ПРОПУЩЕНО f3 .*данные изменились/);
  });
});

test('apply: сбой отправки — стоп, журнал и applied.json не пишутся, код 1', async () => {
  await withRun(MARKED, async ({ outDir, runDir, reviewPath }) => {
    const portal = fakePortal({ failPost: true });
    const { lines, log } = quiet();
    assert.equal(await runApply({}, { file: reviewPath }, { portal, outDir, log }), 1);
    assert.match(lines.join('\n'), /ОШИБКА отправки: HTTP 500/);
    assert.equal(existsSync(join(runDir, 'applied.json')), false);
    assert.equal(existsSync(join(outDir, 'decisions.jsonl')), false);
  });
});

test('apply: чужой файл без run.json и чужой ключ', async () => {
  await withRun((t) => `${t}\n- [+] X ‹f77›\n`, async ({ outDir, reviewPath }) => {
    const { lines, log } = quiet();
    await runApply({}, { file: reviewPath, dryRun: true }, { portal: fakePortal(), outDir, log });
    assert.match(lines.join('\n'), /ВНИМАНИЕ: строка \d+: ключ f77 не из этого прогона/);
    rmSync(join(reviewPath, '..', 'run.json'));
    await assert.rejects(runApply({}, { file: reviewPath }, { portal: fakePortal(), outDir, log }), /нет run\.json/);
  });
});

const BRIEF_ONLY_F1 = (text) => mark(text, 'f1', '+');

test('apply --brief: заменяет только свой блок, чужой текст и fact_category_ids: null сохраняются', async () => {
  await withRun(BRIEF_ONLY_F1, async ({ outDir, reviewPath }) => {
    const portal = fakePortal({
      brief: {
        tender_id: TENDER,
        fact_category_ids: null,
        summary_text: 'Чужой текст\n\n[ИИ-проверка 2026-01-01 10:00]\nстарый итог\n[/ИИ-проверка]\n\nХвост выжимки',
      },
    });
    const { log } = quiet();
    const code = await runApply({}, { file: reviewPath, brief: true }, { portal, outDir, now: () => new Date(2026, 9, 23, 15, 0), log });
    assert.equal(code, 0);
    assert.equal(portal.calls.put.length, 1);
    const { path, body } = portal.calls.put[0];
    assert.equal(path, `/api/v1/tenders/${TENDER}/brief`);
    assert.strictEqual(body.fact_category_ids, null);
    assert.ok(body.summary_text.startsWith('Чужой текст\n\n[ИИ-проверка 2026-10-23 15:00]'));
    assert.ok(body.summary_text.endsWith('[/ИИ-проверка]\n\nХвост выжимки'));
    assert.ok(!body.summary_text.includes('старый итог'));
    assert.match(body.summary_text, /подтверждено ошибок 1 на Δ 1,2 млн ₽/);
    assert.match(body.summary_text, /- поз\. 12\.3 · P · Δ 1,2 млн ₽/);
  });
});

test('apply --brief: нет блока — дописывается в конец, fact_category_ids передаются как есть', async () => {
  await withRun(BRIEF_ONLY_F1, async ({ outDir, reviewPath }) => {
    const portal = fakePortal({ brief: { tender_id: TENDER, fact_category_ids: ['c1', 'c2'], summary_text: 'Только чужой текст\n' } });
    await runApply({}, { file: reviewPath, brief: true }, { portal, outDir, log: () => {} });
    const { body } = portal.calls.put[0];
    assert.deepEqual(body.fact_category_ids, ['c1', 'c2']);
    assert.match(body.summary_text, /^Только чужой текст\n\n\[ИИ-проверка .*\]\n/);
    assert.ok(body.summary_text.endsWith('[/ИИ-проверка]'));
  });
});

test('composeBrief: лимит 20 000 символов — меньше строк; совсем не влезает — ошибка', () => {
  const confirmed = Array.from({ length: 30 }, (_, i) => ({ ruleCode: 'P', where: `поз. ${i + 1} «x»`, moneyDelta: (i + 1) * 1000 }));
  const params = { tender: { number: '256', version: 3 }, confirmed, rejected: 0, date: new Date(2026, 9, 23, 15, 0) };
  const full = composeBrief('', params);
  assert.equal(full.split('\n').filter((l) => l.startsWith('- ')).length, 10);
  assert.match(full, /- поз\. 30 · P · Δ 30 тыс\. ₽/); // крупнейшие первыми
  const near = 'x'.repeat(20_000 - full.length + 150); // 10 строк уже не влезают
  const trimmed = composeBrief(near, params);
  assert.ok(Array.from(trimmed).length <= 20_000);
  assert.ok(trimmed.split('\n').filter((l) => l.startsWith('- ')).length < 10);
  assert.throws(() => composeBrief('x'.repeat(20_000), params), /длиннее 20000/);
});

test('planApply: отметка изменена после apply — пропуск с причиной, та же — «уже применено»', () => {
  const item = { key: 'f1', ruleCode: 'P', entityId: 'e1', fingerprint: 'fp1', where: 'поз. 1', moneyDelta: null };
  const state = { items: [item, { ...item, key: 'f2', entityId: 'e2' }] };
  const marks = new Map([['f1', { mark: '-', comment: '', bulk: false }], ['f2', { mark: '+', comment: '', bulk: false }]]);
  const fresh = new Map([['P|e1', { fingerprint: 'fp1', verdict: 'error' }], ['P|e2', { fingerprint: 'fp1', verdict: 'error' }]]);
  const applied = { f1: { decision: 'error' }, f2: { decision: 'error' } };
  const plan = planApply({ state, marks, fresh, applied });
  assert.equal(plan.send.length, 0);
  assert.equal(plan.done, 1);
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0].reason, /изменена после apply/);
});

// --- замечания ИИ ---------------------------------------------------------------

/** Подтверждено n1 (с комментарием); n2 и n3 — отметкой раздела «отклонено»; f1 — как обычно. */
const MARKED_REMARKS = (text) => {
  let out = mark(text, 'f1', '+');
  out = mark(out, 'n1', '+', 'материала нет');
  return out.replace(/^## \[ \] Новые замечания ИИ/m, '## [-] Новые замечания ИИ');
};

test('apply: замечания ИИ пишутся только в журнал и applied.json, портал для n… не вызывается', async () => {
  await withRun(MARKED_REMARKS, async ({ outDir, runDir, reviewPath }) => {
    const portal = fakePortal();
    const { lines, log } = quiet();
    const now = () => new Date('2026-10-23T11:30:00.000Z');
    assert.equal(await runApply({}, { file: reviewPath }, { portal, outDir, now, log }), 0);

    // в портал ушёл только вердикт по f1
    assert.equal(portal.calls.post.length, 1);
    assert.deepEqual(portal.calls.post[0].body.items.map((i) => i.entity_id), ['row-1']);
    assert.ok(!JSON.stringify(portal.calls).includes('"n1"'));

    const applied = JSON.parse(readFileSync(join(runDir, 'applied.json'), 'utf8'));
    assert.deepEqual(applied.n1, { decision: 'confirmed', at: '2026-10-23T11:30:00.000Z', comment: 'материала нет', bulk: false });
    assert.deepEqual(applied.n2, { decision: 'rejected', at: '2026-10-23T11:30:00.000Z', comment: '', bulk: true });
    assert.deepEqual(applied.n3, { decision: 'rejected', at: '2026-10-23T11:30:00.000Z', comment: '', bulk: true });

    const journal = readJsonl(join(outDir, 'decisions.jsonl'));
    const remarks = journal.filter((l) => l.kind === 'remark');
    assert.equal(journal.length, 4); // f1 + три замечания
    assert.deepEqual(remarks[0], {
      at: '2026-10-23T11:30:00.000Z', tender_id: 't-1', tender: '256 v3', kind: 'remark', code: 'AI-002', title: '',
      position_id: 'pos-2', item_id: 'row-2', ai_reason: 'Работа кладки без материала', ai_model: 'qwen',
      decision: 'confirmed', note: 'материала нет', bulk: false, origin: 'review', models: ['qwen', 'minimax'],
      prompt_version: 'review-v1@1a2b3c4d', skills_rev: 'a1b2c3d', run: '256-v3/2026-10-23_1405',
      snapshot: '256-v3/2026-10-23_1405/positions.json#pos-2',
    });
    const fresh = remarks.find((l) => l.code === 'NEW');
    assert.equal(fresh.title, 'Лишний слой');
    assert.equal(fresh.item_id, null);
    assert.equal(fresh.decision, 'rejected');
    assert.equal(fresh.bulk, true);

    const text = lines.join('\n');
    assert.match(text, /Замечания ИИ \(в портал не отправляются, только в журнал\):/);
    assert.match(text, /n1 {2}AI-002 {2}поз\. 13 «Кладка» {2}→ подтверждено {2}«ИИ-проверка: материала нет»/);
    assert.match(text, /Отправлено: 1, пропущено: \d+, замечаний записано: 3\./);

    const itog = readFileSync(join(runDir, 'itog.md'), 'utf8');
    assert.match(itog, /^Замечаний ИИ подтверждено: 1 · отклонено: 2$/m);
    assert.match(itog, /^## Замечания ИИ — подтверждено$/m);
    assert.match(itog, /^1\. AI-002 · поз\. 13 «Кладка» · \[открыть\]\([^)]*\) — материала нет$/m);
    assert.ok(!itog.includes('Лишний слой')); // отклонённое в итог не идёт

    // повторный apply: ничего не пишет и не дублирует журнал
    const again = quiet();
    assert.equal(await runApply({}, { file: reviewPath }, { portal: fakePortal(), outDir, now, log: again.log }), 0);
    assert.equal(readJsonl(join(outDir, 'decisions.jsonl')).length, 4);
    assert.match(again.lines.join('\n'), /Уже записано ранее: 3/);
    assert.match(again.lines.join('\n'), /замечаний записано: 0/);
  }, { remarks: true });
});

test('apply: замечание, отметка которого изменена после apply, пропускается с причиной', async () => {
  await withRun((t) => mark(t, 'n1', '+'), async ({ outDir, reviewPath }) => {
    const quietLog = quiet();
    await runApply({}, { file: reviewPath }, { portal: fakePortal(), outDir, log: quietLog.log });
    writeFileSync(reviewPath, readFileSync(reviewPath, 'utf8').replace(/^- \[\+\](.*‹n1›)/m, '- [-]$1'), 'utf8');
    const second = quiet();
    await runApply({}, { file: reviewPath }, { portal: fakePortal(), outDir, log: second.log });
    assert.match(second.lines.join('\n'), /ПРОПУЩЕНО n1 \(AI-002, поз\. 13 «Кладка»\): отметка изменена после apply — решение уже в журнале/);
    assert.equal(readJsonl(join(outDir, 'decisions.jsonl')).length, 1);
  }, { remarks: true });
});

test('apply --dry-run: замечания показываются, но ничего не пишется', async () => {
  await withRun((t) => mark(t, 'n1', '+', 'да'), async ({ outDir, runDir, reviewPath }) => {
    const portal = fakePortal();
    const { lines, log } = quiet();
    assert.equal(await runApply({}, { file: reviewPath, dryRun: true }, { portal, outDir, log }), 0);
    assert.equal(portal.calls.post.length, 0);
    assert.equal(existsSync(join(runDir, 'applied.json')), false);
    assert.equal(existsSync(join(runDir, 'itog.md')), false);
    assert.equal(existsSync(join(outDir, 'decisions.jsonl')), false);
    const text = lines.join('\n');
    assert.match(text, /Замечания ИИ \(в портал не отправляются, только в журнал\):/);
    assert.match(text, /Было бы записано:/);
    assert.match(text, /n1 .*→ подтверждено/);
    assert.match(text, /замечаний ИИ к записи: 1/);
  }, { remarks: true });
});

test('apply: сбой отправки вердиктов не отменяет запись замечаний', async () => {
  await withRun((t) => mark(mark(t, 'f1', '+'), 'n1', '+'), async ({ outDir, runDir, reviewPath }) => {
    const { lines, log } = quiet();
    assert.equal(await runApply({}, { file: reviewPath }, { portal: fakePortal({ failPost: true }), outDir, log }), 1);
    assert.match(lines.join('\n'), /ОШИБКА отправки: HTTP 500/);
    const applied = JSON.parse(readFileSync(join(runDir, 'applied.json'), 'utf8'));
    assert.deepEqual(Object.keys(applied), ['n1']);
    assert.deepEqual(readJsonl(join(outDir, 'decisions.jsonl')).map((l) => l.kind), ['remark']);
  }, { remarks: true });
});

test('apply: run.json без remarks (старый) работает; ключ n… в нём — чужой', async () => {
  await withRun((t) => `${mark(t, 'f1', '+')}\n- [+] AI-001 ‹n1›\n`, async ({ outDir, reviewPath }) => {
    const { lines, log } = quiet();
    assert.equal(await runApply({}, { file: reviewPath }, { portal: fakePortal(), outDir, log }), 0);
    assert.match(lines.join('\n'), /ВНИМАНИЕ: строка \d+: ключ n1 не из этого прогона/);
    assert.match(lines.join('\n'), /замечаний записано: 0/);
    assert.ok(!readFileSync(join(reviewPath, '..', 'itog.md'), 'utf8').includes('Замечаний ИИ'));
  });
});

test('planRemarks: подтверждено/отклонено, повтор — done, изменение — skipped', () => {
  const remark = (key) => ({ key, type: 'AI-001', title: '', where: 'поз. 1' });
  const state = { remarks: [remark('n1'), remark('n2'), remark('n3'), remark('n4')] };
  const marks = new Map([
    ['n1', { mark: '+', comment: 'да', bulk: false }],
    ['n2', { mark: '-', comment: '', bulk: true }],
    ['n3', { mark: '+', comment: '', bulk: false }],
    ['n4', { mark: '-', comment: '', bulk: false }],
    ['f1', { mark: '+', comment: '', bulk: false }],
  ]);
  const applied = { n3: { decision: 'confirmed' }, n4: { decision: 'confirmed' } };
  const plan = planRemarks({ state, marks, applied });
  assert.deepEqual(plan.record.map((r) => `${r.key}:${r.decision}`), ['n1:confirmed', 'n2:rejected']);
  assert.equal(plan.record[0].comment, 'да');
  assert.equal(plan.record[1].bulk, true);
  assert.equal(plan.done, 1);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].key, 'n4');
  assert.match(plan.skipped[0].reason, /отметка изменена после apply — решение уже в журнале/);
  assert.deepEqual(planRemarks({ state: {}, marks, applied }), { record: [], skipped: [], done: 0 });
});

test('decisionOf: [+] — согласен с ИИ; в «Похоже на шум» это «Норма», где мнения нет — «Ошибка»', () => {
  const of = (label) => ({ combined: label ? { label } : null });
  assert.equal(decisionOf('+', of('likely_error')), 'error');
  assert.equal(decisionOf('-', of('likely_error')), 'accepted');
  assert.equal(decisionOf('+', of('likely_ok')), 'accepted');
  assert.equal(decisionOf('-', of('likely_ok')), 'error');
  assert.equal(decisionOf('+', of('unsure')), 'error');
  assert.equal(decisionOf('-', of(null)), 'accepted');
});
