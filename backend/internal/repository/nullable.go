package repository

import (
	"bytes"
	"encoding/json"
)

// Этап 2.4 (§6): tri-state значение для PATCH.
//
// Старая ошибка: `*T` в DTO не различает «поле отсутствует» и «поле = null» —
// оба дают nil, и явную очистку (frontend шлёт null) backend молча игнорировал.
//
// Три состояния:
//  1. Present=false            — поля не было в JSON: значение НЕ менять;
//  2. Present=true, Value=nil  — явный null: записать SQL NULL;
//  3. Present=true, Value=&v   — записать значение v.
type OptionalNullable[T any] struct {
	Present bool
	Value   *T
}

// UnmarshalJSON вызывается encoding/json ТОЛЬКО когда поле присутствует в
// payload — самого вызова достаточно для Present=true; null оставляет
// Value=nil (состояние 2).
func (o *OptionalNullable[T]) UnmarshalJSON(data []byte) error {
	o.Present = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		o.Value = nil
		return nil
	}
	var v T
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	o.Value = &v
	return nil
}

// MarshalJSON — симметрия для логов/тестов: absent сериализуется как null
// (encoding/json не умеет пропускать поле), поэтому наружу тип не отдаётся.
func (o OptionalNullable[T]) MarshalJSON() ([]byte, error) {
	if !o.Present || o.Value == nil {
		return []byte("null"), nil
	}
	return json.Marshal(*o.Value)
}

// SetValue — состояние 3 (хелпер для тестов/внутренних вызовов).
func (o *OptionalNullable[T]) SetValue(v T) {
	o.Present = true
	o.Value = &v
}

// SetNull — состояние 2.
func (o *OptionalNullable[T]) SetNull() {
	o.Present = true
	o.Value = nil
}

// arg возвращает пару параметров для статического typed-SET вида
// `col = CASE WHEN $a THEN $b ELSE col END`: (present, value-или-NULL).
func (o OptionalNullable[T]) arg() (bool, any) {
	if !o.Present {
		return false, nil
	}
	if o.Value == nil {
		return true, nil
	}
	return true, *o.Value
}
