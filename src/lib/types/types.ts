// =============================================
// Центральный барель типов приложения.
// Реализация разнесена по подмодулям ./types/* (лимит ≤600 строк на файл):
//   enums.ts    — ENUM-типы БД (UnitType, BoqItemType, CurrencyType, …)
//   tenders.ts  — тендеры, реестр, группы/итерации, страхование, заметки
//   library.ts  — библиотеки материалов/работ, категории затрат, шаблоны
//   markup.ts   — параметры/проценты наценок, тактики (MarkupStep), pricing distribution, redistribution
//   boq.ts      — boq_items, client_positions, notifications, import sessions
//   users.ts    — пользователи, роли, ALL_PAGES/PAGE_LABELS, hasPageAccess и хелперы доступа
//   projects.ts — текущие объекты
// Обычный `export *` (не `export type *`): реэкспортируются и runtime-значения
// (calcInsuranceTotal, TAB_TO_BOQ_TYPE, mapBoqItemTypeToPricingType, hasPageAccess и др.).
// НЕ создавать ./types/index.ts — путь './types' станет неоднозначным (файл vs папка).
// ./types/tasks.ts — отдельный модуль, реэкспортируется барелем ./index.ts.
// =============================================

export * from './types/enums';
export * from './types/tenders';
export * from './types/library';
export * from './types/markup';
export * from './types/boq';
export * from './types/users';
export * from './types/projects';
