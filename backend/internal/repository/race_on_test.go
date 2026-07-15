//go:build race

package repository

// raceEnabled — perf-пороги не осмыслены под -race instrumentation.
const raceEnabled = true
