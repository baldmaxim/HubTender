import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findLatestRun, indexFresh, planAssessments, planAuto, runPublish } from '../lib/publish.mjs';
import { parseSkills } from '../lib/skills.mjs';
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
  '## GA-2 · Выведено из работы',
  '<!-- kind: exception; rule: GA; status: retired; auto: yes; added: 2026-10-22 -->',
  'Тело.',
  '',
  '## GA-3 · Ручной',
  '<!-- kind: exception; rule: GA; status: active; auto: no; added: 2026-10-22 -->',
  'Тело.',
  '',
  '## P-1 · Чужое правило',
  '<!-- kind: exception; rule: P; status: active; auto: yes; added: 2026-10-22 -->',
  'Тело.',
  '',
].join('\n');

const skills = parseSkills(SKILLS_TEXT);

const okAi = (patch = {}) => ({ label: 'likely_ok', reason: 'два слоя', evidence: [], basis: 'GA-1', downgraded: false, status: 'ok', think: false, ...patch });

/** Состояние с одной находкой GA, которую можно снять автоматически (f2), плюс остальные из makeState. */
const buildState = () => {
  const state = makeState();
  const f2 = state.items[1];
  f2.moneyDelta = 48_000;
  f2.ai = { qwen: okAi(), minimax: okAi({ reason: 'разные слои' }) };
  f2.combined = { label: 'likely_ok', reason: 'два слоя', basis: 'GA-1', agree: true };
  return state;
};

const freshReport = (patch = {}) => {
  const f = (code, entityId, fingerprint, verdict = null) => ({ rule_code: code, entity_id: entityId, fingerprint, verdict });
  return [f('P', 'row-1', 'fp-1'), f('GA', 'row-2', 'fp-2'), f('Q', 'pos-3', 'CHANGED'), f('T', 't-1', 'fp-4', 'error'), ...(patch.extra ?? [])];
};

const freshOf = (findings = freshReport()) => indexFresh({ findings });

const autoItem = (state) => state.items[1];

test('planAssessments: только находки с меткой и свежим отпечатком; метки и поля контракта', () => {
  const state = buildState();
  const plan = planAssessments(state, freshOf());
  // f1 (error), f2 (ok) — в портале с тем же отпечатком; f3 (unsure) — отпечаток изменился; f4 — без разбора.
  assert.deepEqual(plan.entries.map((e) => e.key), ['f1', 'f2']);
  assert.equal(plan.skipped, 1);
  assert.deepEqual(plan.entries.map((e) => e.payload.label), ['likely_error', 'likely_ok']);
  assert.deepEqual(plan.entries[0].payload.finding_id, 'fid-1');
  assert.equal(plan.entries[0].payload.fingerprint, 'fp-1');
  assert.equal(plan.entries[0].payload.reason, '125 ₽/м³ при медиане 4 800');
  assert.equal(plan.modelId, 'qwen3.8-27b-pricer-rl648 + minimax/m3');
  assert.equal(plan.promptVersion, 'ext:review-v1@1a2b3c4d@a1b2c3d');
});

test('planAssessments: находки нет в свежем отчёте — пропуск; finding_id берётся из свежего отчёта', () => {
  const state = buildState();
  const fresh = freshOf([{ rule_code: 'P', entity_id: 'row-1', fingerprint: 'fp-1', finding_id: 'srv-1' }]);
  const plan = planAssessments(state, fresh);
  assert.deepEqual(plan.entries.map((e) => [e.key, e.payload.finding_id]), [['f1', 'srv-1']]);
  assert.equal(plan.skipped, 2);
});

test('planAssessments: evidence — «метка · поле» или ref, без повторов, не больше 10', () => {
  const state = buildState();
  const ev = (label, field, value, ref = `x.${field}`) => ({ ref, field, entity: 'row', entityId: 'row-1', value, label });
  state.items[0].ai.qwen.evidence = [ev('ПСБ-С 25', 'unit_rate', 125), ev('', 'unit', 'м3', 'r1.unit'), ev('ПСБ-С 25', 'unit_rate', 125)];
  const plan = planAssessments(state, freshOf());
  assert.deepEqual(plan.entries[0].payload.evidence, [
    { ref: 'ПСБ-С 25 · unit_rate', value: '125' },
    { ref: 'r1.unit', value: 'м3' },
  ]);

  state.items[0].ai.qwen.evidence = Array.from({ length: 15 }, (_v, i) => ev('Строка', `f${i}`, i));
  assert.equal(planAssessments(state, freshOf()).entries[0].payload.evidence.length, 10);
});

