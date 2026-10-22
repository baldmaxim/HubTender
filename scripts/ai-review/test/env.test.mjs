import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, getProfile, loadConfig } from '../lib/env.mjs';

const withEnvFile = (text, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-review-env-'));
  const file = join(dir, 'ai-review.env');
  writeFileSync(file, text, 'utf8');
  try {
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('BOM, CRLF, кавычки, export и комментарии', () => {
  const text = [
    '﻿# комментарий',
    '',
    'export TENDERHUB_API_URL="https://gp.su10.ru"',
    "TENDERHUB_API_KEY='thk_secret'",
    'AI_REVIEW_MODELS=Qwen, minimax',
    'AI_REVIEW_QWEN_BASE_URL=http://pc:11434/v1#frag',
    'AI_REVIEW_QWEN_MODEL=m1',
    'AI_REVIEW_QWEN_TIMEOUT_SEC=60',
    'AI_REVIEW_QWEN_EXTRA={"chat_template_kwargs":{"enable_thinking":false}}',
    'AI_REVIEW_MINIMAX_BASE_URL=https://openrouter.ai/api/v1',
    'AI_REVIEW_MINIMAX_MODEL=x/y:free',
    'AI_REVIEW_MINIMAX_API_KEY=sk-or-1',
    '',
  ].join('\r\n');
  withEnvFile(text, (file) => {
    const config = loadConfig(file);
    assert.equal(config.portal.url, 'https://gp.su10.ru');
    assert.equal(config.portal.key, 'thk_secret');
    assert.deepEqual(config.modelNames, ['qwen', 'minimax']);
    const qwen = getProfile(config, 'qwen');
    assert.equal(qwen.baseUrl, 'http://pc:11434/v1#frag'); // инлайн-«#» остаётся в значении
    assert.equal(qwen.apiKey, '');
    assert.equal(qwen.contextTokens, 16384);
    assert.equal(qwen.timeoutMs, 60_000);
    assert.equal(qwen.maxTokens, 8192);
    assert.deepEqual(qwen.extra, { chat_template_kwargs: { enable_thinking: false } });
    assert.equal(getProfile(config, 'MiniMax').apiKey, 'sk-or-1');
  });
});

test('нет файла — понятная ошибка', () => {
  assert.throws(
    () => loadConfig(join(tmpdir(), 'ai-review-no-such-dir', 'ai-review.env')),
    (err) => err instanceof ConfigError && /Нет scripts\/ai-review\/ai-review\.env/.test(err.message),
  );
});

test('неверный _EXTRA — ошибка с именем ключа', () => {
  const text = 'AI_REVIEW_MODELS=qwen\nAI_REVIEW_QWEN_BASE_URL=http://h/v1\nAI_REVIEW_QWEN_MODEL=m\nAI_REVIEW_QWEN_EXTRA={oops\n';
  withEnvFile(text, (file) => {
    assert.throws(() => loadConfig(file), /AI_REVIEW_QWEN_EXTRA/);
  });
});

test('профиль без BASE_URL: загрузка проходит, запрос профиля — ошибка', () => {
  withEnvFile('AI_REVIEW_MODELS=qwen,other\nAI_REVIEW_QWEN_MODEL=m\nAI_REVIEW_OTHER_BASE_URL=http://h/v1\nAI_REVIEW_OTHER_MODEL=o\n', (file) => {
    const config = loadConfig(file);
    assert.equal(getProfile(config, 'other').model, 'o');
    assert.throws(
      () => getProfile(config, 'qwen'),
      /профиль qwen не описан в ai-review\.env: нужны AI_REVIEW_QWEN_BASE_URL и AI_REVIEW_QWEN_MODEL/,
    );
  });
});

test('process.env не влияет на результат', () => {
  const prev = process.env.TENDERHUB_API_URL;
  process.env.TENDERHUB_API_URL = 'https://evil.example';
  try {
    withEnvFile('TENDERHUB_API_URL=https://gp.su10.ru\n', (file) => {
      assert.equal(loadConfig(file).portal.url, 'https://gp.su10.ru');
    });
    withEnvFile('# пусто\n', (file) => {
      assert.equal(loadConfig(file).portal.url, '');
    });
  } finally {
    if (prev === undefined) delete process.env.TENDERHUB_API_URL;
    else process.env.TENDERHUB_API_URL = prev;
  }
});

test('THINK_EXTRA и BATCH_FINDINGS: значения и умолчания', () => {
  const base = 'AI_REVIEW_MODELS=qwen\nAI_REVIEW_QWEN_BASE_URL=http://h/v1\nAI_REVIEW_QWEN_MODEL=m\n';
  withEnvFile(base, (file) => {
    const qwen = getProfile(loadConfig(file), 'qwen');
    assert.equal(qwen.thinkExtra, undefined);
    assert.equal(qwen.batchFindings, 60);
  });
  const text = `${base}AI_REVIEW_QWEN_THINK_EXTRA={"chat_template_kwargs":{"enable_thinking":true}}\nAI_REVIEW_QWEN_BATCH_FINDINGS=25\n`;
  withEnvFile(text, (file) => {
    const qwen = getProfile(loadConfig(file), 'qwen');
    assert.deepEqual(qwen.thinkExtra, { chat_template_kwargs: { enable_thinking: true } });
    assert.equal(qwen.batchFindings, 25);
  });
  withEnvFile(`${base}AI_REVIEW_QWEN_BATCH_FINDINGS=0\n`, (file) => {
    assert.throws(() => loadConfig(file), /AI_REVIEW_QWEN_BATCH_FINDINGS/);
  });
  withEnvFile(`${base}AI_REVIEW_QWEN_THINK_EXTRA=[1]\n`, (file) => {
    assert.throws(() => loadConfig(file), /AI_REVIEW_QWEN_THINK_EXTRA/);
  });
});
