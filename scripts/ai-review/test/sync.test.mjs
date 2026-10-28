import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexFresh } from '../lib/publish.mjs';
import { parseSkills } from '../lib/skills.mjs';
import { planSync, renderSync, runSync, summarize } from '../lib/sync.mjs';
import { makeState } from './helpers.mjs';

const TENDER = 't-1';

const SKILLS_TEXT = [
  '# Навыки',
  '',
  '## GA · Дубли',
  '<!-- kind: rule; rule: GA; status: active; auto: no; added: 2026-10-22 -->',
  'Тело.',
  '',
  '## GA-1 · Два слоя',
  '<!-- kind: exception; rule: GA; status: active; auto: yes; added: 2026-10-22 -->',
  'Тело.',
  '',
].join('\n');

// f1 P (ИИ ошибка), f2 GA (ИИ норма), f3 Q (ИИ не уверен), f4 T (без разбора)
const FPS = { f1: ['P', 'row-1', 'fp-1'], f2: ['GA', 'row-2', 'fp-2'], f3: ['Q', 'pos-3', 'fp-3'], f4: ['T', 't-1', 'fp-4'] };

/** Свежий отчёт: у каждой находки по умолчанию нет вердикта; patch — { fN: { verdict, note, fingerprint } }. */
const freshOf = (patch = {}) =>
  indexFresh({
    findings: Object.entries(FPS).map(([key, [rule_code, entity_id, fingerprint]]) => ({
      rule_code,
      entity_id,
      fingerprint,
      verdict: null,
      note: null,
      ...patch[key],
    })),
  });

const keysOf = (plan) => plan.actions.map((a) => a.key);

test('planSync: без вердиктов в портале и при другом отпечатке действий нет', () => {
  const state = makeState();
  assert.deepEqual(planSync(state, freshOf(), {}).actions, []);
  const changed = freshOf({ f1: { verdict: 'error', fingerprint: 'CHANGED' } });
  const plan = planSync(state, changed, {});
  assert.deepEqual(plan.actions, []);
  assert.deepEqual(plan.matched, []);
  // находки нет в свежем отчёте
  assert.deepEqual(planSync(state, indexFresh({ findings: [] }), {}).actions, []);
});

test('planSync: обычный вердикт человека → запись, decision в форме apply (error | accepted), bulk false', () => {
  const plan = planSync(makeState(), freshOf({ f1: { verdict: 'error', note: ' цена за м² ' }, f2: { verdict: 'accepted' } }), {});
  assert.deepEqual(plan.actions.map((a) => [a.key, a.decision, a.comment, a.bulk, a.rollback]), [
    ['f1', 'error', 'цена за м²', false, false],
    ['f2', 'accepted', '', false, false],
  ]);
  assert.equal(plan.matched.length, 2);
});

test('planSync: примечание «ИИ-авто» — пропуск, «ИИ-проверка» (в т. ч. отметка раздела) — пропуск', () => {
  const state = makeState();
  const plan = planSync(
    state,
    freshOf({
      f1: { verdict: 'error', note: 'ИИ-проверка: подтверждаю' },
      f2: { verdict: 'accepted', note: 'ИИ-авто: GA-1 — два слоя' },
      f3: { verdict: 'accepted', note: 'ИИ-проверка (отметка раздела)' },
    }),
    {},
  );
  assert.deepEqual(plan.actions, []);
  // но в общую картину они попадают; автоотсев помечен
  assert.deepEqual(plan.matched.map((m) => [m.key, m.autoSieved]), [['f1', false], ['f2', true], ['f3', false]]);
});

test('planSync: повторный sync не дублирует; другое решение — новая запись', () => {
  const state = makeState();
  const fresh = freshOf({ f1: { verdict: 'error' }, f3: { verdict: 'accepted', note: 'ок' } });
  const applied = { f1: { decision: 'error', origin: 'page' }, f3: { decision: 'error', origin: 'page' } };
  const plan = planSync(state, fresh, applied);
  assert.deepEqual(keysOf(plan), ['f3']); // человек передумал: было «Ошибка», стало «Норма»
  assert.equal(plan.actions[0].decision, 'accepted');
  assert.equal(plan.actions[0].rollback, false);
  assert.equal(plan.matched.length, 2); // уже бывшая в applied f1 — в общей картине
});

