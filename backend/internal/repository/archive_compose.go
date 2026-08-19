package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/su10/hubtender/backend/internal/calc"
)

// Compose собирает позиции и строки BOQ в целевом тендере из исторических
// позиций ЧУЖИХ тендеров — всё в одной транзакции.
//
// DryRun выполняет ТУ ЖЕ транзакцию и делает Rollback вместо Commit. Отдельного
// «симулятора» нет намеренно: CHECK-констрейнты срабатывают только на реальном
// INSERT, а RecomputeBoqTotalAmountsTx специально перечитывает записанные
// строки. Откат не оставляет ни аудита, ни ревизии, и не рассылает realtime
// (NOTIFY транзакционный).
func (r *ArchiveRepo) Compose(ctx context.Context, in ComposeInput) (*ComposeResult, error) {
	if err := validateComposeInput(in); err != nil {
		return nil, err
	}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("archiveRepo.Compose: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	res, err := composeTx(ctx, tx, in)
	if err != nil {
		return nil, err
	}

	if in.DryRun {
		// Явный откат: ничего не записано, id в ответе не отдаются.
		if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			return nil, fmt.Errorf("archiveRepo.Compose: rollback: %w", err)
		}
		return res, nil
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("archiveRepo.Compose: commit: %w", err)
	}
	return res, nil
}

// validateComposeInput — проверки, не требующие БД.
func validateComposeInput(in ComposeInput) error {
	if len(in.Groups) == 0 {
		return &ArchiveNothingToComposeError{}
	}
	if len(in.Groups) > MaxComposeGroups {
		return &ArchiveTargetSpecError{
			Reason: fmt.Sprintf("групп больше допустимых %d", MaxComposeGroups),
		}
	}

	seenTemp := make(map[string]bool, len(in.Groups))
	seenTarget := make(map[string]bool, len(in.Groups))
	for _, g := range in.Groups {
		if g.TempID == "" {
			return &ArchiveTargetSpecError{Reason: "temp_id обязателен"}
		}
		if seenTemp[g.TempID] {
			return &ArchiveDuplicateTargetError{GroupTempID: g.TempID}
		}
		seenTemp[g.TempID] = true

		hasExisting := g.TargetPositionID != nil && *g.TargetPositionID != ""
		hasNew := g.NewPosition != nil
		switch {
		case hasExisting && hasNew:
			return &ArchiveTargetSpecError{
				GroupTempID: g.TempID,
				Reason:      "заданы одновременно position_id и new_position",
			}
		case !hasExisting && !hasNew:
			return &ArchiveTargetSpecError{
				GroupTempID: g.TempID,
				Reason:      "нужен ровно один из position_id или new_position",
			}
		}
		if hasExisting {
			if seenTarget[*g.TargetPositionID] {
				return &ArchiveDuplicateTargetError{PositionID: *g.TargetPositionID}
			}
			seenTarget[*g.TargetPositionID] = true
		}
		if hasNew && g.NewPosition.WorkName == "" {
			return &ArchiveTargetSpecError{
				GroupTempID: g.TempID, Reason: "new_position.work_name обязателен",
			}
		}
		if len(g.Sources) == 0 {
			return &ArchiveTargetSpecError{GroupTempID: g.TempID, Reason: "нужен хотя бы один источник"}
		}
		if len(g.Sources) > MaxComposeSourcesInGroup {
			return &ArchiveTargetSpecError{
				GroupTempID: g.TempID,
				Reason:      fmt.Sprintf("источников больше допустимых %d", MaxComposeSourcesInGroup),
			}
		}
	}
	return nil
}

