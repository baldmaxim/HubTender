// =============================================
// Типы для таблицы tenders
// =============================================

// =============================================
// Справочные таблицы для тендеров
// =============================================

export interface TenderStatus {
  id: string;
  name: string;
  created_at: string;
}

export interface ConstructionScope {
  id: string;
  name: string;
  created_at: string;
}

export interface TenderInsert {
  title: string;
  description?: string;
  client_name: string;
  tender_number: string;
  submission_deadline: string;
  version?: number;
  area_client?: number;
  area_sp?: number;
  usd_rate?: number;
  eur_rate?: number;
  cny_rate?: number;
  upload_folder?: string;
  bsm_link?: string;
  tz_link?: string;
  qa_form_link?: string;
  project_folder_link?: string;
  markup_tactic_id?: string;
  housing_class?: HousingClassType;
  construction_scope?: ConstructionScopeType;
  is_archived?: boolean;
}

export interface Tender extends TenderInsert {
  id: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

// =============================================
// Типы для таблицы tender_registry (реестр тендеров)
// =============================================

// Новые типы для элементов списков
export interface ChronologyItem {
  date: string | null; // ISO date string или null
  text: string;
}

export interface TenderPackageItem {
  date: string | null;
  text: string;
}

export interface TenderRegistryInsert {
  title: string;
  client_name: string;
  tender_number?: string | null; // НОВОЕ: связь с tenders через текст
  object_address?: string | null; // НОВОЕ: адрес объекта
  construction_scope_id?: string | null;
  area?: number | null;
  submission_date?: string | null;
  construction_start_date?: string | null;
  site_visit_photo_url?: string | null;
  site_visit_date?: string | null;
  has_tender_package?: string | null; // DEPRECATED
  tender_package_items?: TenderPackageItem[] | null; // НОВОЕ
  invitation_date?: string | null;
  status_id?: string | null;
  chronology?: string | null; // DEPRECATED
  chronology_items?: ChronologyItem[] | null; // НОВОЕ
  sort_order?: number | null;
  is_archived?: boolean; // НОВОЕ: флаг архивации
  manual_total_cost?: number | null; // НОВОЕ: ручной ввод общей стоимости
}

export interface TenderRegistry extends TenderRegistryInsert {
  id: string;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  sort_order: number;
  tender_number?: string | null;
  object_address?: string | null;
  chronology_items?: ChronologyItem[] | null;
  tender_package_items?: TenderPackageItem[] | null;
  is_archived: boolean; // НОВОЕ: флаг архивации (NOT NULL)
  manual_total_cost?: number | null; // НОВОЕ: ручной ввод общей стоимости
}

export interface TenderRegistryWithRelations extends TenderRegistry {
  status?: TenderStatus | null;
  construction_scope?: ConstructionScope | null;
  total_cost?: number | null; // Общая стоимость из связанного тендера (рассчитывается динамически)
}

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

// =============================================
// Типы для таблицы materials_library
// =============================================

export interface LibraryFolder {
  id: string;
  name: string;
  type: 'works' | 'materials';
  sort_order: number;
  parent_id: string | null;
  created_at: string;
}

export interface MaterialLibraryInsert {
  material_type: MaterialType;
  item_type: ItemType;
  consumption_coefficient?: number;
  unit_rate: number;
  currency_type?: CurrencyType;
  delivery_price_type?: DeliveryPriceType;
  delivery_amount?: number;
  material_name_id: string;
  folder_id?: string | null;
}

export interface MaterialLibrary extends MaterialLibraryInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Типы для таблицы material_names
// =============================================

export interface MaterialNameInsert {
  name: string;
  unit: UnitType;
}

export interface MaterialName extends MaterialNameInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Типы для таблицы work_names
// =============================================

export interface WorkNameInsert {
  name: string;
  unit: UnitType;
}

export interface WorkName extends WorkNameInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Типы для таблицы locations
// =============================================

export interface LocationInsert {
  location: string;
}

export interface Location extends LocationInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Типы для таблицы cost_categories
// =============================================

export interface CostCategoryInsert {
  name: string;
  unit: UnitType;
}

export interface CostCategory extends CostCategoryInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Типы для таблицы detail_cost_categories
// =============================================

export interface DetailCostCategoryInsert {
  cost_category_id: string;
  location_id: string;
  name: string;
  unit: UnitType;
  order_num?: number;
}

export interface DetailCostCategory extends DetailCostCategoryInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Типы для таблицы construction_cost_volumes
// =============================================

export interface ConstructionCostVolumeInsert {
  tender_id: string;
  detail_cost_category_id: string;
  volume?: number;
}

export interface ConstructionCostVolume extends ConstructionCostVolumeInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Типы для таблицы tender_insurance
// =============================================

export interface TenderInsuranceInsert {
  tender_id: string;
  judicial_pct: number;   // % судебных квартир
  total_pct: number;      // % от общей суммы
  apt_price_m2: number;
  apt_area: number;
  parking_price_m2: number;
  parking_area: number;
  storage_price_m2: number;
  storage_area: number;
}

export interface TenderInsurance extends TenderInsuranceInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

/** Вычисляет итоговую сумму страхования */
export function calcInsuranceTotal(ins: Pick<TenderInsuranceInsert,
  'apt_price_m2' | 'apt_area' | 'parking_price_m2' | 'parking_area' |
  'storage_price_m2' | 'storage_area' | 'judicial_pct' | 'total_pct'>
): number {
  const apt = (ins.apt_price_m2 || 0) * (ins.apt_area || 0);
  const parking = (ins.parking_price_m2 || 0) * (ins.parking_area || 0);
  const storage = (ins.storage_price_m2 || 0) * (ins.storage_area || 0);
  return (apt + parking + storage) * ((ins.judicial_pct || 0) / 100) * ((ins.total_pct || 0) / 100);
}

// =============================================
// Расширенный тип для materials_library с JOIN данными
// =============================================

export interface MaterialLibraryFull extends MaterialLibrary {
  material_name: string;
  unit: UnitType;
  folder_id?: string | null;
}

// =============================================
// Типы для таблицы works_library
// =============================================

export interface WorkLibraryInsert {
  work_name_id: string;
  item_type: WorkItemType;
  unit_rate: number;
  currency_type?: CurrencyType;
  folder_id?: string | null;
}

export interface WorkLibrary extends WorkLibraryInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Расширенный тип для works_library с JOIN данными
// =============================================

export interface WorkLibraryFull extends WorkLibrary {
  work_name: string;
  unit: UnitType;
  folder_id?: string | null;
}

// =============================================
// Типы для таблицы work_material_templates
// =============================================

export interface WorkMaterialTemplateInsert {
  template_name: string;
  detail_cost_category_id: string;
  consumption_coefficient: number;
  work_library_id: string;
  material_library_id: string;
  order_num?: number;
  is_active?: boolean;
}

export interface WorkMaterialTemplate extends WorkMaterialTemplateInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Расширенный тип для work_material_templates с JOIN данными
// =============================================

export interface WorkMaterialTemplateFull extends WorkMaterialTemplate {
  work_name: string;
  work_unit: UnitType;
  work_item_type: WorkItemType;
  work_unit_rate: number;
  work_currency_type: CurrencyType;
  material_name: string;
  material_unit: UnitType;
  material_type: MaterialType;
  material_item_type: ItemType;
  material_unit_rate: number;
  material_currency_type: CurrencyType;
  detail_cost_category_name: string;
  cost_category_name: string;
  location: string;
}

// =============================================
// Типы для таблицы markup_parameters (справочник параметров наценок)
// =============================================

export interface MarkupParameterInsert {
  key: string;
  label: string;
  is_active?: boolean;
  order_num?: number;
  default_value?: number;
}

export interface MarkupParameter extends MarkupParameterInsert {
  id: string;
  created_at: string;
  updated_at: string;
  default_value: number;
}

// =============================================
// Типы для таблицы tender_markup_percentage
// =============================================

export interface TenderMarkupPercentageInsert {
  tender_id: string;
  markup_parameter_id: string;
  value: number;
}

export interface TenderMarkupPercentage extends TenderMarkupPercentageInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// Расширенный тип с данными параметра наценки
export interface TenderMarkupPercentageFull extends TenderMarkupPercentage {
  markup_parameter: MarkupParameter;
}

// Вспомогательный тип для UI - данные наценок с ключами параметров
export interface TenderMarkupPercentageUI {
  tender_id: string;
  [key: string]: number | string; // динамические ключи параметров
}

// =============================================
// Типы для таблицы templates
// =============================================

export interface TemplateInsert {
  name: string;
  detail_cost_category_id: string;
}

export interface Template extends TemplateInsert {
  id: string;
  created_at: string;
  updated_at: string;
  folder_id?: string | null;
}

// =============================================
// Типы для таблицы template_items
// =============================================

export type TemplateItemKind = 'work' | 'material';

export interface TemplateItemInsert {
  template_id: string;
  kind: TemplateItemKind;
  work_library_id?: string | null;
  material_library_id?: string | null;
  parent_work_item_id?: string | null;
  conversation_coeff?: number | null;
  detail_cost_category_id?: string | null;
  position?: number;
  note?: string | null;
}

export interface TemplateItem extends TemplateItemInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// Расширенные типы с JOIN данными
export interface TemplateItemFull extends TemplateItem {
  work_name?: string;
  work_unit?: UnitType;
  material_name?: string;
  material_unit?: UnitType;
  parent_work_name?: string;
  detail_cost_category_name?: string;
  detail_cost_category_full?: string; // Format: "Category / Detail / Location"
}

// =============================================
// Markup Tactics (Тактики наценок)
// =============================================

// Структура шага наценки
export interface MarkupStep {
  name?: string; // Название пункта
  baseIndex: number; // -1 для базовой стоимости, или индекс пункта в массиве

