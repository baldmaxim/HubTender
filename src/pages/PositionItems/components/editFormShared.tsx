// Общие мелочи inline-форм редактирования BOQ-элементов (материал/работа).
// Цветовые функции — в ./editFormColors.ts (react-refresh требует, чтобы
// .tsx экспортировал только компоненты).

export interface CostCategoryOption {
  value: string;
  label: string;
  cost_category_name: string;
  location: string;
}

// Компонент для заголовка поля с опциональной звездочкой
export const FieldLabel: React.FC<{ label: string; required?: boolean; align?: 'left' | 'center' }> = ({ label, required, align = 'center' }) => (
  <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px', textAlign: align }}>
    {required && <span style={{ color: 'red', marginRight: '4px' }}>*</span>}
    {label}
  </div>
);
