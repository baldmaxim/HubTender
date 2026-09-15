package repository

import (
	"context"
	"fmt"
	"time"
)

// PruneVerificationRuns удаляет прогоны проверки старше olderThan.
//
// Последняя отметка «Проверка завершена» каждого тендера не удаляется никогда:
// от неё считается «новое с прошлой проверки». Находки и их история остаются —
// ссылки на удалённый прогон обнуляются внешними ключами (ON DELETE SET NULL),
// а даты first_seen_at/last_seen_at живут в самой находке.
func (r *QualityRepo) PruneVerificationRuns(ctx context.Context, olderThan time.Duration) (int64, error) {
	tag, err := r.pool.Exec(ctx, `
		DELETE FROM public.verification_runs vr
		WHERE vr.started_at < now() - make_interval(secs => $1)
		  AND NOT EXISTS (
		      SELECT 1
		      FROM (
		          SELECT DISTINCT ON (c.tender_id) c.id
		          FROM public.verification_runs c
		          WHERE c.tender_id = vr.tender_id AND c.trigger_source = 'checkpoint'
		          ORDER BY c.tender_id, c.started_at DESC
		      ) last_cp
		      WHERE last_cp.id = vr.id
		  )`, olderThan.Seconds())
	if err != nil {
		return 0, fmt.Errorf("qualityRepo.PruneVerificationRuns: %w", err)
	}
	return tag.RowsAffected(), nil
}