  // Первая операция (обязательная)
  action1: 'multiply' | 'divide' | 'add' | 'subtract';
  operand1Type: 'markup' | 'step' | 'number'; // наценка, результат другого шага или число
  operand1Key?: string | number; // ключ наценки (если operand1Type = 'markup') или число (если operand1Type = 'number')
  operand1Index?: number; // индекс шага (если operand1Type = 'step')
  operand1MultiplyFormat?: 'addOne' | 'direct'; // формат умножения: 'addOne' = (1 + %), 'direct' = %

  // Вторая операция (опциональная)
  action2?: 'multiply' | 'divide' | 'add' | 'subtract';
  operand2Type?: 'markup' | 'step' | 'number';
  operand2Key?: string | number;
  operand2Index?: number;
  operand2MultiplyFormat?: 'addOne' | 'direct';

  // Третья операция (опциональная)
  action3?: 'multiply' | 'divide' | 'add' | 'subtract';
  operand3Type?: 'markup' | 'step' | 'number';
  operand3Key?: string | number;
  operand3Index?: number;
  operand3MultiplyFormat?: 'addOne' | 'direct';

  // Четвертая операция (опциональная)
  action4?: 'multiply' | 'divide' | 'add' | 'subtract';
  operand4Type?: 'markup' | 'step' | 'number';
  operand4Key?: string | number;
  operand4Index?: number;
  operand4MultiplyFormat?: 'addOne' | 'direct';