test('planAssessments: reason режется до 2000, prompt_version — до 100, без skillsRev — без «@»', () => {
  const state = buildState();
  state.items[0].combined.reason = 'я'.repeat(2500);
  state.promptVersion = 'п'.repeat(150);
  let plan = planAssessments(state, freshOf());
  assert.equal(Array.from(plan.entries[0].payload.reason).length, 2000);
  assert.equal(Array.from(plan.promptVersion).length, 100);

  const clean = buildState();
  clean.skillsRev = undefined;
  assert.equal(planAssessments(clean, freshOf()).promptVersion, 'ext:review-v1@1a2b3c4d');
  clean.models = [{ name: 'qwen', model: 'm'.repeat(300) }];
  plan = planAssessments(clean, freshOf());
  assert.equal(Array.from(plan.modelId).length, 200);
});

test('planAuto: положительный случай — вердикт «Норма» с нотой «ИИ-авто: код — причина»', () => {
  const state = buildState();
  const plan = planAuto(state, freshOf(), skills, { maxRub: 100_000 });
  assert.equal(plan.send.length, 1);
  assert.equal(plan.send[0].key, 'f2');
  assert.equal(plan.send[0].code, 'GA-1');
  assert.equal(plan.send[0].note, 'ИИ-авто: GA-1 — два слоя');
});

test('planAuto: нота режется до 500 символов и сводится в одну строку', () => {
  const state = buildState();
  state.items[1].combined.reason = 'слово\n'.repeat(300);
  const { note } = planAuto(state, freshOf(), skills, { maxRub: 100_000 }).send[0];
  assert.equal(Array.from(note).length, 500);
  assert.ok(!note.includes('\n'));
});

/** Применяет правку к f2 и проверяет, что автоотсев её отсёк. */
const rejects = (name, edit, { fresh, opts, skillsOverride } = {}) =>
  test(`planAuto: не снимает — ${name}`, () => {
    const state = buildState();
    edit(autoItem(state), state);
    const plan = planAuto(state, fresh ?? freshOf(), skillsOverride ?? skills, { maxRub: 100_000, ...opts });
    assert.deepEqual(plan.send, []);
  });

rejects('итоговая метка не «норма»', (item) => {
  item.combined.label = 'likely_error';
});
rejects('модель не ответила для всех (нет ai)', (item) => {
  item.ai = {};
});
rejects('одна из моделей считает иначе', (item) => {
  item.ai.minimax.label = 'likely_error';
});
rejects('оценка downgraded', (item) => {
  item.ai.qwen.downgraded = true;
});
rejects('у моделей разное основание', (item) => {
  item.ai.minimax.basis = 'GA-3';
});
rejects('основания нет', (item) => {
  item.ai.qwen.basis = '';
  item.ai.minimax.basis = '';
});
rejects('записи основания нет в навыках', (item) => {
  item.ai.qwen.basis = 'GA-9';
  item.ai.minimax.basis = 'GA-9';
});
rejects('auto: no у записи', (item) => {
  item.ai.qwen.basis = 'GA-3';
  item.ai.minimax.basis = 'GA-3';
});
rejects('запись выведена из работы (retired)', (item) => {
  item.ai.qwen.basis = 'GA-2';
  item.ai.minimax.basis = 'GA-2';
});
rejects('запись относится к другому правилу', (item) => {
  item.ai.qwen.basis = 'P-1';
  item.ai.minimax.basis = 'P-1';
});
rejects('сумма |Δ| не меньше порога', (item) => {
  item.moneyDelta = -100_000;
});
rejects('суммы нет', (item) => {
  item.moneyDelta = null;
});
rejects('отпечаток в портале изменился', () => {}, { fresh: freshOf(freshReport().map((f) => (f.entity_id === 'row-2' ? { ...f, fingerprint: 'NEW' } : f))) });
rejects('находки в портале больше нет', () => {}, { fresh: freshOf(freshReport().filter((f) => f.entity_id !== 'row-2')) });
rejects('в портале уже «Норма»', () => {}, { fresh: freshOf(freshReport().map((f) => (f.entity_id === 'row-2' ? { ...f, verdict: 'accepted' } : f))) });
rejects('в портале уже «Ошибка» (человек решил)', () => {}, { fresh: freshOf(freshReport().map((f) => (f.entity_id === 'row-2' ? { ...f, verdict: 'error' } : f))) });
rejects('уже снято этим прогоном', () => {}, { opts: { applied: { f2: { decision: 'accepted', auto: true } } } });

