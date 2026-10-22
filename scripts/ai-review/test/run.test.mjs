// Сквозной тест: фейковый портал и фейковая модель на node:http → run → разметка → apply.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runApply } from '../lib/apply.mjs';
import { ConfigError } from '../lib/env.mjs';
import { createPortal } from '../lib/portal.mjs';
import { runReview, safeName } from '../lib/run.mjs';
import { makeProfile, sendJson, startServer } from './helpers.mjs';

const SKILLS = { loadSkills: () => ({ entries: [], rev: 'none', path: '' }), renderSkillsForPrompt: () => '', activeCodes: () => new Set() };

const finding = (over) => ({
  rule_code: 'QA', rule_title: 'Нулевая цена', severity: 'high', summary: 'без цены', tender_id: 'tid',
  position_number: 1, item_no: null, entity_type: 'boq_item', entity_id: 'row-1', position_id: 'pos-1', item_id: null,
  fingerprint: 'fp-1', detail: 'нет цены', money_delta: 5000, verdict: null, note: '', finding_id: 'fid-1', is_new: true, ...over,
});

const FINDINGS = [
  finding({}),
  finding({ entity_id: 'row-2', fingerprint: 'fp-2', finding_id: 'fid-2', money_delta: 100, detail: 'мало' }),
  finding({ entity_type: 'client_position', entity_id: 'pos-2', position_id: null, position_number: 2, fingerprint: 'fp-3', finding_id: 'fid-3', money_delta: 70000, detail: 'позиция пустая' }),
  finding({ entity_type: 'tender', entity_id: 'tid', position_id: null, position_number: null, fingerprint: 'fp-4', finding_id: 'fid-4', money_delta: null, detail: 'по тендеру' }),
  finding({ entity_id: 'row-9', fingerprint: 'fp-5', finding_id: 'fid-5', verdict: 'accepted' }), // уже решена — не берётся
];

const POSITIONS = [
  { id: 'pos-1', position_number: 1, work_name: 'Устройство стяжки', unit_code: 'м2', volume: 10, item_no: '1.1', manual_volume: null, manual_note: null, client_note: null },
  { id: 'pos-2', position_number: 2, work_name: 'Окраска', unit_code: 'м2', volume: 5, item_no: null },
];
const row = (id, pos, name, sort) => ({
  id, client_position_id: pos, sort_number: sort, boq_item_type: 'мат', unit_code: 'м3', quantity: 5, conversion_coefficient: null,
  consumption_coefficient: null, unit_rate: 0, total_amount: 0, currency_type: 'RUB', description: null, parent_work_item_id: null,
  created_at: '2026-01-01', work_names: null, material_names: { name, unit: 'м3' }, detail_cost_categories: null,
});
const ROWS = [row('row-2', 'pos-1', 'Песок', 2), row('row-1', 'pos-1', 'Цемент', 1)];

const startPortal = async () => {
  const posted = [];
  const srv = await startServer((req, res, body) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/v1/tenders/brief') return sendJson(res, 200, { data: [{ id: 'tid', tender_number: '256', title: 'Ода', version: 1 }] });
    if (url.pathname === '/api/v1/quality/rules') return sendJson(res, 200, { data: [{ Code: 'QA', Title: 'Нулевая цена', Status: 'active', Summary: 'Правило про нулевую цену' }] });
    if (url.pathname === '/api/v1/tenders/tid/quality' && req.method === 'GET') {
      const open = url.searchParams.get('open_only') === '1';
      return sendJson(res, 200, { data: { tender_id: 'tid', findings: open ? FINDINGS.filter((f) => !f.verdict) : FINDINGS, errors: [] } });
    }
    if (url.pathname === '/api/v1/tenders/tid/positions') return sendJson(res, 200, { data: POSITIONS });
    if (url.pathname === '/api/v1/tenders/tid/boq-items-full') return sendJson(res, 200, { data: ROWS });
    if (url.pathname === '/api/v1/tenders/tid/quality/verdicts' && req.method === 'POST') {
      posted.push(body);
      res.writeHead(204);
      return res.end();
    }
    return sendJson(res, 404, { code: 'NOT_FOUND' });
  });
  return { ...srv, posted };
};

const startModel = () =>
  startServer((_req, res, body) => {
    const text = body.messages.at(-1).content;
    const found = [...text.matchAll(/^(f\d+) \| \S+ \| (?:r\d+)? ?\| (.*)$/gm)].map((m) => ({ ref: m[1], detail: m[2] }));
    const content = JSON.stringify({
      assessments: found.map((f) => ({
        finding: f.ref, label: 'likely_error', reason: `ошибка ${f.ref}`, basis: '',
        evidence: [{ ref: `${f.ref}.detail`, value: f.detail }],
      })),
    });
    sendJson(res, 200, { model: 'm', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 10 } });
  });

