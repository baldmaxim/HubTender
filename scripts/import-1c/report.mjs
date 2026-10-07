// Отчёт пробного прогона и автокарты для ручных решений (out/*.auto.json).

import fs from 'node:fs';
import path from 'node:path';

const fmt = (n, d = 0) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: d }));
const mln = (n) => fmt(n / 1e6, 2);

export const writeJson = (outDir, file, data) => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, file), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

/** Автокарты: что подобрано автоматически и что ждёт ручного решения. */
export const writeAutoMaps = (outDir, { maps, prepared }) => {
  writeJson(outDir, 'units-map.auto.json', maps.unitReport);
  writeJson(outDir, 'cost-map.auto.json', maps.costReport);
  writeJson(outDir, 'dop-map.auto.json', {
    unresolved: prepared.unresolved,
    review: prepared.reviewDops,
  });
};

const sumBy = (rows, f) => rows.reduce((s, r) => s + (f(r) ?? 0), 0);

/**
 * Markdown-отчёт. blockers — список строк, из-за которых --commit не пойдёт.
 * @param {{inv, maps, prepared, refs, blockers: string[], mode: string}} ctx
 */
export const renderReport = ({ inv, maps, prepared, refs, blockers, mode }) => {
  const v = prepared.versions;
  const st = (f) => sumBy(v, (x) => f(x.stats));
  const lines = [];
  lines.push(`# Загрузка 1С → HUBTender: ${mode}`, '', `Сформирован: ${new Date().toISOString()}`, '');
  lines.push('## Итог', '');
  lines.push(`- Тендеров: ${new Set(v.map((x) => x.tender)).size}, версий: ${v.length}; пропущено: ${[...inv.skipped].map(([n, r]) => `«${n}» (${r})`).join(', ') || 'нет'}`);
  lines.push(`- Позиций: ${fmt(st((s) => s.positions))}, ДОП: ${fmt(st((s) => s.dops))}, работ: ${fmt(st((s) => s.works))}, материалов: ${fmt(st((s) => s.materials))}`);
  lines.push(`- Материалы: привязано ${fmt(st((s) => s.linked))}, без привязки ${fmt(st((s) => s.unlinked))}; расход<1 перенесён: в перевод ${fmt(st((s) => s.foldedLinked))}, в количество ${fmt(st((s) => s.foldedUnlinked))}`);
  lines.push(`- Нулевой объём (quantity = NULL): ${fmt(st((s) => s.zeroQty))}; единица взята по наименованию/позиции: ${fmt(st((s) => s.unitFallback - s.unitDefault))}; не нашлась — поставлено «шт»: ${fmt(st((s) => s.unitDefault))}`);
  lines.push(`- Без статьи затрат: ${fmt(st((s) => s.noCost))} строк; Σ прямых затрат 1С: ${mln(st((s) => s.amount1c))} млн ₽; отрицательных строк (знак перенесён в цену): ${fmt(st((s) => s.negative))}`);
  const how = {};
  for (const x of v) for (const [k, n] of Object.entries(x.stats.dopHow)) how[k] = (how[k] ?? 0) + n;
  lines.push(`- ДОП по способу привязки: ${Object.entries(how).map(([k, n]) => `${k} — ${n}`).join('; ') || 'нет'}`);
  lines.push(`- Наибольшее число ДОП у одной позиции: ${Math.max(0, ...v.map((x) => x.stats.maxDopPerParent))} (сервер нумерует до 54)`);
  if (refs) {
    lines.push(`- Наименования: всего ${fmt(prepared.names.size)}, уже в справочнике ${fmt(refs.namesExisting)}, новых ${fmt(prepared.names.size - refs.namesExisting)} (сейчас в справочниках ${fmt(refs.namesTotal)})`);
  }
  lines.push('');

  lines.push('## Блокеры загрузки', '');
  lines.push(...(blockers.length ? blockers.map((b) => `- ${b}`) : ['- нет']), '');

  lines.push('## Версии', '');
  lines.push('| № | Версия | Объект | Поз. | ДОП | Раб. | Мат. | Привяз. | Без привяз. | Без статьи | Σ 1С, млн ₽ | Курсы |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const x of v) {
    const s = x.stats;
    const rates = Object.entries(x.rates).map(([c, r]) => `${c} ${r.rate}${r.borrowed ? ` (${r.borrowed})` : ''}`).join(', ') || '—';
    lines.push(`| ${x.tender} | ${x.version} (${x.label}) | ${x.title} | ${s.positions} | ${s.dops} | ${s.works} | ${s.materials} | ${s.linked} | ${s.unlinked} | ${s.noCost} | ${mln(s.amount1c)} | ${rates} |`);
  }
  lines.push('');

  lines.push('## Единицы измерения', '');
  const unitLine = (u) => `| ${u.text} | ${u.rows} | ${u.code ?? '—'} | ${u.source} | ${u.code && !u.exists ? 'создать' : ''} |`;
  lines.push('Строки (работы/материалы):', '', '| Текст 1С | Строк | Код | Источник | |', '|---|---|---|---|---|');
  lines.push(...maps.unitReport.items.map(unitLine), '');
  lines.push('Позиции заказчика (нераспознанные и первые 40):', '', '| Текст 1С | Строк | Код | Источник | |', '|---|---|---|---|---|');
  const cu = maps.unitReport.customer;
  lines.push(...[...cu.filter((u) => !u.code), ...cu.filter((u) => u.code).slice(0, 40)].map(unitLine), '');

  lines.push('## Статьи затрат', '');
  const costHow = {};
  for (const c of maps.costReport) costHow[c.how] = (costHow[c.how] ?? 0) + c.rows;
  lines.push(`Строк по способу сопоставления: ${Object.entries(costHow).map(([k, n]) => `${k} — ${fmt(n)}`).join('; ')}`, '');
  lines.push('| Код | Статья 1С | Строк | Сопоставлено | Как |', '|---|---|---|---|---|');
  const detailLabel = new Map((refs?.detailLabels ?? []).map((d) => [d.id, d.label]));
  for (const c of maps.costReport) {
    lines.push(`| ${c.code} | ${c.article} | ${c.rows} | ${c.detail_cost_category_id ? detailLabel.get(c.detail_cost_category_id) ?? c.detail_cost_category_id : '—'} | ${c.how} |`);
  }
  lines.push('');

  const anomalies = v.flatMap((x) => x.stats.anomalies.map((a) => ({ tender: x.tender, version: x.version, ...a })));
  if (anomalies.length) {
    lines.push('## Строки, где сумма 1С не воспроизводится (ошибки в 1С)', '');
    lines.push('Сервер HUBTender считает объём × цена (× курс версии) — итог версии будет отличаться от 1С на эти строки.', '');
    lines.push('| № | Версия | Строка файла | Наименование | Объём | Цена, ₽ | Сумма 1С | Причина |', '|---|---|---|---|---|---|---|---|');
    for (const a of anomalies) {
      lines.push(`| ${a.tender} | ${a.version} | ${a.row} | ${a.name} | ${fmt(a.volume, 5)} | ${fmt(a.price, 2)} | ${fmt(a.amount, 2)} | ${a.reason} |`);
    }
    lines.push('');
  }
  if (prepared.unresolved.length) {
    lines.push('## ДОП без родителя (заполнить «Решение» в out/dop-review.xlsx)', '');
    lines.push('| Ключ | ДОП | section_no | parent_line | Кандидаты (section_no — имя — балл) |', '|---|---|---|---|---|');
    for (const u of prepared.unresolved) {
      const c = u.candidates.map((x) => `${x.section_no} — ${x.name?.slice(0, 40)} — ${x.score}`).join('<br>');
      lines.push(`| ${u.key} | ${u.name} | ${u.section_no} | ${u.parent_line ?? ''} | ${c} |`);
    }
    lines.push('');
  }
  if (refs?.conflicts?.length) {
    lines.push('## Номера, уже занятые на портале', '');
    lines.push(...refs.conflicts.map((c) => `- ${c.number} v${c.version}: «${c.title}» (${c.id})`), '');
  }
  return `${lines.join('\n')}\n`;
};
