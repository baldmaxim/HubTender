// Этап 1.6 focused frontend checks — run via tsx:
//   npx tsx scripts/checks/reviewPackFrontendPolicy.check.mjs

import { readFileSync } from 'node:fs';
import {
  sectionDisplay, isDownloadReady, buildDownloadUrl, shortFingerprint,
  approvalDisplay, formatReviewAmount, NOT_READY_TEXT, reviewQueryString,
  crossLinkActionPlan, crossLinkChangeImpact,
} from '../../src/lib/quality/reviewPackPolicy.ts';

const failures = [];
const check = (name, cond) => { cond ? console.log('  ok — ' + name) : failures.push(name); };

// 1-2. ready / not ready
check('ready report → download разрешён', isDownloadReady({ status: 'ready' }) === true);
check('calculation not ready → download запрещён', isDownloadReady({ status: 'calculation_not_ready' }) === false);

// 3. baseline unavailable — компонент no-data, download остаётся разрешён
check('baseline unavailable не блокирует download',
  isDownloadReady({ status: 'ready' }) === true &&
  sectionDisplay({ status: 'baseline_not_available' }).label === 'Нет предыдущей версии');

// 4. quality blocker не блокирует download (готовность зависит только от status)
check('quality blocker не блокирует download',
  isDownloadReady({ status: 'ready', executive_summary: { quality: { blockers: 5 } } }) === true);

// 5-8. parameter serialization
check('parameter serialization: все параметры',
  reviewQueryString({ benchmark_period_months: 12, source_max_age_days: 60, baseline_tender_id: 'B1' }) ===
  'benchmark_period_months=12&source_max_age_days=60&baseline_tender_id=B1');
check('benchmark period отдельно', reviewQueryString({ benchmark_period_months: 36 }) === 'benchmark_period_months=36');
check('source max age отдельно', reviewQueryString({ source_max_age_days: 180 }) === 'source_max_age_days=180');
check('baseline tender ID отдельно', reviewQueryString({ baseline_tender_id: 'abc' }) === 'baseline_tender_id=abc');

// 9. download URL
check('download URL',
  buildDownloadUrl('T1', { benchmark_period_months: 24 }) ===
  '/api/v1/tenders/T1/review-report.xlsx?benchmark_period_months=24' &&
  buildDownloadUrl('T1', {}) === '/api/v1/tenders/T1/review-report.xlsx');

// 10. кнопка disabled при not-ready (страница использует isDownloadReady)
const page = readFileSync(new URL('../../src/pages/ReviewPack/ReviewPack.tsx', import.meta.url), 'utf-8');
check('button disabled при not-ready', page.includes('disabled={!isDownloadReady(report)}'));

// 11. fingerprint
check('fingerprint формат',
  shortFingerprint('a'.repeat(64)).includes('…') && shortFingerprint('') === '—' &&
  shortFingerprint('short') === 'short');

// 12. approval status
check('approval status',
  approvalDisplay({ financial_approved: false }) === 'Не согласован' &&
  approvalDisplay({ financial_approved: true, approved_by_label: 'Иванов', approved_at: '2026-07-01T10:00:00Z' })
    .includes('Иванов') &&
  approvalDisplay({ financial_approved: true, approved_by_label: 'Иванов', approved_at: '2026-07-01T10:00:00Z' })
    .includes('2026-07-01'));

// 13-15. component statuses
check('component available', sectionDisplay({ status: 'available' }).label === 'Готово');
check('component no-data', sectionDisplay({ status: 'no_data' }).label === 'Нет данных');
check('component unavailable', sectionDisplay({ status: 'unavailable' }).label === 'Недоступно');

// 16. amount без NaN
check('amount без NaN',
  formatReviewAmount(NaN) === '—' && formatReviewAmount(null) === '—' &&
  formatReviewAmount(120000).includes('120'));

// 17-18. cross-links
check('cross-link Action Plan', crossLinkActionPlan('T1') === '/analytics/action-plan?tenderId=T1');
check('cross-link Change Impact', crossLinkChangeImpact('T1') === '/analytics/change-impact?tenderId=T1');

// 19. executive summary не пересчитывается на frontend
check('summary не пересчитывается frontend',
  !/reduce\([^)]*blockers/s.test(page) && !/\+=\s*.*amount_requiring_review/.test(page) &&
  page.includes('report?.executive_summary'));

// 20. никакого client-side Excel builder
const api = readFileSync(new URL('../../src/lib/api/reviewPack.ts', import.meta.url), 'utf-8');
check('нет client-side Excel builder',
  !page.includes("from 'xlsx'") && !page.includes('xlsx-js-style') &&
  !api.includes("from 'xlsx'") && !api.includes('XLSX.utils') &&
  api.includes('review-report.xlsx'));

// бонус: not-ready текст
check('not-ready текст', NOT_READY_TEXT.includes('не актуален'));

console.log('reviewPackFrontendPolicy.check:');
if (failures.length > 0) {
  console.error('\n  ✗ FAILED:\n');
  for (const f of failures) console.error('    - ' + f);
  process.exit(1);
}
console.log('\nreviewPackFrontendPolicy.check: passed (21 checks)');
