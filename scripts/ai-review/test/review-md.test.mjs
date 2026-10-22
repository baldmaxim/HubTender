import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney } from '../lib/format.mjs';
import { parseReview, renderReview } from '../lib/review-md.mjs';
import { makeState } from './helpers.mjs';

const KNOWN = new Set(['f1', 'f2', 'f3', 'f4']);

test('render: разделы, шапка, строки моделей, расхождение, деньги, ссылка', () => {
  const text = renderReview(makeState());
  assert.match(text, /^# ИИ-проверка · тендер 256 v3 «Название» · 2026-10-23 14:05$/m);
  assert.match(text, /^Модели: qwen \(qwen3\.8-27b-pricer-rl648\), minimax \(minimax\/m3\) · промпт review-v1@1a2b3c4d · навыки a1b2c3d$/m);
  assert.match(text, /^## \[ \] По делу — ИИ считает ошибкой \(1\)$/m);
  assert.match(text, /^## \[ \] Похоже на шум \(1\)$/m);
  assert.match(text, /^## \[ \] Не уверен \(1\)$/m);
  assert.match(text, /^## Без разбора — находки по тендеру и справочнику \(1\)$/m);
  assert.match(text, /^- \[ \] P · поз\. 12\.3 «Утеплитель ПСБ-С 25» · Δ 1,2 млн ₽ · \[открыть\]\(https:\/\/gp\.su10\.ru\/positions\/pos-1\/items\?tenderId=t-1&positionId=pos-1&itemId=row-1\) ‹f1›$/m);
  assert.match(text, /^ {2}qwen: ошибка — 125 ₽\/м³ при медиане 4 800\. Основание: P-1$/m);
  assert.match(text, /^ {2}minimax: ошибка — цена за м² вместо м³\.$/m);
  assert.match(text, /^ {2}Данные: «ПСБ-С 25» цена 125; позиция: ед\. м3$/m);
  assert.match(text, /^ {2}Правило: Цена 125 при медиане 4800$/m);
  assert.match(text, /^- \[ \] ⚡ Q · поз\. 14 «Окраска» · Δ 950 ₽ · \[открыть\]\(.*\) ‹f3›$/m);
  assert.match(text, /^- \[ \] T · тендер ‹f4›$/m);
});

test('render: одна модель — строка «ИИ:»', () => {
  const state = makeState();
  state.models = [state.models[0]];
  for (const item of state.items) delete item.ai.minimax;
  const text = renderReview(state);
  assert.match(text, /^ {2}ИИ: 125 ₽\/м³ при медиане 4 800\. Основание: P-1$/m);
  assert.ok(!text.includes('minimax:'));
});

test('formatMoney', () => {
  assert.equal(formatMoney(1_200_000), 'Δ 1,2 млн ₽');
  assert.equal(formatMoney(48_000), 'Δ 48 тыс. ₽');
  assert.equal(formatMoney(1500), 'Δ 1,5 тыс. ₽');
  assert.equal(formatMoney(950), 'Δ 950 ₽');
  assert.equal(formatMoney(-48_000), 'Δ -48 тыс. ₽');
  assert.equal(formatMoney(null), '');
  assert.equal(formatMoney(0), '');
});

test('render → parse: нетронутый файл не даёт отметок', () => {
  const { marks, warnings } = parseReview(renderReview(makeState()), { knownKeys: KNOWN });
  assert.equal(marks.size, 0);
  assert.deepEqual(warnings, []);
});

test('parse: отметки + - x X ✓ и пусто, непонятная — предупреждение', () => {
  const text = [
    '- [+] A · x ‹f1›',
    '- [x] A · x ‹f2›',
    '- [X] A · x ‹f3›',
    '- [✓] A · x ‹f4›',
    '- [-] A · x ‹f5›',
    '- [ ] A · x ‹f6›',
    '- [?] A · x ‹f7›',
  ].join('\n');
  const { marks, warnings } = parseReview(text);
  assert.deepEqual([...marks].map(([key, v]) => `${key}${v.mark}`), ['f1+', 'f2+', 'f3+', 'f4+', 'f5-']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /строка 7: непонятная отметка «\?» у f7/);
});

test('parse: комментарий после // при https-ссылке в строке', () => {
  const text = '- [+] P · поз. 1 · [открыть](https://gp.su10.ru/a?b=1) ‹f1› // цена за м², проверить\n' +
    '- [-] P · поз. 2 · [открыть](https://gp.su10.ru/b) ‹f2›\n' +
    '- [+] P · поз. 3 ‹f3› см. https://example.com/x';
  const { marks } = parseReview(text);
  assert.equal(marks.get('f1').comment, 'цена за м², проверить');
  assert.equal(marks.get('f2').comment, '');
  assert.equal(marks.get('f3').comment, '');
});

test('parse: комментарий строкой ниже дописывается к комментарию позиции', () => {
  const text = [
    '- [+] P · поз. 1 ‹f1› // раз',
    '  ИИ: что-то',
    '  // два',
    '  //три',
    '',
    '- [-] P · поз. 2 ‹f2›',
    '  // только ниже',
  ].join('\n');
  const { marks } = parseReview(text);
  assert.equal(marks.get('f1').comment, 'раз два три');
  assert.equal(marks.get('f2').comment, 'только ниже');
});

test('parse: отметка раздела (bulk) и приоритет своей отметки', () => {
  const text = [
    '## [+] По делу (3)',
    '- [ ] A ‹f1›',
    '- [-] A ‹f2›',
    '- [+] A ‹f3›',
    '',
    '## [ ] Шум (1)',
    '- [ ] A ‹f4›',
    '',
    '## [-] Не уверен (1)',
    '- [ ] A ‹f5› // потому что',
    '',
    '## Без разбора (1)',
    '- [ ] A ‹f6›',
  ].join('\n');
  const { marks, warnings } = parseReview(text);
  assert.deepEqual(warnings, []);
  assert.deepEqual(marks.get('f1'), { mark: '+', comment: '', bulk: true });
  assert.deepEqual(marks.get('f2'), { mark: '-', comment: '', bulk: false });
  assert.deepEqual(marks.get('f3'), { mark: '+', comment: '', bulk: false });
  assert.equal(marks.has('f4'), false);
  assert.deepEqual(marks.get('f5'), { mark: '-', comment: 'потому что', bulk: true });
  assert.equal(marks.has('f6'), false);
});

test('parse: чужой ключ — предупреждение и отметка не учитывается', () => {
  const { marks, warnings } = parseReview('- [+] A ‹f1›\n- [+] A ‹f99›', { knownKeys: KNOWN });
  assert.deepEqual([...marks.keys()], ['f1']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /f99 не из этого прогона/);
});

test('parse: BOM и CRLF', () => {
  const { marks } = parseReview('﻿## [+] Раздел\r\n- [ ] A ‹f1› // ок\r\n');
  assert.deepEqual(marks.get('f1'), { mark: '+', comment: 'ок', bulk: true });
});
