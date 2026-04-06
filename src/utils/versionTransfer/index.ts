/**
 * Модуль переноса данных между версиями тендера
 *
 * Включает:
 * - Создание новой версии тендера с автоинкрементом version
 * - Перенос данных позиций (manual_volume, manual_note)
 * - Копирование boq_items с сохранением связей parent_work_item_id
 * - Обработка дополнительных работ с поиском альтернативных родителей
 *
 * @module utils/versionTransfer
 */

export * from './createNewVersion';
export * from './transferPositionData';
export * from './copyBoqItems';
export * from './handleAdditionalPositions';
export * from './copyCostVolumes';
export * from './copyInsuranceData';
