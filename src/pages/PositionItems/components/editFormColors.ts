// Цвета inline-форм редактирования BOQ-элементов.
// ВНИМАНИЕ: getBorderColor здесь — материал-версия (мат/суб-мат/мат-комп.);
// у WorkEditForm своя одноимённая функция с ветками работ — не унифицировать.

// Функция для получения цвета border на основе типа материала
export const getBorderColor = (type: string) => {
  switch (type) {
    case 'мат':
      return '#2196f3';
    case 'суб-мат':
      return '#9ccc65';
    case 'мат-комп.':
      return '#00897b';
    default:
      return '#d9d9d9';
  }
};

// Функция для получения цвета типа работы
export const getWorkTypeColor = (type: string) => {
  switch (type) {
    case 'раб':
      return '#ff9800';
    case 'суб-раб':
      return '#9c27b0';
    case 'раб-комп.':
      return '#f44336';
    default:
      return '#d9d9d9';
  }
};