test('planSync: «ИИ-массово» → bulk true, префикс не попадает в комментарий', () => {
  const plan = planSync(
    makeState(),
    freshOf({ f1: { verdict: 'error', note: 'ИИ-массово' }, f2: { verdict: 'accepted', note: 'ИИ-массово: шум' }, f3: { verdict: 'error', note: 'ИИ-массово — слой' } }),
    {},
  );
  assert.deepEqual(plan.actions.map((a) => [a.key, a.bulk, a.comment]), [['f1', true, ''], ['f2', true, 'шум'], ['f3', true, 'слой']]);
});

test('planSync: откат автоотсева — «Ошибка» поверх applied.auto; «Норма» поверх auto — не откат', () => {
  const state = makeState();
  const applied = { f2: { decision: 'accepted', auto: true, code: 'GA-1', fingerprint: 'fp-2' } };
  const back = planSync(state, freshOf({ f2: { verdict: 'error', note: 'ИИ-авто: GA-1 — два слоя' } }), applied);
  assert.equal(back.actions.length, 1);
  assert.deepEqual(
    [back.actions[0].key, back.actions[0].decision, back.actions[0].rollback, back.actions[0].rollbackCode, back.actions[0].comment],
    ['f2', 'error', true, 'GA-1', ''],
  );
  assert.equal(back.matched[0].autoSieved, false);

  const withNote = planSync(state, freshOf({ f2: { verdict: 'error', note: 'нет, это дубль' } }), applied);
  assert.equal(withNote.actions[0].comment, 'нет, это дубль');

  const still = planSync(state, freshOf({ f2: { verdict: 'accepted', note: 'ИИ-авто: GA-1 — два слоя' } }), applied);
  assert.deepEqual(still.actions, []);
  assert.equal(still.matched[0].autoSieved, true);

  // после отката applied без auto: повторный sync тихий, даже если на странице осталось «ИИ-авто»
  const after = { f2: { decision: 'error', origin: 'page', fingerprint: 'fp-2' } };
  assert.deepEqual(planSync(state, freshOf({ f2: { verdict: 'error', note: 'ИИ-авто: GA-1 — два слоя' } }), after).actions, []);
});

test('summarize: таблица согласия, автоотсев вне таблицы, расхождения по сумме Δ', () => {
  const state = makeState();
  state.items.push({ ...state.items[0], key: 'f5', entityId: 'row-5', fingerprint: 'fp-5', moneyDelta: 5_000_000 });
  const matched = [
    { key: 'f1', item: state.items[0], verdict: 'accepted', note: 'это норма', autoSieved: false }, // ИИ ошибка / вы норма
    { key: 'f5', item: state.items[4], verdict: 'error', note: '', autoSieved: false }, // ИИ ошибка / вы ошибка
    { key: 'f2', item: state.items[1], verdict: 'error', note: 'дубль', autoSieved: false }, // ИИ норма / вы ошибка
    { key: 'f3', item: state.items[2], verdict: 'error', note: '', autoSieved: false }, // не уверен → ошибка
    { key: 'f4', item: state.items[3], verdict: 'accepted', note: '', autoSieved: false }, // без вердикта ИИ
    { key: 'f2', item: state.items[1], verdict: 'accepted', note: 'ИИ-авто: x', autoSieved: true },
  ];
  const s = summarize(matched);
  assert.deepEqual(s.counts, { 'err-err': 1, 'err-ok': 1, 'ok-ok': 0, 'ok-err': 1, 'unsure-err': 1, 'unsure-ok': 0, none: 1 });
  assert.equal(s.total, 5);
  assert.equal(s.auto, 1);
  assert.deepEqual(s.divergent.map((d) => [d.key, d.agreement]), [['f1', 'err-ok'], ['f2', 'ok-err'], ['f3', 'unsure-err']]);

  const md = renderSync(state, s, new Date(2026, 9, 27, 10, 5));
  assert.ok(md.startsWith('# Синхронизация вердиктов · тендер 256 v3 «Название» · 2026-10-27 10:05'));
  assert.ok(md.includes('| ИИ ошибка / вы норма | 1 |'));
  assert.ok(md.includes('| Всего с вердиктом | 5 |'));
  assert.ok(md.includes('Снято автоотсевом ИИ (в таблицу не входит): 1'));
  assert.ok(md.includes('1. f1 · P · поз. 12.3 «Утеплитель ПСБ-С 25» · Δ 1,2 млн ₽ — ИИ ошибка / вы норма'));
  assert.ok(md.includes('Вы: Норма — «это норма»'));
  assert.ok(md.includes('ИИ: ошибка — 125 ₽/м³ при медиане 4 800 (основание: P-1)'));
  assert.ok(md.includes('[открыть](https://gp.su10.ru/positions/pos-1/'));
  assert.ok(renderSync(state, summarize([]), new Date()).includes('Расхождений нет.'));
});

