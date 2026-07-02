import { useState } from 'react';
import { message } from 'antd';
import type { MarkupStep } from '../../../../lib/supabase';
import type { TabKey, ActionType, OperandType, MultiplyFormat, InputMode, OperandState } from '../types';
import { createInitialOperandState } from '../constants';

// Состояние 5-операционного конструктора шага наценки (per-tab Record'ы) и
// операции над последовательностью (add/edit/remove/move). Перенесено из
// MarkupConstructor; 30 useState-инициализаторов свёрнуты в
// createInitialOperandState с теми же начальными значениями.
export const useStepBuilderState = ({
  markupSequences,
  setMarkupSequences,
}: {
  markupSequences: Record<TabKey, MarkupStep[]>;
  setMarkupSequences: React.Dispatch<React.SetStateAction<Record<TabKey, MarkupStep[]>>>;
}) => {
  // Состояния для формы добавления наценок для каждой вкладки
  const [insertPositions, setInsertPositions] = useState<OperandState<number | undefined>>(createInitialOperandState(undefined));

  // Первая операция
  const [action1, setAction1] = useState<OperandState<ActionType>>(createInitialOperandState('multiply'));
  const [operand1Type, setOperand1Type] = useState<OperandState<OperandType>>(createInitialOperandState('markup'));
  const [operand1Value, setOperand1Value] = useState<OperandState<string | number | undefined>>(createInitialOperandState(undefined));
  const [operand1InputMode, setOperand1InputMode] = useState<OperandState<InputMode>>(createInitialOperandState('select'));
  const [operand1MultiplyFormat, setOperand1MultiplyFormat] = useState<OperandState<MultiplyFormat>>(createInitialOperandState('addOne'));

  // Вторая операция
  const [action2, setAction2] = useState<OperandState<ActionType>>(createInitialOperandState('multiply'));
  const [operand2Type, setOperand2Type] = useState<OperandState<OperandType>>(createInitialOperandState('markup'));
  const [operand2Value, setOperand2Value] = useState<OperandState<string | number | undefined>>(createInitialOperandState(undefined));
  const [operand2MultiplyFormat, setOperand2MultiplyFormat] = useState<OperandState<MultiplyFormat>>(createInitialOperandState('addOne'));

  // Третья операция
  const [action3, setAction3] = useState<OperandState<ActionType>>(createInitialOperandState('multiply'));
  const [operand3Type, setOperand3Type] = useState<OperandState<OperandType>>(createInitialOperandState('markup'));
  const [operand3Value, setOperand3Value] = useState<OperandState<string | number | undefined>>(createInitialOperandState(undefined));
  const [operand3MultiplyFormat, setOperand3MultiplyFormat] = useState<OperandState<MultiplyFormat>>(createInitialOperandState('addOne'));

  // Четвертая операция
  const [action4, setAction4] = useState<OperandState<ActionType>>(createInitialOperandState('multiply'));
  const [operand4Type, setOperand4Type] = useState<OperandState<OperandType>>(createInitialOperandState('markup'));
  const [operand4Value, setOperand4Value] = useState<OperandState<string | number | undefined>>(createInitialOperandState(undefined));
  const [operand4MultiplyFormat, setOperand4MultiplyFormat] = useState<OperandState<MultiplyFormat>>(createInitialOperandState('addOne'));

  // Пятая операция
  const [action5, setAction5] = useState<OperandState<ActionType>>(createInitialOperandState('multiply'));
  const [operand5Type, setOperand5Type] = useState<OperandState<OperandType>>(createInitialOperandState('markup'));
  const [operand5Value, setOperand5Value] = useState<OperandState<string | number | undefined>>(createInitialOperandState(undefined));
  const [operand5MultiplyFormat, setOperand5MultiplyFormat] = useState<OperandState<MultiplyFormat>>(createInitialOperandState('addOne'));

  // Режим ввода операндов (выбор из списка или ручной ввод числа)
  const [operand2InputMode, setOperand2InputMode] = useState<OperandState<InputMode>>(createInitialOperandState('select'));
  const [operand3InputMode, setOperand3InputMode] = useState<OperandState<InputMode>>(createInitialOperandState('select'));
  const [operand4InputMode, setOperand4InputMode] = useState<OperandState<InputMode>>(createInitialOperandState('select'));
  const [operand5InputMode, setOperand5InputMode] = useState<OperandState<InputMode>>(createInitialOperandState('select'));

  // Видимость полей второго-пятого действия
  const [showSecondAction, setShowSecondAction] = useState<OperandState<boolean>>(createInitialOperandState(false));
  const [showThirdAction, setShowThirdAction] = useState<OperandState<boolean>>(createInitialOperandState(false));
  const [showFourthAction, setShowFourthAction] = useState<OperandState<boolean>>(createInitialOperandState(false));
  const [showFifthAction, setShowFifthAction] = useState<OperandState<boolean>>(createInitialOperandState(false));

  // Названия пунктов
  const [stepName, setStepName] = useState<OperandState<string>>(createInitialOperandState(''));

  // Функции для управления порядком наценок
  const addMarkup = (tabKey: TabKey) => {
    const baseIdx = insertPositions[tabKey];
    const act1 = action1[tabKey];
    const op1Type = operand1Type[tabKey];
    const op1Value = operand1Value[tabKey];
    const act2 = action2[tabKey];
    const op2Type = operand2Type[tabKey];
    const op2Value = operand2Value[tabKey];
    const act3 = action3[tabKey];
    const op3Type = operand3Type[tabKey];
    const op3Value = operand3Value[tabKey];
    const act4 = action4[tabKey];
    const op4Type = operand4Type[tabKey];
    const op4Value = operand4Value[tabKey];
    const act5 = action5[tabKey];
    const op5Type = operand5Type[tabKey];
    const op5Value = operand5Value[tabKey];

    if (baseIdx === undefined || op1Value === undefined) {
      message.warning('Заполните обязательные поля');
      return;
    }

    const newStep: MarkupStep = {
      name: stepName[tabKey] || undefined,
      baseIndex: baseIdx,
      action1: act1,
      operand1Type: op1Type,
      operand1Key: op1Type === 'markup' ? String(op1Value) : (op1Type === 'number' ? Number(op1Value) : undefined),
      operand1Index: op1Type === 'step' ? Number(op1Value) : undefined,
      operand1MultiplyFormat: act1 === 'multiply' && op1Type === 'markup' ? operand1MultiplyFormat[tabKey] : undefined,
    };

    // Добавляем вторую операцию, если она заполнена
    if (op2Value !== undefined) {
      newStep.action2 = act2;
      newStep.operand2Type = op2Type;
      newStep.operand2Key = op2Type === 'markup' ? String(op2Value) : (op2Type === 'number' ? Number(op2Value) : undefined);
      newStep.operand2Index = op2Type === 'step' ? Number(op2Value) : undefined;
      newStep.operand2MultiplyFormat = act2 === 'multiply' && op2Type === 'markup' ? operand2MultiplyFormat[tabKey] : undefined;
    }

    // Добавляем третью операцию, если она заполнена
    if (op3Value !== undefined) {
      newStep.action3 = act3;
      newStep.operand3Type = op3Type;
      newStep.operand3Key = op3Type === 'markup' ? String(op3Value) : (op3Type === 'number' ? Number(op3Value) : undefined);
      newStep.operand3Index = op3Type === 'step' ? Number(op3Value) : undefined;
      newStep.operand3MultiplyFormat = act3 === 'multiply' && op3Type === 'markup' ? operand3MultiplyFormat[tabKey] : undefined;
    }

    // Добавляем четвертую операцию, если она заполнена
    if (op4Value !== undefined) {
      newStep.action4 = act4;
      newStep.operand4Type = op4Type;
      newStep.operand4Key = op4Type === 'markup' ? String(op4Value) : (op4Type === 'number' ? Number(op4Value) : undefined);
      newStep.operand4Index = op4Type === 'step' ? Number(op4Value) : undefined;
      newStep.operand4MultiplyFormat = act4 === 'multiply' && op4Type === 'markup' ? operand4MultiplyFormat[tabKey] : undefined;
    }

    // Добавляем пятую операцию, если она заполнена
    if (op5Value !== undefined) {
      newStep.action5 = act5;
      newStep.operand5Type = op5Type;
      newStep.operand5Key = op5Type === 'markup' ? String(op5Value) : (op5Type === 'number' ? Number(op5Value) : undefined);
      newStep.operand5Index = op5Type === 'step' ? Number(op5Value) : undefined;
      newStep.operand5MultiplyFormat = act5 === 'multiply' && op5Type === 'markup' ? operand5MultiplyFormat[tabKey] : undefined;
    }

    setMarkupSequences(prev => ({
      ...prev,
      [tabKey]: [...prev[tabKey], newStep]
    }));

    // Очищаем форму
    setOperand1Value(prev => ({ ...prev, [tabKey]: undefined }));
    setOperand2Value(prev => ({ ...prev, [tabKey]: undefined }));
    setOperand3Value(prev => ({ ...prev, [tabKey]: undefined }));
    setOperand4Value(prev => ({ ...prev, [tabKey]: undefined }));
    setOperand5Value(prev => ({ ...prev, [tabKey]: undefined }));
    setInsertPositions(prev => ({ ...prev, [tabKey]: undefined }));
    setStepName(prev => ({ ...prev, [tabKey]: '' }));
    setShowSecondAction(prev => ({ ...prev, [tabKey]: false }));
    setShowThirdAction(prev => ({ ...prev, [tabKey]: false }));
    setShowFourthAction(prev => ({ ...prev, [tabKey]: false }));
    setShowFifthAction(prev => ({ ...prev, [tabKey]: false }));
  };

  const removeMarkup = (tabKey: TabKey, index: number) => {
    setMarkupSequences(prev => ({
      ...prev,
      [tabKey]: prev[tabKey].filter((_, i) => i !== index)
    }));
  };

  const editMarkup = (tabKey: TabKey, index: number) => {
    const step = markupSequences[tabKey][index];

    // Загружаем данные в форму
    setStepName(prev => ({ ...prev, [tabKey]: step.name || '' }));
    setInsertPositions(prev => ({ ...prev, [tabKey]: step.baseIndex }));
    setAction1(prev => ({ ...prev, [tabKey]: step.action1 }));
    setOperand1Type(prev => ({ ...prev, [tabKey]: step.operand1Type }));
    setOperand1Value(prev => ({
      ...prev,
      [tabKey]: step.operand1Type === 'markup' ? step.operand1Key : (step.operand1Type === 'number' ? step.operand1Key : step.operand1Index)
    }));
    setOperand1InputMode(prev => ({
      ...prev,
      [tabKey]: step.operand1Type === 'number' ? 'manual' : 'select'
    }));
    setOperand1MultiplyFormat(prev => ({
      ...prev,
      [tabKey]: step.operand1MultiplyFormat || 'addOne'
    }));

    if (step.action2 && step.operand2Type) {
      setAction2(prev => ({ ...prev, [tabKey]: step.action2! }));
      setOperand2Type(prev => ({ ...prev, [tabKey]: step.operand2Type! }));
      setOperand2Value(prev => ({
        ...prev,
        [tabKey]: step.operand2Type === 'markup' ? step.operand2Key : (step.operand2Type === 'number' ? step.operand2Key : step.operand2Index)
      }));
      setOperand2InputMode(prev => ({
        ...prev,
        [tabKey]: step.operand2Type === 'number' ? 'manual' : 'select'
      }));
      setOperand2MultiplyFormat(prev => ({
        ...prev,
        [tabKey]: step.operand2MultiplyFormat || 'addOne'
      }));
      setShowSecondAction(prev => ({ ...prev, [tabKey]: true }));
    } else {
      setOperand2Value(prev => ({ ...prev, [tabKey]: undefined }));
      setShowSecondAction(prev => ({ ...prev, [tabKey]: false }));
    }

    if (step.action3 && step.operand3Type) {
      setAction3(prev => ({ ...prev, [tabKey]: step.action3! }));
      setOperand3Type(prev => ({ ...prev, [tabKey]: step.operand3Type! }));
      setOperand3Value(prev => ({
        ...prev,
        [tabKey]: step.operand3Type === 'markup' ? step.operand3Key : (step.operand3Type === 'number' ? step.operand3Key : step.operand3Index)
      }));
      setOperand3InputMode(prev => ({
        ...prev,
        [tabKey]: step.operand3Type === 'number' ? 'manual' : 'select'
      }));
      setOperand3MultiplyFormat(prev => ({
        ...prev,
        [tabKey]: step.operand3MultiplyFormat || 'addOne'
      }));
      setShowThirdAction(prev => ({ ...prev, [tabKey]: true }));
    } else {
      setOperand3Value(prev => ({ ...prev, [tabKey]: undefined }));
      setShowThirdAction(prev => ({ ...prev, [tabKey]: false }));
    }

    if (step.action4 && step.operand4Type) {
      setAction4(prev => ({ ...prev, [tabKey]: step.action4! }));
      setOperand4Type(prev => ({ ...prev, [tabKey]: step.operand4Type! }));
      setOperand4Value(prev => ({
        ...prev,
        [tabKey]: step.operand4Type === 'markup' ? step.operand4Key : (step.operand4Type === 'number' ? step.operand4Key : step.operand4Index)
      }));
      setOperand4InputMode(prev => ({
        ...prev,
        [tabKey]: step.operand4Type === 'number' ? 'manual' : 'select'
      }));
      setOperand4MultiplyFormat(prev => ({
        ...prev,
        [tabKey]: step.operand4MultiplyFormat || 'addOne'
      }));
      setShowFourthAction(prev => ({ ...prev, [tabKey]: true }));
    } else {
      setOperand4Value(prev => ({ ...prev, [tabKey]: undefined }));
      setShowFourthAction(prev => ({ ...prev, [tabKey]: false }));
    }

    if (step.action5 && step.operand5Type) {
      setAction5(prev => ({ ...prev, [tabKey]: step.action5! }));
      setOperand5Type(prev => ({ ...prev, [tabKey]: step.operand5Type! }));
      setOperand5Value(prev => ({
        ...prev,
        [tabKey]: step.operand5Type === 'markup' ? step.operand5Key : (step.operand5Type === 'number' ? step.operand5Key : step.operand5Index)
      }));
      setOperand5InputMode(prev => ({
        ...prev,
        [tabKey]: step.operand5Type === 'number' ? 'manual' : 'select'
      }));
      setOperand5MultiplyFormat(prev => ({
        ...prev,
        [tabKey]: step.operand5MultiplyFormat || 'addOne'
      }));
      setShowFifthAction(prev => ({ ...prev, [tabKey]: true }));
    } else {
      setOperand5Value(prev => ({ ...prev, [tabKey]: undefined }));
      setShowFifthAction(prev => ({ ...prev, [tabKey]: false }));
    }

    // Удаляем элемент из списка
    removeMarkup(tabKey, index);
  };

  const moveMarkupUp = (tabKey: TabKey, index: number) => {
    if (index === 0) return;
    setMarkupSequences(prev => {
      const newSequence = [...prev[tabKey]];
      [newSequence[index - 1], newSequence[index]] = [newSequence[index], newSequence[index - 1]];
      return { ...prev, [tabKey]: newSequence };
    });
  };

  const moveMarkupDown = (tabKey: TabKey, index: number) => {
    setMarkupSequences(prev => {
      if (index === prev[tabKey].length - 1) return prev;
      const newSequence = [...prev[tabKey]];
      [newSequence[index], newSequence[index + 1]] = [newSequence[index + 1], newSequence[index]];
      return { ...prev, [tabKey]: newSequence };
    });
  };

  return {
    insertPositions, setInsertPositions,
    action1, setAction1,
    operand1Type, setOperand1Type,
    operand1Value, setOperand1Value,
    operand1InputMode, setOperand1InputMode,
    operand1MultiplyFormat, setOperand1MultiplyFormat,
    action2, setAction2,
    operand2Type, setOperand2Type,
    operand2Value, setOperand2Value,
    operand2InputMode, setOperand2InputMode,
    operand2MultiplyFormat, setOperand2MultiplyFormat,
    action3, setAction3,
    operand3Type, setOperand3Type,
    operand3Value, setOperand3Value,
    operand3InputMode, setOperand3InputMode,
    operand3MultiplyFormat, setOperand3MultiplyFormat,
    action4, setAction4,
    operand4Type, setOperand4Type,
    operand4Value, setOperand4Value,
    operand4InputMode, setOperand4InputMode,
    operand4MultiplyFormat, setOperand4MultiplyFormat,
    action5, setAction5,
    operand5Type, setOperand5Type,
    operand5Value, setOperand5Value,
    operand5InputMode, setOperand5InputMode,
    operand5MultiplyFormat, setOperand5MultiplyFormat,
    showSecondAction, setShowSecondAction,
    showThirdAction, setShowThirdAction,
    showFourthAction, setShowFourthAction,
    showFifthAction, setShowFifthAction,
    stepName, setStepName,
    addMarkup,
    removeMarkup,
    editMarkup,
    moveMarkupUp,
    moveMarkupDown,
  };
};

export type StepBuilder = ReturnType<typeof useStepBuilderState>;