  // Пятая операция (опциональная)
  action5?: 'multiply' | 'divide' | 'add' | 'subtract';
  operand5Type?: 'markup' | 'step' | 'number';
  operand5Key?: string | number;
  operand5Index?: number;
  operand5MultiplyFormat?: 'addOne' | 'direct';
}

// Маппинг UI ключей вкладок на boq_item_type
export type TabKey = 'works' | 'materials' | 'subcontract_works' | 'subcontract_materials' | 'work_comp' | 'material_comp';

export const TAB_TO_BOQ_TYPE: Record<TabKey, BoqItemType> = {
  works: 'раб',
  materials: 'мат',
  subcontract_works: 'суб-раб',
  subcontract_materials: 'суб-мат',
  work_comp: 'раб-комп.',
  material_comp: 'мат-комп.',
};

export const BOQ_TYPE_TO_TAB: Record<BoqItemType, TabKey> = {
  'раб': 'works',
  'мат': 'materials',
  'суб-раб': 'subcontract_works',
  'суб-мат': 'subcontract_materials',
  'раб-комп.': 'work_comp',
  'мат-комп.': 'material_comp',
};

// Структура последовательностей наценок (используем boq_item_type)
export interface MarkupSequences {
  'раб': MarkupStep[];
  'мат': MarkupStep[];
  'суб-раб': MarkupStep[];
  'суб-мат': MarkupStep[];
  'раб-комп.': MarkupStep[];
  'мат-комп.': MarkupStep[];
}

// Структура базовых стоимостей (используем boq_item_type)
export interface BaseCosts {
  'раб': number;
  'мат': number;
  'суб-раб': number;
  'суб-мат': number;
  'раб-комп.': number;
  'мат-комп.': number;
}

// Вставка новой тактики
export interface MarkupTacticInsert {
  name?: string;
  sequences: MarkupSequences;
  base_costs: BaseCosts;
  user_id?: string;
  is_global?: boolean;
}

// Полная тактика наценок
export interface MarkupTactic extends MarkupTacticInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Типы для таблицы boq_items (элементы позиций заказчика)
// =============================================

export interface BoqItemInsert {
  // Связи
  tender_id: string;
  client_position_id: string;

