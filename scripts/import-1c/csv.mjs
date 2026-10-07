// Потоковый разбор выгрузки 1С (Результаты.csv): UTF-8 BOM, разделитель «;»,
// CRLF, литерал NULL, поля с «;» — в двойных кавычках. Переводов строк внутри
// полей нет (число строк файла = число записей), поэтому читаем построчно.

import fs from 'node:fs';
import readline from 'node:readline';

/** Делит строку CSV по «;» с учётом кавычек и экранирования "". */
export const splitCsvLine = (line) => {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"' && cur === '') {
      quoted = true;
    } else if (ch === ';') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
};

const isNull = (v) => v === undefined || v === null || v === 'NULL' || v === '';

/** Строка или null; NULL/пусто → null, пробелы по краям убираются. */
export const str = (v) => (isNull(v) ? null : String(v).trim() || null);

/** Число 1С: пробелы/NBSP — разделители тысяч, точка — десятичная. */
export const num = (v) => {
  if (isNull(v)) return null;
  const s = String(v).replace(/[\s ]/g, '');
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`не число: «${v}»`);
  return n;
};

/** Дата 1С «2025-06-26 00:00:00.0000000» → «2025-06-26»; 0001-01-01 → null. */
export const date = (v) => {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m || m[1] === '0001') return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
};

/** Да/Нет → boolean (NULL → false). */
export const yes = (v) => str(v)?.toLowerCase() === 'да';

/**
 * Читает файл и отдаёт версии целиком: { tenderName, versionName, rows }.
 * Строки версии в выгрузке идут подряд; повтор версии после другой — ошибка.
 */
export async function* readVersions(filePath) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let header = null;
  let key = null;
  let batch = null;
  const seen = new Set();
  let lineNo = 0;
  for await (const raw of rl) {
    lineNo += 1;
    const line = lineNo === 1 ? raw.replace(/^﻿/, '') : raw;
    if (!header) {
      header = splitCsvLine(line);
      continue;
    }
    if (line === '') continue;
    const cells = splitCsvLine(line);
    if (cells.length !== header.length) {
      throw new Error(`строка ${lineNo}: ${cells.length} полей вместо ${header.length}`);
    }
    const row = { _line: lineNo };
    header.forEach((h, i) => {
      row[h] = cells[i];
    });
    const k = `${row.tender_name}\u0000${row.version_name}`;
    if (k !== key) {
      if (batch) yield batch;
      if (seen.has(k)) {
        throw new Error(`строка ${lineNo}: версия «${row.tender_name} / ${row.version_name}» разорвана в файле`);
      }
      seen.add(k);
      key = k;
      batch = { tenderName: row.tender_name, versionName: row.version_name, rows: [] };
    }
    batch.rows.push(row);
  }
  if (batch) yield batch;
}
