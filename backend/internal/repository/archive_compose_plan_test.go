package repository

import (
	"errors"
	"math"
	"testing"
)

func archFloat(v float64) *float64 { return &v }
func archStr(v string) *string     { return &v }

func work(id string, qty float64) archiveSrcRow {
	return archiveSrcRow{
		ID: id, TenderID: "t-src", BoqItemType: "раб",
		WorkNameID: archStr("wn-" + id), Quantity: archFloat(qty),
	}
}

func material(id string, qty float64, parent *string, conv, cons *float64) archiveSrcRow {
	return archiveSrcRow{
		ID: id, TenderID: "t-src", BoqItemType: "мат",
		MaterialNameID: archStr("mn-" + id), Quantity: archFloat(qty),
		ParentWorkItemID: parent, ConversionCoefficient: conv, ConsumptionCoefficient: cons,
	}
}

func planBlock(t *testing.T, src []archiveSrcRow, offset int) []plannedItem {
	t.Helper()
	block, err := planSourceBlock(src, offset)
	if err != nil {
		t.Fatalf("planSourceBlock: %v", err)
	}
	return block
}

func TestResolveScaleFactorModes(t *testing.T) {
	k, mode, err := resolveScaleFactor(nil, archFloat(10), archFloat(20), "g1")
	if err != nil || k != 1 || mode != ScaleModeNone {
		t.Fatalf("без spec ожидали k=1/none, получили k=%v mode=%q err=%v", k, mode, err)
	}

	k, mode, err = resolveScaleFactor(&ScaleSpec{Mode: ScaleModeFactor, Factor: archFloat(2.5)}, nil, nil, "g1")
	if err != nil || k != 2.5 || mode != ScaleModeFactor {
		t.Fatalf("factor: k=%v mode=%q err=%v", k, mode, err)
	}

	k, mode, err = resolveScaleFactor(&ScaleSpec{Mode: ScaleModeVolumeRatio}, archFloat(80), archFloat(120), "g1")
	if err != nil || mode != ScaleModeVolumeRatio || math.Abs(k-1.5) > 1e-12 {
		t.Fatalf("volume_ratio: k=%v mode=%q err=%v", k, mode, err)
	}

	// Явные объёмы в spec перекрывают объёмы позиций.
	k, _, err = resolveScaleFactor(
		&ScaleSpec{Mode: ScaleModeVolumeRatio, SourceVolume: archFloat(10), TargetVolume: archFloat(30)},
		archFloat(80), archFloat(120), "g1",
	)
	if err != nil || math.Abs(k-3) > 1e-12 {
		t.Fatalf("явные объёмы: k=%v err=%v", k, err)
	}
}

func TestResolveScaleFactorErrors(t *testing.T) {
	var scaleErr *ArchiveScaleError

	_, _, err := resolveScaleFactor(&ScaleSpec{Mode: ScaleModeVolumeRatio}, nil, archFloat(120), "g1")
	if !errors.As(err, &scaleErr) || scaleErr.Code() != "ARCHIVE_SCALE_UNDEFINED" {
		t.Fatalf("объём источника не задан → ARCHIVE_SCALE_UNDEFINED, получили %v", err)
	}

	_, _, err = resolveScaleFactor(&ScaleSpec{Mode: ScaleModeVolumeRatio}, archFloat(80), archFloat(0), "g1")
	if !errors.As(err, &scaleErr) || scaleErr.Code() != "ARCHIVE_SCALE_UNDEFINED" {
		t.Fatalf("нулевой объём цели → ARCHIVE_SCALE_UNDEFINED, получили %v", err)
	}

	_, _, err = resolveScaleFactor(&ScaleSpec{Mode: ScaleModeFactor, Factor: archFloat(0)}, nil, nil, "g1")
	if !errors.As(err, &scaleErr) || scaleErr.Code() != "ARCHIVE_SCALE_INVALID" {
		t.Fatalf("нулевой factor → ARCHIVE_SCALE_INVALID, получили %v", err)
	}

	_, _, err = resolveScaleFactor(&ScaleSpec{Mode: ScaleModeFactor}, nil, nil, "g1")
	if !errors.As(err, &scaleErr) {
		t.Fatalf("factor без значения → ошибка, получили %v", err)
	}

	_, _, err = resolveScaleFactor(&ScaleSpec{Mode: "нечто"}, nil, nil, "g1")
	if !errors.As(err, &scaleErr) {
		t.Fatalf("неизвестный режим → ошибка, получили %v", err)
	}
}