test('planAuto: порог — строго меньше; повтор считается как «уже снято»', () => {
  const state = buildState();
  state.items[1].moneyDelta = 99_999;
  assert.equal(planAuto(state, freshOf(), skills, { maxRub: 100_000 }).send.length, 1);
  assert.equal(planAuto(state, freshOf(), skills, { maxRub: 99_999 }).send.length, 0);
  const again = planAuto(state, freshOf(), skills, { maxRub: 100_000, applied: { f2: { decision: 'accepted', auto: true } } });
  assert.deepEqual([again.send.length, again.done], [0, 1]);
});

test('planAuto: одна модель с основанием — достаточно; сбойная модель не мешает', () => {
  const state = buildState();
  state.items[1].ai.minimax = okAi({ label: 'unsure', status: 'error', basis: '' });
  assert.equal(planAuto(state, freshOf(), skills, { maxRub: 100_000 }).send.length, 1);
});

// --- runPublish ----------------------------------------------------------------

const fakePortal = ({ findings = freshReport(), failAssessments = false, failVerdicts = false } = {}) => {
  const calls = { get: [], post: [] };
  return {
    baseUrl: 'https://gp.su10.ru',
    calls,
    get: async (path, query) => {
      calls.get.push({ path, query });
      if (path === `/api/v1/tenders/${TENDER}/quality`) return { findings, errors: [] };
      throw new Error(`неожиданный путь ${path}`);
    },
    post: async (path, body) => {
      if (path.endsWith('/ai-assessments')) {
        if (failAssessments) throw new Error('HTTP 500');
        calls.post.push({ path, body });
        return { saved: body.items.length - 1, skipped: 1 };
      }
      if (failVerdicts) throw new Error('HTTP 500');
      calls.post.push({ path, body });
      return null;
    },
  };
};

const withRun = async (fn) => {
  const outDir = mkdtempSync(join(tmpdir(), 'ai-review-publish-'));
  try {
    const runDir = join(outDir, '256-v3', '2026-10-23_1405');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'run.json'), JSON.stringify(buildState()), 'utf8');
    return await fn({ outDir, runDir });
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
};

const quiet = () => {
  const lines = [];
  return { lines, log: (l) => lines.push(l) };
};

const readJsonl = (file) => readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const now = () => new Date(2026, 9, 26, 12, 0);

test('publish: метки и автовердикты уходят, журнал kind auto, applied.json, итоговая строка; повтор не шлёт вердикт снова', async () => {
  await withRun(async ({ outDir, runDir }) => {
    const portal = fakePortal();
    const { lines, log } = quiet();
    const code = await runPublish({ autoMaxRub: 100_000 }, { dir: runDir }, { portal, outDir, skills, now, log });
    assert.equal(code, 0);

    const [assessments, verdicts] = portal.calls.post;
    assert.equal(assessments.path, `/api/v1/tenders/${TENDER}/verification/ai-assessments`);
    assert.equal(assessments.body.model_id, 'qwen3.8-27b-pricer-rl648 + minimax/m3');
    assert.equal(assessments.body.prompt_version, 'ext:review-v1@1a2b3c4d@a1b2c3d');
    assert.deepEqual(assessments.body.items.map((i) => i.finding_id), ['fid-1', 'fid-2']);
    assert.equal(verdicts.path, `/api/v1/tenders/${TENDER}/quality/verdicts`);
    assert.deepEqual(verdicts.body.items, [
      { rule_code: 'GA', entity_id: 'row-2', fingerprint: 'fp-2', verdict: 'accepted', note: 'ИИ-авто: GA-1 — два слоя' },
    ]);

    const applied = JSON.parse(readFileSync(join(runDir, 'applied.json'), 'utf8'));
    assert.deepEqual(Object.keys(applied), ['f2']);
    assert.equal(applied.f2.decision, 'accepted');
    assert.equal(applied.f2.auto, true);
    assert.equal(applied.f2.code, 'GA-1');

    const journal = readJsonl(join(outDir, 'decisions.jsonl'));
    assert.equal(journal.length, 1);
    assert.equal(journal[0].kind, 'auto');
    assert.equal(journal[0].origin, 'auto');
    assert.equal(journal[0].decision, 'accepted');
    assert.equal(journal[0].code, 'GA');
    assert.equal(journal[0].auto_code, 'GA-1');
    assert.equal(journal[0].run, '256-v3/2026-10-23_1405');

    assert.equal(lines.at(-1), 'Метки ИИ: записано 1, пропущено 2; снято автоматически: 1 (по записям: GA-1 ×1)');

    // Повторный publish: метки обновляются, тот же автовердикт не уходит.
    const again = fakePortal();
    await runPublish({}, { dir: runDir }, { portal: again, outDir, skills, now, log: () => {} });
    assert.equal(again.calls.post.length, 1);
    assert.ok(again.calls.post[0].path.endsWith('/ai-assessments'));
    assert.equal(readJsonl(join(outDir, 'decisions.jsonl')).length, 1);
  });
});

