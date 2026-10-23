// Тесты навыков ИИ: node --test scripts/ai-review/test/skills.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SKILLS_PATH, parseSkills, loadSkills, renderSkillsForPrompt, activeCodes, applySkillEdits,
} from '../lib/skills.mjs';

const FIXTURE = [
  '# Навыки ИИ',
  '',
  'Преамбула с примером:',
  '',
  '```',
  '## GA · это пример внутри блока кода',
  '```',
  '',
  '## Формат записи',
  '',
  'Текст раздела преамбулы.',
  '',
  '## GA · Дубль материала при одной привязке',
  '<!-- kind: rule; rule: GA; status: active; auto: no; added: 2026-10-22; owner: human -->',
  '**Суть правила:** материал заведён дважды.',
  '**Норма, если:** слои.',
  '',
  '## GA-1 · Утеплитель двумя слоями',
  '<!-- kind: exception; rule: GA; status: active; auto: no; added: 2026-10-22 -->',
  '**Когда:** норма.',
  '',
  '## A · Количество привязанного материала',
  '<!-- kind: rule; rule: A; status: active; auto: no; added: 2026-10-22 -->',
  '**Суть правила:** количество не сходится с формулой.',
  '',
  '## A-1 · К перев от 100 мм',
  '<!-- kind: exception; rule: A; status: active; auto: no; added: 2026-10-22 -->',
  '**Когда:** ошибка.',
  '',
].join('\n');

const toCrlf = (s) => s.replace(/\n/g, '\r\n');
const TODAY = '2026-11-01';

test('SKILLS_PATH — абсолютный путь к AI-SKILLS.md', () => {
  assert.ok(SKILLS_PATH.startsWith('/') || /^[A-Za-z]:/.test(SKILLS_PATH));
  assert.ok(SKILLS_PATH.endsWith('AI-SKILLS.md'));
});

test('разбор фикстуры: преамбула, записи, мета, лишний ключ', () => {
  const { preamble, entries } = parseSkills(FIXTURE);
  assert.ok(preamble.startsWith('# Навыки ИИ'));
  assert.ok(preamble.includes('## Формат записи'));
  assert.ok(preamble.includes('## GA · это пример внутри блока кода'));
  assert.ok(!preamble.endsWith('\n'));
  assert.deepEqual(entries.map((e) => e.code), ['GA', 'GA-1', 'A', 'A-1']);
  const ga = entries[0];
  assert.equal(ga.title, 'Дубль материала при одной привязке');
  assert.equal(ga.kind, 'rule');
  assert.equal(ga.rule, 'GA');
  assert.equal(ga.status, 'active');
  assert.equal(ga.auto, 'no');
  assert.equal(ga.added, '2026-10-22');
  assert.equal(ga.meta.owner, 'human');
  assert.equal(ga.body, '**Суть правила:** материал заведён дважды.\n**Норма, если:** слои.');
  assert.equal(entries[1].kind, 'exception');
  assert.equal(entries[1].rule, 'GA');
  assert.equal(entries[1].body, '**Когда:** норма.');
});

test('разбор CRLF-файла даёт те же записи', () => {
  const a = parseSkills(FIXTURE);
  const b = parseSkills(toCrlf(FIXTURE));
  assert.deepEqual(b.entries, a.entries);
  assert.equal(b.preamble, a.preamble);
});

test('повтор кода — ошибка с кодом и номером строки', () => {
  const text = `${FIXTURE}\n## GA-1 · Ещё раз\n<!-- kind: exception; rule: GA -->\nтело\n`;
  assert.throws(() => parseSkills(text), (err) => /GA-1/.test(err.message) && /строка \d+/.test(err.message));
});

test('«## » без « · » после первой записи — ошибка с номером строки', () => {
  const text = '# Заголовок\n\n## A · Запись\nтело\n\n## Просто раздел\nтекст\n';
  assert.throws(() => parseSkills(text), /строка 6/);
});