test('run → review.md → apply: сквозной сценарий и повторный прогон из кэша', async () => {
  const portalSrv = await startPortal();
  const modelSrv = await startModel();
  const outDir = mkdtempSync(join(tmpdir(), 'ai-review-run-'));
  try {
    const config = {
      modelNames: ['qwen', 'minimax'],
      profiles: { qwen: makeProfile(modelSrv.url), minimax: makeProfile(modelSrv.url, { name: 'minimax', model: 'mm' }) },
      portal: { url: portalSrv.url, key: 'thk_test' },
    };
    const portal = createPortal({ ...config.portal, rpm: 60_000 });
    const logs = [];
    const deps = { portal, outDir, skills: SKILLS, now: () => new Date(2026, 9, 23, 14, 5), log: (l) => logs.push(l) };

    const first = await runReview(config, { tender: '256', models: ['qwen', 'minimax'] }, deps);
    assert.match(first.runDir.replace(/\\/g, '/'), /\/256-v1\/2026-10-23_1405$/);
    assert.deepEqual(readdirSync(first.runDir).sort(), ['positions.json', 'review.md', 'run.json']);
    const { state } = first;
    assert.equal(state.items.length, 4); // решённая находка не берётся
    assert.equal(state.items.filter((i) => i.combined).length, 3);
    assert.deepEqual(state.items.map((i) => i.key), ['f1', 'f2', 'f3', 'f4']);
    assert.equal(state.items[0].findingId, 'fid-3'); // крупнейшая сумма первой
    assert.deepEqual(state.models, [{ name: 'qwen', model: 'qwen-test' }, { name: 'minimax', model: 'mm' }]);
    assert.ok(!JSON.stringify(state).includes('thk_test')); // ключ портала в состояние не попадает
    assert.ok(!JSON.stringify(state.models).includes('127.0.0.1')); // адрес модели тоже
    const pos1 = JSON.parse(readFileSync(join(first.runDir, 'positions.json'), 'utf8'))['pos-1'];
    assert.deepEqual(pos1.rows.map((r) => r.name), ['Цемент', 'Песок']); // порядок по sort_number
    const unreviewed = state.items.find((i) => i.findingId === 'fid-4');
    assert.equal(unreviewed.combined, null);
    assert.equal(unreviewed.link, null);

    const review = readFileSync(first.reviewPath, 'utf8');
    assert.match(review, /Модели: qwen \(qwen-test\), minimax \(mm\)/);
    assert.match(review, /Δ 70 тыс\. ₽/);

    // повторный прогон — все ответы из кэша
    const callsBefore = modelSrv.calls.length;
    const second = await runReview(config, { tender: '256', models: ['qwen', 'minimax'] }, { ...deps, now: () => new Date(2026, 9, 23, 14, 6) });
    assert.equal(modelSrv.calls.length, callsBefore);
    assert.ok(second.runDir !== first.runDir);
    assert.equal(second.state.usage.qwen.cachedPositions, 2);

    // отметка раздела «По делу» и применение
    writeFileSync(first.reviewPath, review.replace(/^## \[ \] По делу/m, '## [+] По делу'), 'utf8');
    const code = await runApply(config, { file: first.reviewPath }, { ...deps });
    assert.equal(code, 0);
    assert.equal(portalSrv.posted.length, 1);
    assert.deepEqual(portalSrv.posted[0].items.map((i) => `${i.entity_id}:${i.verdict}`).sort(), ['pos-2:error', 'row-1:error', 'row-2:error']);
    assert.equal(readFileSync(join(outDir, 'decisions.jsonl'), 'utf8').trim().split('\n').length, 3);
  } finally {
    portalSrv.close();
    modelSrv.close();
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('run: --max, --rule и ошибки аргументов', async () => {
  const portalSrv = await startPortal();
  const modelSrv = await startModel();
  const outDir = mkdtempSync(join(tmpdir(), 'ai-review-run-'));
  try {
    const config = { modelNames: ['qwen'], profiles: { qwen: makeProfile(modelSrv.url) }, portal: { url: portalSrv.url, key: 'k' } };
    const portal = createPortal({ ...config.portal, rpm: 60_000 });
    const deps = { portal, outDir, skills: SKILLS, log: () => {} };
    const result = await runReview(config, { tender: '256', max: 1 }, deps);
    const reviewed = result.state.items.filter((i) => i.combined);
    assert.deepEqual(reviewed.map((i) => i.findingId), ['fid-3']); // одна позиция — с наибольшей суммой

    await runReview(config, { tender: '256', rules: ['QA', 'U'], refresh: true, onlyNew: true }, deps);
    const quality = portalSrv.calls.filter((c) => c.url.startsWith('/api/v1/tenders/tid/quality')).at(-1).url;
    assert.match(quality, /open_only=1/);
    assert.match(quality, /only_new=1/);
    assert.match(quality, /rule=QA%2CU/);
    assert.match(quality, /refresh=1/);

    await assert.rejects(runReview({ ...config, modelNames: [] }, { tender: '256' }, deps), ConfigError);
    await assert.rejects(runReview(config, { tender: '256', models: ['nope'] }, deps), /профиль nope не описан/);
    assert.equal(existsSync(join(outDir, 'cache', 'qwen')), true);
  } finally {
    portalSrv.close();
    modelSrv.close();
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('safeName: безопасные для Windows символы', () => {
  assert.equal(safeName('256'), '256');
  assert.equal(safeName('А-12/3: «x»'), 'А-12_3_x');
  assert.equal(safeName('...'), 'x');
});
