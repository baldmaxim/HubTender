/**
 * Сервис применения тактик наценок к элементам BOQ
 * Обеспечивает интеграцию между калькулятором наценок и базой данных
 */

// Экспортируем все из модулей.
// markupTactic/tactics (applyTacticToTender) удалён: материализация коммерческих
// стоимостей перенесена на сервер (Go BFF авто-пересчёт). Live-расчёт для
// отображения по-прежнему использует calculation/parameters.
export * from './markupTactic/calculation';
export * from './markupTactic/parameters';