func TestScaleBlockWorkAndStandaloneMaterial(t *testing.T) {
	src := []archiveSrcRow{
		work("w1", 10),
		material("m1", 4, nil, nil, nil),
	}
	block := planBlock(t, src, 0)
	group := &plannedGroup{TempID: "g1"}

	warns, err := scaleBlock(group, block, 1.5, ComposeOptions{}, "g1")
	if err != nil {
		t.Fatalf("scaleBlock: %v", err)
	}
	if len(warns) != 0 {
		t.Fatalf("предупреждений быть не должно, получили %v", warns)
	}
	if *block[0].Quantity != 15 {
		t.Fatalf("работа: 10*1.5 = 15, получили %v", *block[0].Quantity)
	}
	if *block[1].Quantity != 6 {
		t.Fatalf("самостоятельный материал: 4*1.5 = 6, получили %v", *block[1].Quantity)
	}
}

func TestScaleBlockLinkedMaterialIsRederived(t *testing.T) {
	// Источник согласован: qty ребёнка = qty родителя * conv * cons = 10*2*0.5 = 10.
	src := []archiveSrcRow{
		work("w1", 10),
		material("m1", 10, archStr("w1"), archFloat(2), archFloat(0.5)),
	}
	block := planBlock(t, src, 0)
	group := &plannedGroup{TempID: "g1"}

	warns, err := scaleBlock(group, block, 3, ComposeOptions{}, "g1")
	if err != nil {
		t.Fatalf("scaleBlock: %v", err)
	}
	if len(warns) != 0 {
		t.Fatalf("согласованный источник не должен давать предупреждений: %v", warns)
	}
	if *block[0].Quantity != 30 {
		t.Fatalf("родитель: 10*3 = 30, получили %v", *block[0].Quantity)
	}
	// Пере-вывод из МАСШТАБИРОВАННОГО родителя: 30*2*0.5 = 30.
	if *block[1].Quantity != 30 {
		t.Fatalf("привязанный материал: 30*2*0.5 = 30, получили %v", *block[1].Quantity)
	}
	if block[1].BaseQuantity != nil {
		t.Fatal("у привязанного материала base_quantity должен быть NULL")
	}
	if block[1].ParentIdx != 0 {
		t.Fatalf("индекс родителя = 0, получили %d", block[1].ParentIdx)
	}
}

func TestScaleBlockWarnsOnDriftedSource(t *testing.T) {
	// Источник рассогласован: хранимое 99 вместо 10*2*0.5 = 10.
	src := []archiveSrcRow{
		work("w1", 10),
		material("m1", 99, archStr("w1"), archFloat(2), archFloat(0.5)),
	}
	block := planBlock(t, src, 0)
	group := &plannedGroup{TempID: "g1"}

	warns, err := scaleBlock(group, block, 1, ComposeOptions{}, "g1")
	if err != nil {
		t.Fatalf("scaleBlock: %v", err)
	}
	if len(warns) != 1 || warns[0].Code != WarnLinkedQuantityRederived {
		t.Fatalf("ожидали одно %s, получили %v", WarnLinkedQuantityRederived, warns)
	}
	if warns[0].SourceItemID != "m1" {
		t.Fatalf("предупреждение должно указывать на m1, получили %q", warns[0].SourceItemID)
	}
	if *block[1].Quantity != 10 {
		t.Fatalf("пере-выведенное количество = 10, получили %v", *block[1].Quantity)
	}
}

func TestScaleBlockLinkedMaterialCoefficientsDefaultToOne(t *testing.T) {
	src := []archiveSrcRow{
		work("w1", 7),
		material("m1", 7, archStr("w1"), nil, nil),
	}
	block := planBlock(t, src, 0)
	group := &plannedGroup{TempID: "g1"}

	if _, err := scaleBlock(group, block, 2, ComposeOptions{}, "g1"); err != nil {
		t.Fatalf("scaleBlock: %v", err)
	}
	if *block[1].Quantity != 14 {
		t.Fatalf("без коэффициентов количество равно родительскому: 14, получили %v", *block[1].Quantity)
	}
}