  // Сортировка
  sort_number?: number;

  // Типы элементов
  boq_item_type: BoqItemType;
  material_type?: MaterialType | null;

  // Наименования
  material_name_id?: string | null;
  work_name_id?: string | null;

  // Единица измерения
  unit_code?: string | null;

  // Количественные показатели
  quantity?: number | null;
  base_quantity?: number | null;
  consumption_coefficient?: number | null;
  conversion_coefficient?: number | null;

  // Привязка материала к работе
  parent_work_item_id?: string | null;

  // Доставка
  delivery_price_type?: DeliveryPriceType | null;
  delivery_amount?: number | null;

  // Валюта и суммы
  currency_type?: CurrencyType;
  unit_rate?: number | null;
  total_amount?: number | null;

  // Затрата на строительство
  detail_cost_category_id?: string | null;

  // Примечание
  quote_link?: string | null;
  description?: string | null;

  // Коммерческие показатели
  commercial_markup?: number | null;
  total_commercial_material_cost?: number | null;
  total_commercial_work_cost?: number | null;
}

export interface BoqItem extends BoqItemInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// Расширенный тип с JOIN данными
export interface BoqItemFull extends BoqItem {
  // Данные из material_names
  material_name?: string;
  material_unit?: UnitType;

  // Данные из work_names
  work_name?: string;
  work_unit?: UnitType;

  // Данные из detail_cost_categories
  detail_cost_category_name?: string;
  detail_cost_category_full?: string; // Format: "Category / Detail / Location"

  // Данные из units
  unit_name?: string;

