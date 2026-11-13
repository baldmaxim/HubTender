import React from 'react';
import { Alert, Col, Form, InputNumber, Row, Segmented, Select, Spin, Tag, Typography } from 'antd';
import type { FormInstance } from 'antd';
import type { MarkupParameter, MarkupTactic } from '../../../lib/types';
import {
  NEW_PERCENT_KEYS,
  PERCENT_SET_LABELS,
  type PercentSet,
} from '../../../services/markupTactic/percentSets';
import { parseNumberInput, formatNumberInput } from '../../../utils/numberFormat';
import { useIsMobile } from '../../../hooks/useIsMobile';
import styles from './MarkupPercentages.module.css';

const { Text } = Typography;

const SET_OPTIONS = (['old', 'new'] as const).map((value) => ({
  value,
  label: PERCENT_SET_LABELS[value],
}));

const SET_ADJECTIVE: Record<PercentSet, string> = { old: 'старым', new: 'новым' };
const SET_NOUN: Record<PercentSet, string> = { old: 'старые', new: 'новые' };

interface IPercentagesTabProps {
  form: FormInstance;
  loading: boolean;
  /** Все активные параметры (для initialValues). */
  allParams: MarkupParameter[];
  /** Параметры выбранного списка. */
  setParams: MarkupParameter[];
  percentSet: PercentSet;
  onPercentSetChange: (set: PercentSet) => void;
  /** Тактики выбранного списка. */
  setTactics: MarkupTactic[];
  selectedTacticId: string | null;
  onTacticChange: (tacticId: string) => void;
  tenderId: string | null;
  /** Список текущей сохранённой тактики тендера (null — не задана). */
  savedSet: PercentSet | null;
  selectedTacticName: string | null;
}

/** Содержимое вкладки «Базовые проценты»: переключатель списка, порядок расчёта, поля. */
export const PercentagesTab: React.FC<IPercentagesTabProps> = ({
  form,
  loading,
  allParams,
  setParams,
  percentSet,
  onPercentSetChange,
  setTactics,
  selectedTacticId,
  onTacticChange,
  tenderId,
  savedSet,
  selectedTacticName,
}) => {
  const { isPhone } = useIsMobile();

  const initialValues = allParams.reduce<Record<string, number | string | null>>(
    (acc, param) => ({ ...acc, [param.key]: param.default_value || 0 }),
    { tender_id: tenderId },
  );

  const showSwitchWarning = savedSet !== null && savedSet !== percentSet;
  const noTactics = setTactics.length === 0;

  const renderTacticLabel = (label: React.ReactNode, tacticId: unknown) => {
    const tactic = setTactics.find((t) => t.id === tacticId);
    return (
      <span>
        {label}
        {tactic?.is_global && (
          <Tag color="green" style={{ marginLeft: 8, fontSize: 11 }}>
            Глобальная
          </Tag>
        )}
      </span>
    );
  };

  return (
    <Spin spinning={loading}>
      {allParams.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <Text type="danger">Параметры наценок не найдены. Проверьте базу данных.</Text>
        </div>
      ) : (
        <Form
          form={form}
          layout={isPhone ? 'vertical' : 'horizontal'}
          labelCol={isPhone ? undefined : { style: { width: '250px', textAlign: 'left' } }}
          wrapperCol={isPhone ? undefined : { style: { flex: 1 } }}
          initialValues={initialValues}
        >
          <Segmented
            className={styles.setSwitch}
            block={isPhone}
            value={percentSet}
            options={SET_OPTIONS}
            onChange={(value) => onPercentSetChange(value as PercentSet)}
          />

          {showSwitchWarning && savedSet && (
            <Alert
              className={styles.alert}
              type="warning"
              showIcon
              message={`Сейчас тендер считается по ${SET_ADJECTIVE[savedSet]} базовым процентам. После «Сохранить» расчёт перейдёт на ${SET_NOUN[percentSet]} проценты и порядок расчёта «${selectedTacticName ?? '—'}».`}
            />
          )}

          {percentSet === 'new' && noTactics && (
            <Alert
              className={styles.alert}
              type="error"
              showIcon
              message="Нет порядка расчёта для новых процентов — создайте его в Конструкторе наценок"
            />
          )}

          <div style={{ marginBottom: '24px' }}>
            <Form.Item label="Порядок расчета" style={{ marginBottom: 0 }}>
              <Select
                className={styles.tacticSelect}
                placeholder="Выберите порядок расчета"
                value={selectedTacticId}
                onChange={onTacticChange}
                showSearch
                optionFilterProp="label"
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
                optionRender={(option) => renderTacticLabel(option.label, option.value)}
                labelRender={(props) => renderTacticLabel(props.label, props.value)}
                options={setTactics.map((tactic) => ({
                  label: tactic.name || 'Без названия',
                  value: tactic.id,
                }))}
              />
            </Form.Item>
          </div>

          <Row gutter={[16, 0]}>
            {setParams.map((param, index) => (
              <Col span={24} key={param.id}>
                <Form.Item
                  label={`${index + 1}. ${param.label}`}
                  name={param.key}
                  style={{ marginBottom: '4px' }}
                >
                  <InputNumber
                    min={param.key === NEW_PERCENT_KEYS.profitDiscount ? -100 : 0}
                    max={999.99999}
                    step={0.00001}
                    addonAfter="%"
                    style={{ width: '120px' }}
                    precision={5}
                    parser={parseNumberInput}
                    formatter={formatNumberInput}
                  />
                </Form.Item>
              </Col>
            ))}
          </Row>
        </Form>
      )}
    </Spin>
  );
};
