package repository

import (
	"encoding/json"
	"testing"
)

// §18.8-10: три состояния tri-state декодируются различимо.
func TestOptionalNullableDecode(t *testing.T) {
	type payload struct {
		Parent OptionalNullable[string]  `json:"parent_work_item_id"`
		BaseQ  OptionalNullable[float64] `json:"base_quantity"`
	}

	// 1. Поле отсутствует → Present=false (не менять).
	var absent payload
	if err := json.Unmarshal([]byte(`{}`), &absent); err != nil {
		t.Fatal(err)
	}
	if absent.Parent.Present || absent.BaseQ.Present {
		t.Fatalf("absent must not be present: %+v", absent)
	}

	// 2. Явный null → Present=true, Value=nil (записать SQL NULL).
	var null payload
	if err := json.Unmarshal([]byte(`{"parent_work_item_id":null,"base_quantity":null}`), &null); err != nil {
		t.Fatal(err)
	}
	if !null.Parent.Present || null.Parent.Value != nil {
		t.Fatalf("explicit null must be present+nil: %+v", null.Parent)
	}
	if !null.BaseQ.Present || null.BaseQ.Value != nil {
		t.Fatalf("explicit null must be present+nil: %+v", null.BaseQ)
	}

	// 3. Значение → Present=true, Value=&v.
	var val payload
	if err := json.Unmarshal([]byte(`{"parent_work_item_id":"a-b","base_quantity":2.5}`), &val); err != nil {
		t.Fatal(err)
	}
	if !val.Parent.Present || val.Parent.Value == nil || *val.Parent.Value != "a-b" {
		t.Fatalf("value state broken: %+v", val.Parent)
	}
	if !val.BaseQ.Present || val.BaseQ.Value == nil || *val.BaseQ.Value != 2.5 {
		t.Fatalf("value state broken: %+v", val.BaseQ)
	}

	// arg(): типизированные пары для статического SET.
	if p, v := absent.Parent.arg(); p || v != nil {
		t.Fatal("absent arg must be (false, nil)")
	}
	if p, v := null.Parent.arg(); !p || v != nil {
		t.Fatal("null arg must be (true, nil)")
	}
	if p, v := val.BaseQ.arg(); !p || v.(float64) != 2.5 {
		t.Fatal("value arg must be (true, 2.5)")
	}
}

// §18.12 (логика): очистка финансового поля — финансовое изменение; чистый
// metadata-patch — нет; явный null tri-state не выглядит как metadata-only.
func TestIsQuoteMetadataOnlyPatchTriState(t *testing.T) {
	link := "https://s.kz/kp.pdf"
	metaOnly := BoqItemPatch{QuoteLink: &link}
	if !isQuoteMetadataOnlyPatch(&metaOnly) {
		t.Fatal("quote_link-only must be metadata-only")
	}

	parentClear := BoqItemPatch{QuoteLink: &link}
	parentClear.ParentWorkItemID.SetNull()
	if isQuoteMetadataOnlyPatch(&parentClear) {
		t.Fatal("parent clear must be financial even with metadata fields")
	}

	baseClear := BoqItemPatch{}
	baseClear.BaseQuantity.SetNull()
	if isQuoteMetadataOnlyPatch(&baseClear) {
		t.Fatal("base_quantity clear must be financial")
	}

	catSet := BoqItemPatch{}
	catSet.DetailCostCategoryID.SetValue("00000000-0000-0000-0000-000000000001")
	if isQuoteMetadataOnlyPatch(&catSet) {
		t.Fatal("category set must be financial")
	}
}