  // Данные родительской работы (для привязанных материалов)
  parent_work_name?: string;
  parent_work_unit?: UnitType;
  parent_work_quantity?: number;
}

// =============================================
// Типы для таблицы notifications (уведомления)
// =============================================

export type NotificationType = 'success' | 'info' | 'warning' | 'pending';

export interface NotificationInsert {
  type: NotificationType;
  title: string;
  message: string;
  related_entity_type?: string | null;
  related_entity_id?: string | null;
  is_read?: boolean;
}

export interface Notification extends NotificationInsert {
  id: string;
  created_at: string;
}

// =============================================
// Типы для таблицы client_positions (позиции заказчика)
// =============================================

export interface ClientPositionInsert {
  tender_id: string;
  position_number: number;
  unit_code?: string | null;
  volume?: number | null;
  client_note?: string | null;
  item_no?: string | null;
  work_name: string;
  manual_volume?: number | null;
  manual_note?: string | null;
  hierarchy_level?: number;
  is_additional?: boolean;
  parent_position_id?: string | null;
  total_material?: number;
  total_works?: number;
  material_cost_per_unit?: number;
  work_cost_per_unit?: number;
  total_commercial_material?: number;
  total_commercial_work?: number;
  total_commercial_material_per_unit?: number;
  total_commercial_work_per_unit?: number;
}

export interface ClientPosition extends ClientPositionInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Типы для таблицы tender_pricing_distribution
// =============================================

export type DistributionTarget = 'material' | 'work';

export interface PricingDistributionInsert {
  tender_id: string;
  markup_tactic_id?: string | null;

  // Основные материалы (мат)
  basic_material_base_target?: DistributionTarget;
  basic_material_markup_target?: DistributionTarget;

  // Вспомогательные материалы (мат-комп.)
  auxiliary_material_base_target?: DistributionTarget;
  auxiliary_material_markup_target?: DistributionTarget;

  // Компонентные материалы (мат-комп.)
  component_material_base_target?: DistributionTarget;
  component_material_markup_target?: DistributionTarget;

  // Субподрядные материалы - основные (суб-мат основные)
  subcontract_basic_material_base_target?: DistributionTarget;
  subcontract_basic_material_markup_target?: DistributionTarget;

  // Субподрядные материалы - вспомогательные (суб-мат вспомогательные)
  subcontract_auxiliary_material_base_target?: DistributionTarget;
  subcontract_auxiliary_material_markup_target?: DistributionTarget;

  // Работы (раб)
  work_base_target?: DistributionTarget;
  work_markup_target?: DistributionTarget;

  // Компонентные работы (раб-комп.)
  component_work_base_target?: DistributionTarget;
  component_work_markup_target?: DistributionTarget;
}

export interface PricingDistribution extends PricingDistributionInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// Вспомогательный тип для маппинга boq_item_type на ключи правил распределения
export type PricingItemType = 'basic_material' | 'auxiliary_material' | 'subcontract_material' | 'work';

// Функция маппинга boq_item_type на PricingItemType
export function mapBoqItemTypeToPricingType(boqItemType: BoqItemType): PricingItemType {
  switch (boqItemType) {
    case 'мат':
      return 'basic_material';
    case 'мат-комп.':
      return 'auxiliary_material';
    case 'суб-мат':
      return 'subcontract_material';
    case 'раб':
    case 'раб-комп.':
    case 'суб-раб':
      return 'work';
  }
}

// =============================================
// Типы для таблицы subcontract_growth_exclusions
// =============================================

export type SubcontractExclusionType = 'works' | 'materials';

export interface SubcontractGrowthExclusionInsert {
  tender_id: string;
  detail_cost_category_id: string;
  exclusion_type: SubcontractExclusionType;
}

export interface SubcontractGrowthExclusion extends SubcontractGrowthExclusionInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Типы для таблицы cost_redistribution_results
// =============================================

export interface RedistributionRule {
  deductions: Array<{
    level: 'category' | 'detail';
    category_id?: string;
    detail_cost_category_id?: string;
    category_name: string;
    percentage: number;
  }>;
  targets: Array<{
    level: 'category' | 'detail';
    category_id?: string;
    detail_cost_category_id?: string;
    category_name: string;
  }>;
}

export interface CostRedistributionResultInsert {
  tender_id: string;
  markup_tactic_id: string;
  boq_item_id: string;
  original_work_cost?: number | null;
  deducted_amount?: number;
  added_amount?: number;
  final_work_cost?: number | null;
  redistribution_rules?: RedistributionRule | null;
  created_by?: string | null;
}

export interface CostRedistributionResult extends CostRedistributionResultInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

// =============================================
// Типы для таблицы users (пользователи портала)
// =============================================

export type UserRole = 'Руководитель' | 'Администратор' | 'Разработчик' | 'Старший группы' | 'Инженер';
export type AccessStatus = 'pending' | 'approved' | 'blocked';

export interface UserInsert {
  id: string; // UUID from auth.users
  full_name: string;
  email: string;
  role: UserRole; // Русское название роли (для отображения)
  role_code: string; // Связь с roles.code (administrator, developer, director, engineer, senior_group, general_director)
  access_status?: AccessStatus;
  allowed_pages?: string[]; // Массив путей страниц. Пустой массив = полный доступ. Синхронизируется из roles.allowed_pages
  approved_by?: string | null;
  approved_at?: string | null;
  password?: string | null; // ВНИМАНИЕ: хранится в открытом виде (только для справки администраторов)
  access_enabled?: boolean; // Флаг доступа: true - может войти, false - доступ закрыт
}

export interface User extends UserInsert {
  role_code: string;
  access_status: AccessStatus;
  allowed_pages: string[];
  registration_date: string;
  created_at: string;
  updated_at: string;
  password: string | null;
  access_enabled: boolean;
  tender_deadline_extensions?: TenderDeadlineExtension[];
}

// Упрощенный тип пользователя для AuthContext
export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  role_code?: string;
  role_color?: string;
  access_status: AccessStatus;
  allowed_pages: string[];
  access_enabled: boolean;
}

