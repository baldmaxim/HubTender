//go:build race

package changeimpact

// raceEnabled — perf-пороги не осмыслены под -race (инструментация замедляет
// код в 5-20×): perf-тесты скипаются, функциональные идут как обычно.
const raceEnabled = true