// composeTx — весь конвейер внутри уже открытой транзакции. Commit/Rollback за
// вызывающим: так dry_run и реальная запись идут ОДНИМ кодом.
func composeTx(ctx context.Context, tx pgx.Tx, in ComposeInput) (*ComposeResult, error) {
	// Большие батчи: statement_timeout снимаем, как в bulk-импорте.
	if _, err := tx.Exec(ctx, `SET LOCAL statement_timeout = '0'`); err != nil {
		return nil, fmt.Errorf("archiveRepo.Compose: statement_timeout: %w", err)
	}
	if err := setAuditUser(ctx, tx, in.ChangedBy); err != nil {
		return nil, fmt.Errorf("archiveRepo.Compose: %w", err)
	}
	// Аудит пишем сами, курируемыми записями — триггер должен молчать.
	if err := skipBoqAuditTrigger(ctx, tx); err != nil {
		return nil, fmt.Errorf("archiveRepo.Compose: %w", err)
	}

	// Одна ревизия на всю команду. Тендеры-источники не трогаем и не бампаем.
	revision, err := MarkTenderFinancialInputsChangedTx(ctx, tx, in.TargetTenderID, "archive_compose")
	if err != nil {
		return nil, fmt.Errorf("archiveRepo.Compose: %w", err)
	}

	plans, warnings, err := planCompose(ctx, tx, in)
	if err != nil {
		return nil, err
	}

	totalItems := 0
	for _, p := range plans {
		totalItems += len(p.Items)
	}
	if totalItems == 0 {
		return nil, &ArchiveNothingToComposeError{}
	}

	res := &ComposeResult{
		DryRun:                 in.DryRun,
		TargetTenderID:         in.TargetTenderID,
		FinancialInputRevision: revision,
		Groups:                 make([]ComposeGroupResult, 0, len(plans)),
		Warnings:               warnings,
	}

	allNewIDs := make([]string, 0, totalItems)
	for i := range plans {
		gr, ids, err := writeComposeGroup(ctx, tx, in, &plans[i])
		if err != nil {
			return nil, err
		}
		allNewIDs = append(allNewIDs, ids...)
		res.Groups = append(res.Groups, *gr)

		res.Totals.ItemsCreated += gr.ItemsCreated
		res.Totals.PositionsTargeted++
		if gr.PositionCreated {
			res.Totals.PositionsCreated++
		}
		for _, it := range plans[i].Items {
			if calc.IsWorkBoqType(it.src.BoqItemType) {
				res.Totals.WorksCount++
			} else {
				res.Totals.MaterialsCount++
			}
			if it.ParentIdx >= 0 {
				res.Totals.ParentLinksRestored++
			}
		}
	}

	// AUTHORITATIVE total_amount: считается по курсам ЦЕЛЕВОГО тендера из уже
	// записанных строк. Нет нужного курса → MissingFXRateError и полный откат.
	amounts, err := RecomputeBoqTotalAmountsTx(ctx, tx, in.TargetTenderID, allNewIDs)
	if err != nil {
		return nil, fmt.Errorf("archiveRepo.Compose: %w", err)
	}
	if err := RecomputePositionTotalsForTenderTx(ctx, tx, in.TargetTenderID); err != nil {
		return nil, fmt.Errorf("archiveRepo.Compose: %w", err)
	}
	if err := MaterializeCommercialForTenderTx(ctx, tx, in.TargetTenderID); err != nil {
		return nil, fmt.Errorf("archiveRepo.Compose: %w", err)
	}
	grand, err := RecalculateTenderGrandTotalTx(ctx, tx, in.TargetTenderID)
	if err != nil {
		return nil, fmt.Errorf("archiveRepo.Compose: grand total: %w", err)
	}
	if err := MarkTenderCalculationSucceededTx(ctx, tx, in.TargetTenderID, revision); err != nil {
		return nil, fmt.Errorf("archiveRepo.Compose: %w", err)
	}
	if grand != nil {
		res.CachedGrandTotal = grand.RoundedTotalDecimal
	}

	if err := fillComposeTotals(ctx, tx, res, plans, amounts, in); err != nil {
		return nil, err
	}
	return res, nil
}