// =============================================
// Типы для системы управления дедлайнами
// =============================================

export interface TenderDeadlineExtension {
  tender_id: string;
  extended_deadline: string; // ISO 8601 timestamp
}

export interface DeadlineCheckResult {
  isExpired: boolean;      // Истек ли дедлайн
  canEdit: boolean;        // Может ли редактировать
  deadline: Date | null;   // Эффективный дедлайн
  isExtended: boolean;     // Продлен ли вручную
}

// =============================================
// Типы для таблицы import_sessions (сессии импорта BOQ из Excel)
// =============================================

export interface ImportSession {
  id: string;
  user_id: string | null;
  tender_id: string;
  file_name: string | null;
  items_count: number;
  positions_snapshot: Array<{
    id: string;
    manual_volume: number | null;
    manual_note: string | null;
  }> | null;
  imported_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
}

// =============================================
// Типы для таблицы user_position_filters (персональные фильтры позиций)
// =============================================

export interface UserPositionFilter {
  id: string;
  user_id: string;
  tender_id: string;
  position_id: string;
  created_at: string;
}

// =============================================
// Константы прав доступа по ролям
// =============================================

// Все страницы портала (для Transfer component и проверки доступа)
export const ALL_PAGES = [
  '/dashboard',
  '/tenders',
  '/tasks',
  '/admin/nomenclatures',
  '/admin/tenders',
  '/admin/construction_cost',
  '/admin/markup_constructor',
  '/admin/markup',
  '/library',
  '/library/templates',
  '/positions',
  '/positions/:positionId/items',
  '/commerce',
  '/commerce/proposal',
  '/commerce/redistribution',
  '/costs',
  '/bsm',
  '/analytics/comparison',
  '/financial-indicators',
  '/projects',
  '/projects/:projectId',
  '/settings',
  '/users',
  '/admin/import-log',
  '/admin/insurance',
] as const;

