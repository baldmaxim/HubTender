// ai-nomenclature-eval — этап 2.6 (§15/§26): evaluation выбранной модели.
//
//	go run ./cmd/ai-nomenclature-eval --mode deterministic|mock|live \
//	    [--dataset synthetic] [--confirm-live-provider-cost] [--save-summary]
//
// Live-режим требует ОДНОВРЕМЕННО: OPENROUTER_LIVE_TEST=true,
// OPENROUTER_API_KEY, сохранённую выбранную модель с пройденным тестом,
// rollout mode = evaluation и явный флаг --confirm-live-provider-cost.
// Команда read-only относительно BOQ/aliases: не меняет pilot users,
// rollout, активацию модели; raw prompts/responses не выводятся и не
// сохраняются; --save-summary пишет только безопасный агрегат.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/ai/openrouter"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
)

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "FAIL: "+format+"\n", args...)
	os.Exit(1)
}

func main() {
	mode := flag.String("mode", "deterministic", "deterministic | mock | live")
	dataset := flag.String("dataset", "synthetic", "synthetic (approved_aliases — только при явном разрешении)")
	confirmCost := flag.Bool("confirm-live-provider-cost", false, "явное подтверждение платного live-вызова")
	saveSummary := flag.Bool("save-summary", false, "сохранить безопасный summary в БД")
	flag.Parse()

	if *dataset != "synthetic" {
		// Approved-aliases dataset (§14.B) требует отдельного явного
		// разрешения и БД; в CLI MVP поддержан только synthetic.
		if os.Getenv("AI_NOMENCLATURE_EVAL_APPROVED_ALIASES") != "true" {
			fail("dataset %q недоступен: задайте AI_NOMENCLATURE_EVAL_APPROVED_ALIASES=true (и используйте synthetic для обязательного gate)", *dataset)
		}
		fail("approved_aliases dataset в CLI этапа 2.6 не реализован; обязательный gate — synthetic")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	// Настройки модели читаются из ai_feature_settings — БД обязательна для
	// всех режимов (disposable PostgreSQL для локальных прогонов).
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		fail("DATABASE_URL обязателен (ai_feature_settings)")
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		fail("db connect: %v", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		fail("db ping: %v", err)
	}
	store := repository.NewAISettingsRepo(pool)

	// OpenRouter client: ключ только из env; base — allowlist/официальный
	// (кастомный base для fake-server тестов разрешён вне production —
	// команда не production-инструмент).
	orClient, err := openrouter.New(openrouter.Config{
		APIKey:  os.Getenv("OPENROUTER_API_KEY"),
		BaseURL: os.Getenv("OPENROUTER_API_BASE"),
		Timeout: 60 * time.Second,
	})
	if err != nil {
		fail("openrouter client: %v", err)
	}
	catalog := openrouter.NewCatalogCache(orClient, openrouter.CatalogTTL)

	svc := services.NewAIAdminService(orClient, catalog, store).
		WithLiveTestFlag(os.Getenv("OPENROUTER_LIVE_TEST") == "true")

	// §26: model ID из CLI не принимается; OPENROUTER_TEST_MODEL_ID — только
	// безопасное сравнение с сохранённой моделью.
	if want := os.Getenv("OPENROUTER_TEST_MODEL_ID"); want != "" {
		row, err := store.GetFeatureSettings(ctx, repository.AIFeatureNomenclatureRerank)
		if err != nil {
			fail("settings: %v", err)
		}
		if row.SelectedModelID == nil || *row.SelectedModelID != want {
			fail("OPENROUTER_TEST_MODEL_ID не совпадает с сохранённой моделью админ-настроек")
		}
	}

	result, summary, err := svc.RunEvaluation(ctx, *mode, "", *confirmCost, *saveSummary)
	if err != nil {
		fail("evaluation: %v", err)
	}

	m := result.Metrics
	fmt.Println("── AI NOMENCLATURE EVALUATION ────────────────────────────────")
	fmt.Printf("mode: %s   dataset: %s   dataset_hash: %s   size: %d   eligible: %d\n",
		result.Mode, *dataset, m.DatasetHash[:16], m.DatasetSize, m.EligibleCases)
	fmt.Printf("recall@20: %.0f%%   top-1: %.0f%%   top-3: %.0f%%\n", m.RecallAt20*100, m.Top1*100, m.Top3*100)
	fmt.Printf("abstention: %.0f%% (correct %.0f%%)   high-conf coverage: %.0f%% precision: %.0f%% FP: %d\n",
		m.AbstentionRate*100, m.AbstentionCorrect*100, m.HighConfCoverage*100, m.HighConfPrecision*100, m.HighConfFalsePos)
	fmt.Printf("critical hard-negative FP: %d   unknown-ID accepted: %d   invalid: %d   timeouts: %d   rate-limited: %d\n",
		m.CriticalFalsePos, m.UnknownIDAccepted, m.InvalidResponses, m.TimeoutCount, m.RateLimitedCount)
	fmt.Printf("latency p50/p95: %d/%d ms   tokens: %d→%d\n", m.LatencyP50Ms, m.LatencyP95Ms, m.PromptTokens, m.CompletionTokens)
	fmt.Printf("provider cost: %s   estimated: %s   unit: %s\n", orEmpty(m.ProviderCost), orEmpty(m.EstimatedCost), m.CostUnit)
	fmt.Println("gates:")
	for _, g := range result.Gates {
		mark := "PASS"
		if !g.Passed {
			mark = "FAIL"
		}
		fmt.Printf("  [%s] %s %s\n", mark, g.Title, g.Detail)
	}
	if summary != nil {
		fmt.Printf("summary saved: %s\n", summary.ID)
	}
	if result.Passed {
		fmt.Println("RESULT: PASS")
		return
	}
	fmt.Println("RESULT: FAIL")
	os.Exit(2)
}

func orEmpty(s string) string {
	if s == "" {
		return "—"
	}
	return s
}