// --- runSync -------------------------------------------------------------------

const fakePortal = (findings) => {
  const calls = { get: [], post: [] };
  return {
    calls,
    get: async (path, query) => {
      calls.get.push({ path, query });
      if (path === `/api/v1/tenders/${TENDER}/quality`) return { findings, errors: [] };
      throw new Error(`неожиданный путь ${path}`);
    },
    post: async (path) => {
      calls.post.push(path);
      throw new Error('sync не должен ничего отправлять');
    },
  };
};

const reportFindings = () => [
  { rule_code: 'P', entity_id: 'row-1', fingerprint: 'fp-1', verdict: 'accepted', note: 'это норма' },
  { rule_code: 'GA', entity_id: 'row-2', fingerprint: 'fp-2', verdict: 'error', note: 'ИИ-авто: GA-1 — два слоя' },
  { rule_code: 'Q', entity_id: 'pos-3', fingerprint: 'fp-3', verdict: 'error', note: 'ИИ-массово: пачкой' },
  { rule_code: 'T', entity_id: 't-1', fingerprint: 'fp-4', verdict: 'error', note: 'ИИ-проверка' },
];

const withRun = async (fn) => {
  const root = mkdtempSync(join(tmpdir(), 'ai-review-sync-'));
  try {
    const outDir = join(root, 'out');
    const runDir = join(outDir, '256-v3', '2026-10-23_1405');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'run.json'), JSON.stringify(makeState()), 'utf8');
    // f2 был снят автоотсевом по GA-1
    writeFileSync(join(runDir, 'applied.json'), JSON.stringify({ f2: { decision: 'accepted', fingerprint: 'fp-2', auto: true, code: 'GA-1', at: 'x' } }), 'utf8');
    const skillsPath = join(root, 'AI-SKILLS.md'); // временная копия: настоящий файл не трогаем
    writeFileSync(skillsPath, SKILLS_TEXT, 'utf8');
    return await fn({ outDir, runDir, skillsPath });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const quiet = () => {
  const lines = [];
  return { lines, log: (l) => lines.push(l) };
};
const readJsonl = (file) => readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const now = () => new Date(2026, 9, 27, 12, 0);

test('runSync --dry-run: план и сводка в логе, ничего не записано (журнал, applied, sync.md, навыки)', async () => {
  await withRun(async ({ outDir, runDir, skillsPath }) => {
    const portal = fakePortal(reportFindings());
    const { lines, log } = quiet();
    const appliedBefore = readFileSync(join(runDir, 'applied.json'), 'utf8');
    assert.equal(await runSync({}, { dir: runDir, dryRun: true }, { portal, outDir, skillsPath, now, log }), 0);
    assert.equal(readFileSync(join(runDir, 'applied.json'), 'utf8'), appliedBefore);
    assert.equal(existsSync(join(outDir, 'decisions.jsonl')), false);
    assert.equal(existsSync(join(runDir, 'sync.md')), false);
    assert.equal(existsSync(join(runDir, 'itog.md')), false);
    assert.equal(readFileSync(skillsPath, 'utf8'), SKILLS_TEXT);
    assert.equal(portal.calls.post.length, 0);
    assert.ok(lines.some((l) => l.includes('к записи в журнал: 3 (откатов автоотсева: 1)')));
    assert.ok(lines.some((l) => l.includes('по записи GA-1') && l.startsWith('ВНИМАНИЕ')));
    assert.ok(lines.some((l) => l.includes('## Расхождения')));
    assert.ok(lines.at(-1).startsWith('Пробный запуск'));
  });
});