// Страницы по умолчанию для каждой роли
// Пустой массив = полный доступ (для Администратора, Руководителя и Разработчика)
export const DEFAULT_ROLE_PAGES: Record<UserRole, string[]> = {
  'Руководитель': [], // Полный доступ
  'Администратор': [], // Полный доступ
  'Разработчик': [], // Полный доступ (для отладки и разработки)
  'Старший группы': [
    '/dashboard',
    '/tasks',
    '/positions',
    '/positions/:positionId/items',
    '/commerce',
    '/commerce/proposal',
    '/library',
    '/library/templates',
    '/costs',
    '/bsm',
    '/analytics/comparison',
    '/financial-indicators',
    '/settings',
  ],
  'Инженер': [
    '/dashboard',
    '/tasks',
    '/positions',
    '/positions/:positionId/items',
    '/library',
    '/library/templates',
    '/bsm',
    '/settings',
  ],
};

// Названия страниц (соответствуют левому боковому меню)
export const PAGE_LABELS: Record<string, string> = {
  '/dashboard': 'Дашборд',
  '/tenders': 'Перечень тендеров',
  '/tasks': 'Список задач',
  '/positions': 'Позиции заказчика',
  '/commerce/proposal': 'Форма КП',
  '/commerce/redistribution': 'Перераспределение',
  '/library': 'Материалы и работы',
  '/library/templates': 'Шаблоны',
  '/bsm': 'Базовая стоимость',
  '/costs': 'Затраты на строительство',
  '/financial-indicators': 'Финансовые показатели',
  '/analytics/comparison': 'Сравнение объектов',
  '/projects': 'Текущие объекты',
  '/projects/:projectId': 'Детали объекта',
  '/admin/nomenclatures': 'Номенклатуры',
  '/admin/tenders': 'Тендеры',
  '/admin/construction_cost': 'Справочник затрат',
  '/admin/markup': 'Проценты наценок',
  '/admin/markup_constructor': 'Конструктор наценок',
  '/admin/import-log': 'Журнал импортов строк',
  '/admin/insurance': 'Страхование от судимостей',
  '/users': 'Пользователи',
  '/settings': 'Настройки',
  '/positions/:positionId/items': 'Работы и материалы',
  '/commerce': 'Форма КП', // Старый путь, оставлен для совместимости
};

// Структура страниц с группировкой (для UI модального окна)
export const PAGES_STRUCTURE = [
  {
    title: null, // Без группы
    pages: ['/dashboard', '/tenders', '/tasks', '/positions'],
  },
  {
    title: 'Коммерция',
    pages: ['/commerce/proposal', '/commerce/redistribution'],
  },
  {
    title: 'Библиотеки',
    pages: ['/library', '/library/templates'],
  },
  {
    title: null, // Без группы
    pages: ['/bsm', '/costs', '/financial-indicators'],
  },
  {
    title: 'Аналитика',
    pages: ['/analytics/comparison', '/projects'],
  },
  {
    title: 'Администрирование',
    pages: [
      '/admin/nomenclatures',
      '/admin/tenders',
      '/admin/construction_cost',
      '/admin/markup',
      '/admin/markup_constructor',
      '/admin/import-log',
    ],
  },
  {
    title: null, // Без группы
    pages: ['/users', '/settings'],
  },
] as const;

// =============================================
// Вспомогательные функции для работы с пользователями
// =============================================

/**
 * Проверка, может ли пользователь управлять другими пользователями
 * (одобрять регистрации, блокировать, редактировать права)
 */
export const canManageUsers = (role: UserRole): boolean => {
  return role === 'Администратор' || role === 'Руководитель' || role === 'Разработчик';
};

/**
 * Проверка доступа пользователя к странице
 * @param user - Авторизованный пользователь
 * @param pagePath - Путь страницы (например, '/dashboard' или '/positions/123/items')
 * @returns true если пользователь имеет доступ к странице
 */