// planCompose — read-only фаза: читаем источники, проверяем цели, считаем
// коэффициенты и количества. До этого момента в БД ничего не пишется.
func planCompose(ctx context.Context, tx pgx.Tx, in ComposeInput) ([]plannedGroup, []ComposeWarning, error) {
	opt := in.Options
	plans := make([]plannedGroup, 0, len(in.Groups))
	var warnings []ComposeWarning

	for _, g := range in.Groups {
		p := plannedGroup{TempID: g.TempID}

		var targetVolume *float64
		if g.TargetPositionID != nil && *g.TargetPositionID != "" {
			if err := lockTargetPositionTx(ctx, tx, *g.TargetPositionID, in.TargetTenderID); err != nil {
				return nil, nil, err
			}
			scope, err := loadPositionScopeTx(ctx, tx, *g.TargetPositionID)
			if err != nil {
				return nil, nil, err
			}
			p.TargetPositionID = *g.TargetPositionID
			targetVolume = scope.EffectiveVolume()
		} else {
			p.Create = true
			p.NewPosition = g.NewPosition
			if g.NewPosition.ManualVolume != nil {
				targetVolume = g.NewPosition.ManualVolume
			} else {
				targetVolume = g.NewPosition.Volume
			}
		}

		for _, s := range g.Sources {
			scope, err := loadPositionScopeTx(ctx, tx, s.SourcePositionID)
			if err != nil {
				var notFound *ArchiveSourceNotFoundError
				if errors.As(err, &notFound) && opt.OnMissingSource == OnMissingSourceSkip {
					warnings = append(warnings, ComposeWarning{
						Code: WarnSourcePositionSkipped, GroupTempID: g.TempID,
						SourcePositionID: s.SourcePositionID,
					})
					p.Sources = append(p.Sources, ComposeSourceStat{
						SourcePositionID: s.SourcePositionID, ScaleMode: ScaleModeNone,
						ScaleFactor: 1, Skipped: true,
					})
					continue
				}
				return nil, nil, err
			}

			k, mode, err := resolveScaleFactor(s.Scale, scope.EffectiveVolume(), targetVolume, g.TempID)
			if err != nil {
				return nil, nil, err
			}

			srcRows, err := loadArchiveSourceItemsTx(ctx, tx, s.SourcePositionID, s.SourceItemIDs)
			if err != nil {
				return nil, nil, err
			}
			if len(srcRows) == 0 {
				p.Sources = append(p.Sources, ComposeSourceStat{
					SourcePositionID: s.SourcePositionID, SourceTenderID: scope.TenderID,
					ScaleMode: mode, ScaleFactor: k,
				})
				continue
			}

			block, err := planSourceBlock(srcRows, len(p.Items))
			if err != nil {
				return nil, nil, err
			}
			blockWarnings, err := scaleBlock(&p, block, k, opt, g.TempID)
			if err != nil {
				return nil, nil, err
			}
			warnings = append(warnings, blockWarnings...)

			p.Items = append(p.Items, block...)
			p.Sources = append(p.Sources, ComposeSourceStat{
				SourcePositionID: s.SourcePositionID, SourceTenderID: scope.TenderID,
				ScaleMode: mode, ScaleFactor: k, ItemsCopied: len(block),
			})
		}

		plans = append(plans, p)
	}
	return plans, warnings, nil
}

