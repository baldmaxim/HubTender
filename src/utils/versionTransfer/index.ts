/**
 * Перенос версий тендера — только Go BFF.
 *
 * Тяжёлое копирование (positions/boq/costs/insurance/exclusions/доп.работы)
 * выполняет серверный эндпоинт `POST /api/v1/tenders/{id}/versions/transfer`
 * (см. executeVersionTransfer). Дублирование тендера —
 * `cloneTenderAsNewVersion` (импортируется напрямую, не через этот баррель).
 *
 * Легаси клиент-оркестрованные модули (createNewVersion / transferPositionData
 * / handleAdditionalPositions / copyBoqItems / copyCostVolumes /
 * copyInsuranceData) удалены: вытеснены серверным executeVersionTransfer,
 * нигде не использовались.
 *
 * @module utils/versionTransfer
 */

export * from './executeVersionTransfer';
export * from './types';
