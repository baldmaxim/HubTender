// =============================================
// ENUM типы
// =============================================

export type UnitType = 'шт' | 'м' | 'м2' | 'м3' | 'кг' | 'т' | 'л' | 'компл' | 'м.п.';
export type MaterialType = 'основн.' | 'вспомогат.';
export type BoqItemType = 'мат' | 'суб-мат' | 'мат-комп.' | 'раб' | 'суб-раб' | 'раб-комп.';
export type CurrencyType = 'RUB' | 'USD' | 'EUR' | 'CNY';
export type DeliveryPriceType = 'в цене' | 'не в цене' | 'суммой';
export type HousingClassType = 'комфорт' | 'бизнес' | 'премиум' | 'делюкс';
export type ConstructionScopeType = 'генподряд' | 'коробка' | 'монолит';

// Подтипы для материалов и работ (для удобства использования в UI)
export type ItemType = Extract<BoqItemType, 'мат' | 'суб-мат' | 'мат-комп.'>;
export type WorkItemType = Extract<BoqItemType, 'раб' | 'суб-раб' | 'раб-комп.'>;
