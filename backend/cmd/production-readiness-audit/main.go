// production-readiness-audit — этап 2.4 (§10): read-only аудит готовности
// данных к деплою.
//
//	go run ./cmd/production-readiness-audit [flags]
//
// По умолчанию НИЧЕГО не изменяет: без enqueue, без recalc, без миграций.
// Exit code: 0 — чисто; 1 — blockers (или warnings при --fail-on-warning).
//
// DSN берётся ТОЛЬКО из --database-url либо env READINESS_DATABASE_URL /
// DATABASE_URL — никаких зашитых production-кредов.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/readiness"
)

func main() {
	var (
		dsn        = flag.String("database-url", "", "PostgreSQL DSN (или env READINESS_DATABASE_URL / DATABASE_URL)")
		tenderID   = flag.String("tender", "", "ограничить аудит одним tender UUID")
		batchSize  = flag.Int("batch-size", 20, "предел details на проверку")
		timeoutMin = flag.Int("calculating-timeout-minutes", 10, "порог зависшего calculating")
		jsonOut    = flag.String("json-out", "", "записать JSON-отчёт в файл")
		failOnWarn = flag.Bool("fail-on-warning", false, "ненулевой exit при warnings/unknown")
		noMarkup   = flag.Bool("skip-markup-impact", false, "не строить markup backfill impact (§11)")
		noACL      = flag.Bool("skip-acl", false, "не выполнять ACL-верификацию (§12)")
	)
	flag.Parse()

	url := *dsn
	if url == "" {
		url = os.Getenv("READINESS_DATABASE_URL")
	}
	if url == "" {
		url = os.Getenv("DATABASE_URL")
	}
	if url == "" {
		fmt.Fprintln(os.Stderr, "ошибка: не задан DSN (--database-url / READINESS_DATABASE_URL / DATABASE_URL)")
		os.Exit(2)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ошибка подключения:", redactedErr(err))
		os.Exit(2)
	}
	defer pool.Close()

	rep, err := readiness.Run(ctx, pool, readiness.Options{
		TenderID:           *tenderID,
		BatchSize:          *batchSize,
		CalculatingTimeout: time.Duration(*timeoutMin) * time.Minute,
		FailOnWarning:      *failOnWarn,
		IncludeMarkup:      !*noMarkup,
		IncludeACL:         !*noACL,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "аудит завершился ошибкой:", redactedErr(err))
		os.Exit(2)
	}

	// Человекочитаемая сводка (redacted).
	fmt.Printf("Production readiness audit — blockers=%d warnings=%d unknown=%d\n",
		rep.Blockers, rep.Warnings, rep.Unknowns)
	fmt.Printf("fingerprint=%s\n\n", rep.Fingerprint)
	for _, c := range rep.Checks {
		mark := "OK "
		switch c.Status {
		case readiness.StatusBlocker:
			mark = "BLK"
		case readiness.StatusWarning:
			mark = "WRN"
		case readiness.StatusUnknown:
			mark = "UNK"
		}
		fmt.Printf("[%s] %-36s count=%d\n", mark, c.ID, c.Count)
		for _, d := range c.Details {
			fmt.Printf("      %s\n", d)
		}
	}
	if rep.Markup != nil && len(rep.Markup.AffectedTactics) > 0 {
		fmt.Printf("\nMarkup backfill затронет тактик: %d (см. JSON: markup_backfill_impact)\n",
			len(rep.Markup.AffectedTactics))
	}

	if *jsonOut != "" {
		data, _ := json.MarshalIndent(rep, "", "  ")
		if err := os.WriteFile(*jsonOut, data, 0o644); err != nil {
			fmt.Fprintln(os.Stderr, "не удалось записать JSON:", err)
			os.Exit(2)
		}
		fmt.Printf("\nJSON: %s\n", *jsonOut)
	}
	os.Exit(rep.ExitCode(*failOnWarn))
}

// redactedErr — не печатать DSN/креды из текста ошибок драйвера.
func redactedErr(err error) string {
	s := err.Error()
	if len(s) > 300 {
		s = s[:300] + "…"
	}
	return s
}
