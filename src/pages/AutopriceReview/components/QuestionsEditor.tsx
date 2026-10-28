import { type FC } from 'react';
import { Checkbox, Input } from 'antd';
import type { IAutopriceQuestion } from '../types';
import styles from '../AutopriceReview.module.css';

interface IQuestionsEditorProps {
  questions: IAutopriceQuestion[];
  disabled: boolean;
  onChange: (next: IAutopriceQuestion[]) => void;
}

export const QuestionsEditor: FC<IQuestionsEditorProps> = ({ questions, disabled, onChange }) => {
  if (questions.length === 0) return null;

  const patch = (index: number, p: Partial<IAutopriceQuestion>) =>
    onChange(questions.map((q, i) => (i === index ? { ...q, ...p } : q)));

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Вопросы ({questions.length})</div>
      {questions.map((q, i) => (
        <div key={`${i}-${q.text}`} className={styles.card}>
          <div className={styles.cardText}>{q.text}</div>
          <Input.TextArea
            className={styles.input}
            placeholder="Ответ"
            autoSize={{ minRows: 2, maxRows: 6 }}
            allowClear
            disabled={disabled}
            value={q.answer ?? ''}
            onChange={(e) => patch(i, { answer: e.target.value })}
          />
          <Checkbox
            className={styles.checkbox}
            disabled={disabled}
            checked={!!q.sent_to_customer}
            onChange={(e) => patch(i, { sent_to_customer: e.target.checked })}
          >
            Отправлено Заказчику
          </Checkbox>
        </div>
      ))}
    </div>
  );
};
