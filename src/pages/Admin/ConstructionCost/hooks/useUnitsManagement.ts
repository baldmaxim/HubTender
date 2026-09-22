import { useState } from 'react';
import { listActiveUnitsFull, type UnitRow } from '../../../../lib/api/costs';

export const useUnitsManagement = () => {
  const [availableUnits, setAvailableUnits] = useState<string[]>([]);
  const [unitsData, setUnitsData] = useState<UnitRow[]>([]);

  const loadUnits = async () => {
    try {
      const units = await listActiveUnitsFull();
      setAvailableUnits(units.map((u) => u.code));
      setUnitsData(units);
    } catch (error) {
      console.error('Ошибка загрузки единиц измерения:', error);
      setAvailableUnits(['шт', 'м', 'м2', 'м3', 'кг', 'т', 'л', 'компл', 'м.п.']);
    }
  };

  return {
    availableUnits,
    unitsData,
    loadUnits,
  };
};
