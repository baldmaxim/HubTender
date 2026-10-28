import { type FC } from 'react';
import { Input, Select, Tag } from 'antd';
import { RESOLUTION_OPTIONS, SEVERITY_COLORS, SEVERITY_LABELS } from '../constants';
import type { FindingResolution, IAutopriceFinding } from '../types';
import styles from '../AutopriceReview.module.css';

interface IFindingsEditorProps {
  findings: IAutopriceFinding[];
  disabled: boolean;
  onChange: (next: IAutopriceFinding[]) => void;
}

export const FindingsEditor: FC<IFindingsEditorProps> = ({ findings, disabled, onChange }) => {
  if (findings.length === 0) return null;

  const patch = (index: number, p: Partial<IAutopriceFinding>) =>
    onChange(findings.map((f, i) => (i === index ? { ...f, ...p } : f)));

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Находки ({findings.length})</div>
      {findings.map((f, i) => (
        <div key={`${f.kind}-${i}`} className={styles.card}>
          <div className={styles.cardHead}>
            <Tag color={SEVERITY_COLORS[f.severity]}>{SEVERITY_LABELS[f.severity]}</Tag>
            <span className={styles.muted}>{f.kind}</span>
          </div>
          <div className={styles.cardText}>{f.text}</div>
          <div className={styles.cardControls}>
            <Select<FindingResolution>
              className={styles.resolutionSelect}
              placeholder="Решение"
              allowClear
              disabled={disabled}
              value={f.resolution ?? undefined}
              options={RESOLUTION_OPTIONS}
              onChange={(resolution) => patch(i, { resolution: resolution ?? null })}
            />
            <Input
              className={styles.input}
              placeholder="Примечание"
              allowClear
              disabled={disabled}
              value={f.resolution_note ?? ''}
              onChange={(e) => patch(i, { resolution_note: e.target.value })}
            />
          </div>
        </div>
      ))}
    </div>
  );
};