export const hasPageAccess = (user: AuthUser, pagePath: string): boolean => {
  // Администраторы и Руководители имеют полный доступ
  if (canManageUsers(user.role)) {
    return true;
  }

  // Пустой массив allowed_pages = полный доступ
  if (user.allowed_pages.length === 0) {
    return true;
  }

  // Специальная логика: если есть доступ к /positions, автоматически разрешен доступ к /positions/:positionId/items
  // Эти страницы являются одним целым - просмотр позиций и их элементов (работ и материалов)
  if (pagePath.match(/^\/positions\/[^/]+\/items$/)) {
    // Проверяем, есть ли доступ к родительской странице /positions
    if (user.allowed_pages.includes('/positions')) {
      return true;
    }
  }

  // Специальная логика: если есть доступ к /projects, автоматически разрешен доступ к /projects/:projectId
  // Эти страницы являются одним целым - просмотр списка объектов и деталей конкретного объекта
  if (pagePath.match(/^\/projects\/[^/]+$/)) {
    // Проверяем, есть ли доступ к родительской странице /projects
    if (user.allowed_pages.includes('/projects')) {
      return true;
    }
  }

  // Проверяем, соответствует ли текущий путь хотя бы одному разрешенному
  return user.allowed_pages.some((allowedPath) => {
    // Преобразуем паттерн маршрута в regex
    // Например, /positions/:positionId/items -> /positions/[^/]+/items
    const pattern = '^' + allowedPath.replace(/:[^/]+/g, '[^/]+') + '$';
    const regex = new RegExp(pattern);
    return regex.test(pagePath);
  });
};

/**
 * Проверка, является ли пользователь администратором
 */
export const isAdmin = (role: UserRole): boolean => {
  return role === 'Администратор';
};

/**
 * Проверка, является ли пользователь руководителем
 */
export const isLeader = (role: UserRole): boolean => {
  return role === 'Руководитель';
};

// ============================================
// Projects Types (Текущие объекты)
// ============================================

/**
 * Базовая структура проекта (для вставки)
 */
export interface ProjectInsert {
  name: string;
  client_name: string;
  contract_cost: number;
  contract_date?: string | null;
  area?: number | null;
  construction_end_date?: string | null;
  tender_id?: string | null;
  is_active?: boolean;
  created_by?: string | null;
}

/**
 * Дополнительное соглашение к проекту
 */
export interface ProjectAgreement {
  id: string;
  project_id: string;
  agreement_number: string;
  agreement_date: string;
  amount: number;
  description?: string | null;
  created_at: string;
}

/**
 * Ежемесячное выполнение проекта
 */
export interface ProjectCompletion {
  id: string;
  project_id: string;
  year: number;
  month: number;
  actual_amount: number;
  forecast_amount?: number | null;
  note?: string | null;
  created_at: string;
}

/**
 * Полная структура проекта с вычисляемыми полями
 */
export interface ProjectFull extends ProjectInsert {
  id: string;
  created_at: string;
  updated_at: string;

  // Joined data
  tender?: {
    id: string;
    title: string;
    tender_number: string;
  } | null;

  // Computed fields
  additional_agreements_sum?: number;
  final_contract_cost?: number;
  total_completion?: number;
  completion_percentage?: number;
  tender_name?: string;
  tender_number?: string;
}

// =============================================
// TenderNote — заметки пользователей к тендеру
// =============================================

export interface TenderNoteInsert {
  tender_id: string;
  user_id: string;
  note_text: string;
}

export interface TenderNote extends TenderNoteInsert {
  id: string;
  created_at: string;
  updated_at: string;
}

/** С данными автора (для отображения привилегированным ролям) */
export interface TenderNoteFull extends TenderNote {
  user_full_name: string;
}

/** Коды ролей, которые видят все заметки тендера:
 *  Администратор, Разработчик, Руководитель, Ведущий инженер */
export const NOTE_VIEWER_ROLES = [
  'administrator',
  'developer',
  'director',
  'senior_group',
  'veduschiy_inzhener',
] as const;

export const canViewAllNotes = (roleCode: string): boolean =>
  (NOTE_VIEWER_ROLES as readonly string[]).includes(roleCode);