test('«## » с неверным кодом после первой записи — ошибка', () => {
  const text = '## A · Запись\nтело\n\n## wrong · Название\nтекст\n';
  assert.throws(() => parseSkills(text), /строка 4/);
});

test('«## » внутри блока кода в теле — не заголовок', () => {
  const text = '## A · Запись\n<!-- kind: rule; rule: A -->\n```\n## не заголовок\n```\n';
  const { entries } = parseSkills(text);
  assert.equal(entries.length, 1);
  assert.ok(entries[0].body.includes('## не заголовок'));
});

test('запись без меты: вид по шаблону кода', () => {
  const text = '## GA · Правило\nтело правила\n\n## GA-2 · Исключение\nтело исключения\n\n## AI-007 · Замечание\nтело замечания\n';
  const [rule, exc, remark] = parseSkills(text).entries;
  assert.deepEqual([rule.kind, rule.rule, rule.status, rule.auto, rule.added], ['rule', 'GA', 'active', 'no', null]);
  assert.deepEqual([exc.kind, exc.rule], ['exception', 'GA']);
  assert.deepEqual([remark.kind, remark.rule], ['remark', null]);
  assert.equal(rule.body, 'тело правила');
  assert.deepEqual(rule.meta, {});
});

test('мета: неизвестный status — ошибка', () => {
  assert.throws(() => parseSkills('## A · Т\n<!-- status: broken -->\nтело\n'), /status/);
});

test('renderSkillsForPrompt: выбор по ruleCodes, rule → exception, без меты', () => {
  const { entries } = parseSkills(FIXTURE);
  const out = renderSkillsForPrompt(entries, new Set(['GA']));
  assert.equal(
    out,
    '### GA · Дубль материала при одной привязке\n'
    + '**Суть правила:** материал заведён дважды.\n**Норма, если:** слои.\n\n'
    + '### GA-1 · Утеплитель двумя слоями\n**Когда:** норма.',
  );
  assert.ok(!out.includes('<!--'));
  assert.equal(renderSkillsForPrompt(entries, ['ZZ']), '');
  // порядок групп — как в файле
  const both = renderSkillsForPrompt(entries, ['A', 'GA']);
  assert.ok(both.indexOf('### GA ·') < both.indexOf('### A ·'));
});

test('renderSkillsForPrompt: exception, стоящий в файле раньше правила, идёт после него', () => {
  const text = '## GA-1 · Исключение\nисключение\n\n## GA · Правило\nправило\n';
  const out = renderSkillsForPrompt(parseSkills(text).entries, ['GA']);
  assert.ok(out.indexOf('### GA ·') < out.indexOf('### GA-1 ·'));
});

test('renderSkillsForPrompt: retired не попадает, remark — по includeRemarks', () => {
  const text = [
    '## GA · Правило\nправило\n',
    '## GA-1 · Снятое\n<!-- kind: exception; rule: GA; status: retired -->\nснято\n',
    '## AI-001 · Замечание\n<!-- kind: remark; status: active -->\nзамечание\n',
    '## AI-002 · Снятое замечание\n<!-- kind: remark; status: retired -->\nснято\n',
  ].join('\n');
  const { entries } = parseSkills(text);
  const without = renderSkillsForPrompt(entries, ['GA']);
  assert.ok(without.includes('### GA ·'));
  assert.ok(!without.includes('GA-1') && !without.includes('AI-001'));
  const withRemarks = renderSkillsForPrompt(entries, ['GA'], { includeRemarks: true });
  assert.ok(withRemarks.includes('### AI-001 · Замечание\nзамечание'));
  assert.ok(!withRemarks.includes('AI-002'));
  assert.equal(renderSkillsForPrompt(entries, [], { includeRemarks: true }), '### AI-001 · Замечание\nзамечание');
});

