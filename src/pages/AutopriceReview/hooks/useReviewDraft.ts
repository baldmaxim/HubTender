import { useEffect, useMemo, useState } from 'react';
import type { IAutopriceFinding, IAutopriceQuestion, IPositionDetail, IReviewPatch } from '../types';

interface IDraft {
  comment: string;
  questions: IAutopriceQuestion[];
  findings: IAutopriceFinding[];
}

const fromDetail = (d: IPositionDetail | null): IDraft => ({
  comment: d?.review.engineer_comment ?? '',
  questions: d?.review.questions ?? [],
  findings: d?.review.findings ?? [],
});

/** Локальный черновик правок инженера; сбрасывается при каждой перезагрузке карточки. */
export const useReviewDraft = (detail: IPositionDetail | null) => {
  const [draft, setDraft] = useState<IDraft>(() => fromDetail(detail));
  useEffect(() => setDraft(fromDetail(detail)), [detail]);

  const dirty = useMemo(() => {
    const base = fromDetail(detail);
    return (
      base.comment !== draft.comment ||
      JSON.stringify(base.questions) !== JSON.stringify(draft.questions) ||
      JSON.stringify(base.findings) !== JSON.stringify(draft.findings)
    );
  }, [detail, draft]);

  const toPatch = (): IReviewPatch => ({
    engineer_comment: draft.comment,
    questions: draft.questions,
    findings: draft.findings,
  });

  return {
    draft,
    dirty,
    toPatch,
    setComment: (comment: string) => setDraft((d) => ({ ...d, comment })),
    setQuestions: (questions: IAutopriceQuestion[]) => setDraft((d) => ({ ...d, questions })),
    setFindings: (findings: IAutopriceFinding[]) => setDraft((d) => ({ ...d, findings })),
  };
};