test('runSync: журнал origin page, applied.json, sync.md, откат автоотсева правит навыки; повтор ничего не дублирует', async () => {
  await withRun(async ({ outDir, runDir, skillsPath }) => {
    const { lines, log } = quiet();
    assert.equal(await runSync({}, { dir: runDir }, { portal: fakePortal(reportFindings()), outDir, skillsPath, now, log }), 0);

    const journal = readJsonl(join(outDir, 'decisions.jsonl'));
    assert.deepEqual(journal.map((j) => [j.code, j.decision, j.bulk, j.origin, j.kind, j.note]), [
      ['P', 'accepted', false, 'page', 'finding', 'это норма'],
      ['GA', 'error', false, 'page', 'finding', ''],
      ['Q', 'error', true, 'page', 'finding', 'пачкой'],
    ]);
    assert.equal(journal[0].run, '256-v3/2026-10-23_1405');
    assert.equal(journal[0].ai_label, 'likely_error');
    assert.equal(journal[0].at, now().toISOString());

    const applied = JSON.parse(readFileSync(join(runDir, 'applied.json'), 'utf8'));
    assert.deepEqual(Object.keys(applied).sort(), ['f1', 'f2', 'f3']);
    assert.equal(applied.f1.origin, 'page');
    assert.equal(applied.f1.fingerprint, 'fp-1');
    assert.equal(applied.f3.bulk, true);
    assert.equal(applied.f2.decision, 'error');
    assert.equal(applied.f2.auto, undefined); // откат: больше не автоотсев

    const skills = parseSkills(readFileSync(skillsPath, 'utf8')).entries;
    assert.equal(skills.find((e) => e.code === 'GA-1').auto, 'paused');
    assert.equal(skills.find((e) => e.code === 'GA').auto, 'no');

    const md = readFileSync(join(runDir, 'sync.md'), 'utf8');
    assert.ok(md.includes('| ИИ ошибка / вы норма | 1 |'));
    assert.ok(md.includes('| ИИ норма / вы ошибка | 1 |'));
    assert.ok(md.includes('| ИИ не уверен → ошибка | 1 |'));
    assert.ok(existsSync(join(runDir, 'itog.md')));
    assert.ok(lines.some((l) => l.includes('auto: paused — GA-1')));
    assert.ok(lines.some((l) => l.startsWith('Записано в журнал: 3.')));

    // Повтор: журнал и applied.json те же, sync.md перезаписан.
    const again = quiet();
    await runSync({}, { dir: runDir }, { portal: fakePortal(reportFindings()), outDir, skillsPath, now, log: again.log });
    assert.equal(readJsonl(join(outDir, 'decisions.jsonl')).length, 3);
    assert.ok(again.lines.some((l) => l.startsWith('Записано в журнал: 0.')));
    assert.ok(readFileSync(join(runDir, 'sync.md'), 'utf8').includes('| ИИ ошибка / вы норма | 1 |'));
  });
});

test('runSync: без каталога берёт последний прогон; отсутствие навыков — предупреждение, не сбой', async () => {
  await withRun(async ({ outDir, runDir }) => {
    const { lines, log } = quiet();
    const missing = join(outDir, 'нет-такого.md');
    assert.equal(await runSync({}, {}, { portal: fakePortal(reportFindings()), outDir, skillsPath: missing, now, log }), 0);
    assert.ok(lines[0].includes(runDir));
    assert.ok(lines.some((l) => l.startsWith('ВНИМАНИЕ') && l.includes('нет файла навыков')));
    assert.ok(existsSync(join(runDir, 'sync.md')));
    await assert.rejects(runSync({}, {}, { portal: fakePortal([]), outDir: join(outDir, 'пусто') }), /нет прогонов/);
  });
});