test('activeCodes: только активные', () => {
  const text = '## A · Т\nтело\n\n## A-1 · Т\n<!-- status: retired -->\nтело\n';
  assert.deepEqual([...activeCodes(parseSkills(text).entries)], ['A']);
});

test('applySkillEdits: пустой массив правок — текст байт-в-байт', () => {
  assert.equal(applySkillEdits(FIXTURE, []).text, FIXTURE);
  assert.equal(applySkillEdits(toCrlf(FIXTURE), []).text, toCrlf(FIXTURE));
  assert.deepEqual(applySkillEdits(FIXTURE, []), { text: FIXTURE, applied: [], errors: [] });
});

test('add exception встаёт после последней записи своего правила', () => {
  const r = applySkillEdits(FIXTURE, [
    { op: 'add', code: 'GA-2', title: 'Новая норма', kind: 'exception', rule: 'GA', body: '**Когда:** тоже норма.' },
  ], { today: TODAY });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.applied, ['add GA-2']);
  const { entries } = parseSkills(r.text);
  assert.deepEqual(entries.map((e) => e.code), ['GA', 'GA-1', 'GA-2', 'A', 'A-1']);
  const added = entries[2];
  assert.deepEqual([added.kind, added.rule, added.status, added.auto, added.added], ['exception', 'GA', 'active', 'no', TODAY]);
  assert.equal(added.body, '**Когда:** тоже норма.');
  assert.ok(r.text.includes('## GA-2 · Новая норма\n<!-- kind: exception; rule: GA; status: active; auto: no; added: 2026-11-01 -->\n'));
  // записи после вставки и всё до неё не изменились
  const idx = r.text.indexOf('## GA-2');
  assert.equal(r.text.slice(0, idx), FIXTURE.slice(0, idx));
  assert.ok(r.text.endsWith(FIXTURE.slice(FIXTURE.indexOf('## A · '))));
  assert.ok(r.text.includes('**Когда:** тоже норма.\n\n## A · '));
});

test('add: rule и exception без записей правила уходят в конец', () => {
  const r = applySkillEdits(FIXTURE, [
    { op: 'add', code: 'B', title: 'Смешанная привязка', kind: 'rule', body: 'тело B' },
    { op: 'add', code: 'B-1', title: 'Норма B', kind: 'exception', rule: 'B', body: 'тело B-1' },
    { op: 'add', code: 'ZZ-1', title: 'Без правила', kind: 'exception', body: 'тело ZZ-1' },
  ], { today: TODAY });
  assert.deepEqual(r.errors, []);
  const { entries } = parseSkills(r.text);
  assert.deepEqual(entries.map((e) => e.code), ['GA', 'GA-1', 'A', 'A-1', 'B', 'B-1', 'ZZ-1']);
  assert.equal(entries[4].rule, 'B');
  assert.ok(r.text.startsWith(FIXTURE));
});

test('add в файл без завершающего перевода строки и в пустой текст', () => {
  const noEol = FIXTURE.replace(/\n+$/, '');
  const r = applySkillEdits(noEol, [{ op: 'add', code: 'B', title: 'Т', kind: 'rule', body: 'тело' }], { today: TODAY });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(parseSkills(r.text).entries.map((e) => e.code), ['GA', 'GA-1', 'A', 'A-1', 'B']);
  const empty = applySkillEdits('', [{ op: 'add', code: 'B', title: 'Т', kind: 'rule', body: 'тело' }], { today: TODAY });
  assert.ok(empty.text.startsWith('## B · Т\n'));
  assert.equal(parseSkills(empty.text).entries.length, 1);
});

test('add в CRLF-файл сохраняет CRLF', () => {
  const crlf = toCrlf(FIXTURE);
  const r = applySkillEdits(crlf, [{ op: 'add', code: 'B', title: 'Т', kind: 'rule', body: 'строка 1\nстрока 2' }], { today: TODAY });
  assert.deepEqual(r.errors, []);
  assert.ok(r.text.startsWith(crlf));
  assert.ok(!/(^|[^\r])\n/.test(r.text));
});