test('publish --dry-run: ничего не отправляет и не пишет, печатает план', async () => {
  await withRun(async ({ outDir, runDir }) => {
    const portal = fakePortal();
    const { lines, log } = quiet();
    assert.equal(await runPublish({}, { dir: runDir, dryRun: true }, { portal, outDir, skills, now, log }), 0);
    assert.equal(portal.calls.post.length, 0);
    assert.equal(existsSync(join(runDir, 'applied.json')), false);
    assert.equal(existsSync(join(outDir, 'decisions.jsonl')), false);
    assert.ok(lines.some((l) => l.includes('Меток ИИ к записи: 2')));
    assert.ok(lines.some((l) => l.includes('f2') && l.includes('ИИ-авто: GA-1 — два слоя')));
    assert.ok(lines.at(-1).startsWith('Пробный запуск'));
  });
});

test('publish --no-auto: только метки, навыки не читаются', async () => {
  await withRun(async ({ outDir, runDir }) => {
    const portal = fakePortal();
    const { lines, log } = quiet();
    // deps.skills нет, а реальный AI-SKILLS.md не должен понадобиться
    assert.equal(await runPublish({}, { dir: runDir, noAuto: true }, { portal, outDir, now, log }), 0);
    assert.equal(portal.calls.post.length, 1);
    assert.equal(existsSync(join(outDir, 'decisions.jsonl')), false);
    assert.equal(lines.at(-1), 'Метки ИИ: записано 1, пропущено 2; снято автоматически: 0');
  });
});

test('publish: порог берётся из config.autoMaxRub', async () => {
  await withRun(async ({ outDir, runDir }) => {
    const portal = fakePortal();
    await runPublish({ autoMaxRub: 1000 }, { dir: runDir }, { portal, outDir, skills, now, log: () => {} });
    assert.equal(portal.calls.post.length, 1);
  });
});

test('publish: сбой записи меток — код 1, автоотсев всё равно идёт', async () => {
  await withRun(async ({ outDir, runDir }) => {
    const portal = fakePortal({ failAssessments: true });
    const { lines, log } = quiet();
    assert.equal(await runPublish({}, { dir: runDir }, { portal, outDir, skills, now, log }), 1);
    assert.equal(portal.calls.post.length, 1);
    assert.ok(lines.some((l) => l.startsWith('ОШИБКА записи меток ИИ')));
    assert.equal(readJsonl(join(outDir, 'decisions.jsonl')).length, 1);
  });
});

test('publish: сбой отправки автовердикта — ничего не журналируется, код 1', async () => {
  await withRun(async ({ outDir, runDir }) => {
    const portal = fakePortal({ failVerdicts: true });
    assert.equal(await runPublish({}, { dir: runDir }, { portal, outDir, skills, now, log: () => {} }), 1);
    assert.equal(existsSync(join(runDir, 'applied.json')), false);
    assert.equal(existsSync(join(outDir, 'decisions.jsonl')), false);
  });
});

test('publish: без каталога берётся последний прогон; нет прогонов или run.json — ошибка настроек', async () => {
  await withRun(async ({ outDir, runDir }) => {
    const later = join(outDir, '300-v1', '2026-10-25_0900');
    mkdirSync(later, { recursive: true });
    writeFileSync(join(later, 'run.json'), '{}', 'utf8');
    mkdirSync(join(outDir, 'cache', 'qwen'), { recursive: true });
    assert.equal(findLatestRun(outDir), later);
    // Каталог можно задать и путём к файлу внутри него.
    const portal = fakePortal();
    await runPublish({}, { dir: join(runDir, 'run.json'), dryRun: true }, { portal, outDir, skills, now, log: () => {} });
    await assert.rejects(runPublish({}, { dir: join(outDir, 'cache') }, { portal, outDir, skills }), /нет run\.json/);
  });
  const empty = mkdtempSync(join(tmpdir(), 'ai-review-publish-empty-'));
  try {
    await assert.rejects(runPublish({}, {}, { portal: fakePortal(), outDir: empty, skills }), /нет прогонов/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});
