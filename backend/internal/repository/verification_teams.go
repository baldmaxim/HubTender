package repository

import "strings"

// teamPosition — позиция ВОР для вывода заголовков раздела.
type teamPosition struct {
	ID         string
	Name       string
	Level      int
	Additional bool
	ParentID   string
}

// positionHeaders — заголовки над каждой позицией, от ближайшего к верхнему.
// positions упорядочены по position_number. Заголовок определяется так же, как в
// sectionsSQL: среди не дополнительных позиций это та, у следующей которой
// уровень глубже. Дополнительная позиция наследует цепочку родителя (родитель
// первым); без родителя заголовков у неё нет.
func positionHeaders(positions []teamPosition) map[string][]string {
	byID := make(map[string]teamPosition, len(positions))
	for _, p := range positions {
		byID[p.ID] = p
	}
	out := make(map[string][]string, len(positions))

	var main []teamPosition
	for _, p := range positions {
		if !p.Additional {
			main = append(main, p)
		}
	}
	var stack []teamPosition // ближайший заголовок — последний
	for i, p := range main {
		for len(stack) > 0 && stack[len(stack)-1].Level >= p.Level {
			stack = stack[:len(stack)-1]
		}
		headers := make([]string, 0, len(stack))
		for j := len(stack) - 1; j >= 0; j-- {
			headers = append(headers, strings.TrimSpace(stack[j].Name))
		}
		out[p.ID] = headers
		if i+1 < len(main) && main[i+1].Level > p.Level {
			stack = append(stack, p)
		}
	}

	// Цепочка родителей дополнительной позиции; глубина ограничена от циклов.
	var chain func(p teamPosition, depth int) []string
	chain = func(p teamPosition, depth int) []string {
		if !p.Additional {
			return out[p.ID]
		}
		parent, ok := byID[p.ParentID]
		if p.ParentID == "" || !ok || depth > 10 {
			return []string{}
		}
		return append([]string{strings.TrimSpace(parent.Name)}, chain(parent, depth+1)...)
	}
	for _, p := range positions {
		if p.Additional {
			out[p.ID] = chain(p, 0)
		}
	}
	return out
}