func TestScaleBlockUnderflowIsBlocking(t *testing.T) {
	src := []archiveSrcRow{work("w1", 0.4)}
	block := planBlock(t, src, 0)
	group := &plannedGroup{TempID: "g1"}

	decimals := 0
	_, err := scaleBlock(group, block, 1, ComposeOptions{QuantityDecimals: &decimals}, "g1")

	var underflow *ArchiveQuantityUnderflowError
	if !errors.As(err, &underflow) {
		t.Fatalf("округление до нуля должно блокировать команду, получили %v", err)
	}
	if underflow.SourceItemID != "w1" {
		t.Fatalf("ошибка должна указывать на w1, получили %q", underflow.SourceItemID)
	}
}

func TestScaleBlockRoundsWhenAsked(t *testing.T) {
	src := []archiveSrcRow{work("w1", 10)}
	block := planBlock(t, src, 0)
	group := &plannedGroup{TempID: "g1"}

	decimals := 2
	if _, err := scaleBlock(group, block, 1.0/3.0, ComposeOptions{QuantityDecimals: &decimals}, "g1"); err != nil {
		t.Fatalf("scaleBlock: %v", err)
	}
	if *block[0].Quantity != 3.33 {
		t.Fatalf("округление до 2 знаков даёт 3.33, получили %v", *block[0].Quantity)
	}
}

func TestPlanSourceBlockOffsetsParentIndex(t *testing.T) {
	src := []archiveSrcRow{
		work("w1", 10),
		material("m1", 10, archStr("w1"), nil, nil),
	}
	block := planBlock(t, src, 5)
	if block[0].ParentIdx != -1 {
		t.Fatalf("работа самостоятельна, получили %d", block[0].ParentIdx)
	}
	if block[1].ParentIdx != 5 {
		t.Fatalf("индекс родителя должен сместиться на 5, получили %d", block[1].ParentIdx)
	}
}

func TestPlanSourceBlockRejectsUncopiedParent(t *testing.T) {
	// Родительская работа исключена подмножеством source_item_ids.
	src := []archiveSrcRow{material("m1", 10, archStr("w-отсутствует"), nil, nil)}

	_, err := planSourceBlock(src, 0)
	var parentErr *InvalidBoqParentError
	if !errors.As(err, &parentErr) {
		t.Fatalf("родитель вне копируемого набора → InvalidBoqParentError, получили %v", err)
	}
}

func TestScaleBlockResolvesParentFromEarlierSource(t *testing.T) {
	// Родитель уже лежит в группе (пришёл из предыдущего источника).
	first := planBlock(t, []archiveSrcRow{work("w1", 10)}, 0)
	group := &plannedGroup{TempID: "g1"}
	if _, err := scaleBlock(group, first, 2, ComposeOptions{}, "g1"); err != nil {
		t.Fatalf("scaleBlock первый блок: %v", err)
	}
	group.Items = append(group.Items, first...)

	second := planBlock(t, []archiveSrcRow{
		work("w2", 5),
		material("m2", 5, archStr("w2"), nil, nil),
	}, len(group.Items))
	if _, err := scaleBlock(group, second, 2, ComposeOptions{}, "g1"); err != nil {
		t.Fatalf("scaleBlock второй блок: %v", err)
	}
	if second[1].ParentIdx != 1 {
		t.Fatalf("родитель второго блока имеет индекс 1 в группе, получили %d", second[1].ParentIdx)
	}
	if *second[1].Quantity != 10 {
		t.Fatalf("материал следует за родителем: 10, получили %v", *second[1].Quantity)
	}
	if got := resolvePlannedParent(group, second, 0); got == nil || got.SourceItemID != "w1" {
		t.Fatal("родитель из ранее накопленных строк группы должен находиться")
	}
}

func TestRoundQuantity(t *testing.T) {
	if got := roundQuantity(1.23456, nil); got != 1.23456 {
		t.Fatalf("без decimals значение не меняется, получили %v", got)
	}
	d := 3
	if got := roundQuantity(1.23456, &d); got != 1.235 {
		t.Fatalf("округление до 3 знаков, получили %v", got)
	}
}
