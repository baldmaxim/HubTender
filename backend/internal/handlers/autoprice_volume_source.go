package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"
)

// Источник объёма позиции в карточке проверки авторасценки (review.volume_source).

const (
	maxVolumeSourceUnitLen = 32
	maxVolumeSourceTextLen = 300
)

var volumeSourceKinds = map[string]bool{"ai_model": true, "conditional": true, "customer_boq": true}

// volumeSourceOut — нормализованный вид: только известные ключи, пустые
// необязательные значения не пишутся.
type volumeSourceOut struct {
	Kind  string   `json:"kind"`
	Value *float64 `json:"value,omitempty"`
	Unit  string   `json:"unit,omitempty"`
	Label string   `json:"label,omitempty"`
	Ref   string   `json:"ref,omitempty"`
	Note  string   `json:"note,omitempty"`
}

// buildVolumeSource разбирает поле volume_source тела карточки с тремя
// состояниями: ключа нет (len(raw)==0) — set=false, значение в БД не меняется;
// null — set=true, val=nil (сбросить в NULL); объект — set=true, val —
// нормализованный JSON. При нарушении формата set=true и msg непустой.
func buildVolumeSource(raw json.RawMessage) (set bool, val []byte, msg string) {
	if len(raw) == 0 {
		return false, nil, ""
	}
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return true, nil, ""
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return true, nil, "volume_source: ожидается объект {kind, value?, unit?, label?, ref?, note?} или null"
	}

	var kind string
	if err := json.Unmarshal(fields["kind"], &kind); err != nil || !volumeSourceKinds[kind] {
		return true, nil, "volume_source.kind: ai_model, conditional или customer_boq"
	}
	out := volumeSourceOut{Kind: kind}

	var value *float64
	if v, ok := fields["value"]; ok {
		if err := json.Unmarshal(v, &value); err != nil {
			return true, nil, "volume_source.value: ожидается число"
		}
	}
	switch {
	case value != nil && (math.IsNaN(*value) || math.IsInf(*value, 0)):
		return true, nil, "volume_source.value: ожидается конечное число"
	case kind == "ai_model" && (value == nil || *value <= 0):
		return true, nil, "volume_source.value: для ai_model обязательно число больше 0"
	case value != nil && *value < 0:
		return true, nil, "volume_source.value: число не меньше 0"
	}
	out.Value = value

	strs := []struct {
		key    string
		max    int
		must   bool
		target *string
	}{
		{"unit", maxVolumeSourceUnitLen, kind == "ai_model", &out.Unit},
		{"label", maxVolumeSourceTextLen, false, &out.Label},
		{"ref", maxVolumeSourceTextLen, false, &out.Ref},
		{"note", maxVolumeSourceTextLen, false, &out.Note},
	}
	for _, s := range strs {
		var str *string
		if v, ok := fields[s.key]; ok {
			if err := json.Unmarshal(v, &str); err != nil {
				return true, nil, fmt.Sprintf("volume_source.%s: ожидается строка", s.key)
			}
		}
		if str != nil {
			*s.target = strings.TrimSpace(*str)
		}
		if *s.target == "" && s.must {
			return true, nil, fmt.Sprintf("volume_source.%s: для ai_model обязательна непустая строка", s.key)
		}
		if utf8.RuneCountInString(*s.target) > s.max {
			return true, nil, fmt.Sprintf("volume_source.%s: не больше %d символов", s.key, s.max)
		}
	}

	b, err := json.Marshal(out)
	if err != nil {
		return true, nil, "volume_source: не удалось разобрать значение"
	}
	return true, b, ""
}