test('add: занятый код, неверный kind и шаблон кода — в errors, остальные правки применяются', () => {
  const r = applySkillEdits(FIXTURE, [
    { op: 'add', code: 'GA-1', title: 'Т', kind: 'exception', rule: 'GA', body: 'x' },
    { op: 'add', code: 'GA', title: 'Т', kind: 'exception', body: 'x' },
    { op: 'add', code: 'ga-3', title: 'Т', kind: 'exception', body: 'x' },
    { op: 'add', code: 'AI-1', title: 'Т', kind: 'remark', body: 'x' },
    { op: 'add', code: 'A-2', title: 'Т', kind: 'whatever', body: 'x' },
    { op: 'add', code: 'GA-5', title: 'Т', kind: 'exception', rule: 'A', body: 'x' },
    { op: 'add', code: 'A-2', title: 'Т', kind: 'exception', body: '## сломает разбор' },
    { op: 'add', code: 'AI-001', title: 'Замечание', kind: 'remark', body: 'замечание' },
  ], { today: TODAY });
  assert.equal(r.errors.length, 7);
  assert.ok(r.errors[0].includes('GA-1') && r.errors[0].includes('уже существует'));
  assert.deepEqual(r.applied, ['add AI-001']);
  assert.deepEqual(parseSkills(r.text).entries.map((e) => e.code), ['GA', 'GA-1', 'A', 'A-1', 'AI-001']);
  assert.equal(parseSkills(r.text).entries[4].rule, null);
});

test('replace: мета сохраняется, добавляется updated, остальное байт-в-байт', () => {
  const r = applySkillEdits(FIXTURE, [{ op: 'replace', code: 'GA', body: 'Новое тело.\nВторая строка.' }], { today: TODAY });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.applied, ['replace GA']);
  const { entries } = parseSkills(r.text);
  assert.equal(entries[0].title, 'Дубль материала при одной привязке');
  assert.equal(entries[0].body, 'Новое тело.\nВторая строка.');
  assert.equal(entries[0].meta.owner, 'human');
  assert.equal(entries[0].meta.added, '2026-10-22');
  assert.equal(entries[0].meta.updated, TODAY);
  assert.equal(entries[0].meta.kind, 'rule');
  const tailStart = FIXTURE.indexOf('## GA-1 ·');
  assert.ok(r.text.endsWith(FIXTURE.slice(tailStart)));
  assert.ok(r.text.startsWith(FIXTURE.slice(0, FIXTURE.indexOf('## GA · Дубль'))));
  // название меняется, если дано; повторная правка обновляет updated, а не дублирует
  const r2 = applySkillEdits(r.text, [{ op: 'replace', code: 'GA', title: 'Новое название', body: 'ещё' }], { today: '2026-12-01' });
  const ga = parseSkills(r2.text).entries[0];
  assert.equal(ga.title, 'Новое название');
  assert.equal(ga.meta.updated, '2026-12-01');
  assert.equal(r2.text.match(/updated:/g).length, 1);
});

test('replace записи без меты: мета появляется со значениями по умолчанию', () => {
  const r = applySkillEdits('## A · Т\nстарое\n', [{ op: 'replace', code: 'A', body: 'новое' }], { today: TODAY });
  const [a] = parseSkills(r.text).entries;
  assert.deepEqual([a.kind, a.rule, a.status, a.auto, a.body], ['rule', 'A', 'active', 'no', 'новое']);
  assert.equal(a.meta.updated, TODAY);
});

test('retire: status retired и retired-дата, тело не трогается', () => {
  const r = applySkillEdits(FIXTURE, [{ op: 'retire', code: 'GA-1' }], { today: TODAY });
  assert.deepEqual(r.errors, []);
  const ga1 = parseSkills(r.text).entries[1];
  assert.equal(ga1.status, 'retired');
  assert.equal(ga1.meta.retired, TODAY);
  assert.equal(ga1.body, '**Когда:** норма.');
  assert.equal(activeCodes(parseSkills(r.text).entries).has('GA-1'), false);
});

