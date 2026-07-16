package openrouter

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
)

// ConfigHashInput — значимые параметры конфигурации model test (§11 задания).
// В hash НЕ входят: tested_at, latency, token usage, UUID, presentation-поля
// и операционные лимиты (timeout/candidate_limit/max_rows/concurrency/budget).
type ConfigHashInput struct {
	ModelID                string
	PromptVersion          string
	SchemaVersion          string
	ProviderPolicyVersion  string
	RequireZDR             bool
	DataCollectionPolicy   string
	RequireParameters      bool
	AllowProviderFallbacks bool
	Temperature            float64
	MaxOutputTokens        int
	AdapterVersion         string
}

// ComputeConfigHash — стабильный sha256 канонической строки «k=v». Изменение
// любого значимого параметра меняет hash → старый PASS теряет силу (§11/§12).
func ComputeConfigHash(in ConfigHashInput) string {
	canonical := fmt.Sprintf(
		"model=%s\nprompt=%s\nschema=%s\npolicy=%s\nzdr=%t\ndata_collection=%s\nrequire_parameters=%t\nallow_fallbacks=%t\ntemperature=%s\nmax_output_tokens=%d\nadapter=%s\n",
		in.ModelID,
		in.PromptVersion,
		in.SchemaVersion,
		in.ProviderPolicyVersion,
		in.RequireZDR,
		in.DataCollectionPolicy,
		in.RequireParameters,
		in.AllowProviderFallbacks,
		strconv.FormatFloat(in.Temperature, 'f', -1, 64),
		in.MaxOutputTokens,
		in.AdapterVersion,
	)
	sum := sha256.Sum256([]byte(canonical))
	return hex.EncodeToString(sum[:])
}

// HashPrefix — короткий префикс для логов/observability (§21): сам hash не
// секрет, но полная строка в логах не нужна.
func HashPrefix(hash string) string {
	if len(hash) > 12 {
		return hash[:12]
	}
	return hash
}
