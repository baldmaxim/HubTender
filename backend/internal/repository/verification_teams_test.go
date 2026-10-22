package repository

import (
	"reflect"
	"testing"
)

func TestPositionHeaders(t *testing.T) {
	positions := []teamPosition{
		{ID: "a", Name: " Корпус 1 ", Level: 0},
		{ID: "b", Name: "Инженерные системы", Level: 1},
		{ID: "c", Name: "Электроснабжение", Level: 2},
		{ID: "d", Name: "Кабель", Level: 3},
		{ID: "e", Name: "Щит", Level: 3},
		{ID: "f", Name: "Освещение", Level: 2},
		{ID: "g", Name: "Светильник", Level: 3},
		{ID: "h", Name: "Корпус 2", Level: 0},
		{ID: "i", Name: "Работа", Level: 1},
		{ID: "x", Name: "Доп к кабелю", Additional: true, ParentID: "d"},
		{ID: "y", Name: "Доп без родителя", Additional: true},
		{ID: "z", Name: "Доп к допу", Additional: true, ParentID: "x"},
	}
	want := map[string][]string{
		"a": {},
		"b": {"Корпус 1"},
		"c": {"Инженерные системы", "Корпус 1"},
		"d": {"Электроснабжение", "Инженерные системы", "Корпус 1"},
		"e": {"Электроснабжение", "Инженерные системы", "Корпус 1"},
		"f": {"Инженерные системы", "Корпус 1"},
		"g": {"Освещение", "Инженерные системы", "Корпус 1"},
		"h": {},
		"i": {"Корпус 2"},
		"x": {"Кабель", "Электроснабжение", "Инженерные системы", "Корпус 1"},
		"y": {},
		"z": {"Доп к кабелю", "Кабель", "Электроснабжение", "Инженерные системы", "Корпус 1"},
	}
	got := positionHeaders(positions)
	for id, w := range want {
		if !reflect.DeepEqual(got[id], w) {
			t.Errorf("%s: %q, ждали %q", id, got[id], w)
		}
	}
}

func TestPositionHeadersAdditionalIgnoredInHierarchy(t *testing.T) {
	// Дополнительная позиция между заголовком и его строкой не ломает определение заголовка.
	positions := []teamPosition{
		{ID: "a", Name: "Раздел", Level: 0},
		{ID: "x", Name: "Доп", Level: 0, Additional: true},
		{ID: "b", Name: "Работа", Level: 1},
	}
	got := positionHeaders(positions)
	if !reflect.DeepEqual(got["b"], []string{"Раздел"}) {
		t.Fatalf("b: %q", got["b"])
	}
}