// writeComposeGroup создаёт позицию (если нужно), вставляет строки, чинит
// связи материал → работа и пишет аудит.
func writeComposeGroup(
	ctx context.Context, tx pgx.Tx, in ComposeInput, p *plannedGroup,
) (*ComposeGroupResult, []string, error) {
	gr := &ComposeGroupResult{TempID: p.TempID, Sources: p.Sources}

	// Пустая группа (все источники пропущены либо без строк): позицию не
	// создаём — иначе в тендере молча заводится пустышка.
	if len(p.Items) == 0 {
		if !p.Create {
			gr.TargetPositionID = p.TargetPositionID
		}
		return gr, nil, nil
	}

	if p.Create {
		number := 0.0
		if p.NewPosition.PositionNumber != nil {
			number = *p.NewPosition.PositionNumber
		} else {
			auto, err := nextPositionNumberTx(ctx, tx, in.TargetTenderID)
			if err != nil {
				return nil, nil, fmt.Errorf("archiveRepo.Compose: %w", err)
			}
			number = auto
		}
		id, err := insertArchivePositionTx(ctx, tx, in.TargetTenderID, *p.NewPosition, number)
		if err != nil {
			return nil, nil, fmt.Errorf("archiveRepo.Compose: %w", err)
		}
		p.TargetPositionID = id
		gr.PositionCreated = true
		gr.PositionNumber = &number
	}
	// Для СУЩЕСТВУЮЩЕЙ позиции id настоящий и в dry_run. Мёртвым он бывает
	// только у позиции, которая создаётся и тут же откатывается.
	if !p.Create || !in.DryRun {
		gr.TargetPositionID = p.TargetPositionID
	}

	startSort, err := maxSortNumberTx(ctx, tx, p.TargetPositionID)
	if err != nil {
		return nil, nil, fmt.Errorf("archiveRepo.Compose: %w", err)
	}
	newIDs, err := insertArchiveItemsTx(
		ctx, tx, in.TargetTenderID, p.TargetPositionID, startSort, p.Items, in.Options,
	)
	if err != nil {
		return nil, nil, fmt.Errorf("archiveRepo.Compose: %w", err)
	}

	parentIdx := make([]int, len(p.Items))
	for i, it := range p.Items {
		parentIdx[i] = it.ParentIdx
	}
	if _, err := remapArchiveParentsTx(ctx, tx, newIDs, parentIdx); err != nil {
		return nil, nil, fmt.Errorf("archiveRepo.Compose: %w", err)
	}
	if err := auditArchiveItemsTx(
		ctx, tx, in.TargetTenderID, p.TargetPositionID, in.ChangedBy, newIDs, p.Items,
	); err != nil {
		return nil, nil, fmt.Errorf("archiveRepo.Compose: %w", err)
	}

	p.NewIDs = newIDs
	gr.ItemsCreated = len(newIDs)
	if in.Verbose {
		gr.Items = buildComposeItems(p.Items, newIDs, in.DryRun)
	}
	return gr, newIDs, nil
}

func buildComposeItems(items []plannedItem, newIDs []string, dryRun bool) []ComposeItemResult {
	out := make([]ComposeItemResult, len(items))
	for i, it := range items {
		r := ComposeItemResult{
			Index:          i,
			SourceItemID:   it.SourceItemID,
			SourceTenderID: it.SourceTender,
			BoqItemType:    it.src.BoqItemType,
			Quantity:       it.Quantity,
			UnitRate:       it.src.UnitRate,
			CurrencyType:   it.src.CurrencyType,
		}
		// В dry_run сгенерированные uuid мертвы — их не отдаём, чтобы клиент не
		// закэшировал id, которых никогда не будет.
		if !dryRun {
			r.NewItemID = newIDs[i]
		}
		if it.ParentIdx >= 0 {
			p := it.ParentIdx
			r.ParentIndex = &p
		}
		out[i] = r
	}
	return out
}

// fillComposeTotals дочитывает итоги позиций и (для verbose) total_amount строк
// уже ПОСЛЕ авторитетного пересчёта.
func fillComposeTotals(
	ctx context.Context, tx pgx.Tx, res *ComposeResult,
	plans []plannedGroup, amounts map[string]float64, in ComposeInput,
) error {
	for i := range res.Groups {
		gr := &res.Groups[i]
		posID := plans[i].TargetPositionID
		if posID == "" {
			continue
		}
		var mat, wrk *float64
		if err := tx.QueryRow(ctx, `
			SELECT total_material, total_works FROM public.client_positions WHERE id = $1
		`, posID).Scan(&mat, &wrk); err != nil {
			return fmt.Errorf("archiveRepo.Compose: totals: %w", err)
		}
		gr.TotalMaterial, gr.TotalWorks = mat, wrk

		if !in.Verbose {
			continue
		}
		// Берём id из плана, а не из ответа: в dry_run они наружу не уходят,
		// но total_amount по ним показать нужно — ради этого dry_run и делают.
		for j := range gr.Items {
			if j >= len(plans[i].NewIDs) {
				break
			}
			if v, ok := amounts[plans[i].NewIDs[j]]; ok {
				amount := v
				gr.Items[j].TotalAmount = &amount
			}
		}
	}
	return nil
}