test('set-auto: yes — ошибка, paused и no применяются', () => {
  const bad = applySkillEdits(FIXTURE, [{ op: 'set-auto', code: 'GA', auto: 'yes' }]);
  assert.equal(bad.text, FIXTURE);
  assert.deepEqual(bad.applied, []);
  assert.ok(bad.errors[0].includes('auto: yes ставит только человек'));

  const paused = applySkillEdits(FIXTURE, [{ op: 'set-auto', code: 'GA', auto: 'paused' }]);
  assert.deepEqual(paused.errors, []);
  assert.equal(parseSkills(paused.text).entries[0].auto, 'paused');
  const back = applySkillEdits(paused.text, [{ op: 'set-auto', code: 'GA', auto: 'no' }]);
  assert.equal(parseSkills(back.text).entries[0].auto, 'no');

  const junk = applySkillEdits(FIXTURE, [{ op: 'set-auto', code: 'GA', auto: 'maybe' }]);
  assert.equal(junk.errors.length, 1);
});

test('неизвестные код и операция — в errors', () => {
  const r = applySkillEdits(FIXTURE, [
    { op: 'retire', code: 'NOPE' },
    { op: 'replace', code: 'NOPE-1', body: 'x' },
    { op: 'explode', code: 'A' },
  ]);
  assert.equal(r.errors.length, 3);
  assert.equal(r.text, FIXTURE);
});

test('правки в CRLF-файле не трогают чужие записи', () => {
  const crlf = toCrlf(FIXTURE);
  const r = applySkillEdits(crlf, [{ op: 'retire', code: 'A' }], { today: TODAY });
  assert.deepEqual(r.errors, []);
  assert.ok(r.text.startsWith(crlf.slice(0, crlf.indexOf('## A · '))));
  assert.ok(r.text.endsWith(crlf.slice(crlf.indexOf('## A-1 ·'))));
  assert.ok(!/(^|[^\r])\n/.test(r.text));
});

test('loadSkills: временный файл — записи и rev из 7 hex; отсутствующий — rev none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skills-'));
  try {
    const path = join(dir, 'AI-SKILLS.md');
    writeFileSync(path, FIXTURE);
    const loaded = loadSkills(path);
    assert.equal(loaded.path, path);
    assert.match(loaded.rev, /^[0-9a-f]{7}$/);
    assert.equal(loaded.entries.length, 4);
    writeFileSync(path, `${FIXTURE}\n## B · Т\nтело\n`);
    assert.notEqual(loadSkills(path).rev, loaded.rev);

    const missing = join(dir, 'нет.md');
    assert.deepEqual(loadSkills(missing), { entries: [], rev: 'none', path: missing });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('настоящий AI-SKILLS.md разбирается; четыре стартовых типа замечаний AI-001…AI-004 уходят в промпт', () => {
  const { entries } = loadSkills();
  const remarks = entries.filter((e) => e.kind === 'remark');
  assert.deepEqual(remarks.map((e) => e.code), ['AI-001', 'AI-002', 'AI-003', 'AI-004']);
  assert.ok(remarks.every((e) => e.status === 'active' && e.auto === 'no' && e.rule === null));
  for (const e of remarks) {
    assert.match(e.body, /^\*\*Признак:\*\*/);
    assert.match(e.body, /\*\*Норма, если:\*\*/);
    assert.match(e.body, /\*\*Как проверить:\*\*/);
  }
  const text = renderSkillsForPrompt(entries, [], { includeRemarks: true });
  assert.equal((text.match(/^### AI-\d{3} · /gm) ?? []).length, 4);
  assert.ok(!/^### AI-/m.test(renderSkillsForPrompt(entries, ['GA'])));
});
