package openrouter

import "testing"

// Вариант B/C: слаг вводится вручную, каталога для сверки нет. Формат —
// единственное, что мы можем проверить до реального вызова.
func TestProxyCustomModelAccepts(t *testing.T) {
	cases := []string{
		"openai/gpt-4o-mini",
		"anthropic/claude-3.5-sonnet",
		"meta-llama/llama-3.1-70b-instruct:free",
		"OpenAI/GPT-4O-Mini", // регистр нормализуется
		" openai/gpt-4o-mini ",
	}
	for _, slug := range cases {
		m, ok := ProxyCustomModel(slug)
		if !ok {
			t.Fatalf("ProxyCustomModel(%q): want ok", slug)
		}
		if m.ID == "" || m.ID != m.CanonicalSlug {
			t.Fatalf("ProxyCustomModel(%q): id=%q slug=%q", slug, m.ID, m.CanonicalSlug)
		}
		// Цены и контекст обязаны остаться пустыми: они неизвестны, и
		// правдоподобное значение соврало бы в оценке бюджета.
		if m.PromptPricePerToken != "" || m.CompletionPricePerToken != "" || m.ContextLength != nil {
			t.Fatalf("ProxyCustomModel(%q): ожидались пустые цены/контекст, got %+v", slug, m)
		}
	}
}

func TestProxyCustomModelRejects(t *testing.T) {
	cases := map[string]string{
		"пусто":              "",
		"без организации":    "gpt-4o-mini",
		"заглушка":           ProxyModelID,
		"router-псевдо":      "openrouter/auto",
		"пробел внутри":      "openai/gpt 4o",
		"двойной слэш":       "openai/foo/bar",
		"ведущий слэш":       "/gpt-4o-mini",
		"хвостовой слэш":     "openai/",
		"недопустимый сивол": "openai/gpt@4o",
	}
	for name, slug := range cases {
		if _, ok := ProxyCustomModel(slug); ok {
			t.Fatalf("%s: ProxyCustomModel(%q) должен отклонять", name, slug)
		}
	}
	long := "openai/"
	for i := 0; i < 130; i++ {
		long += "a"
	}
	if _, ok := ProxyCustomModel(long); ok {
		t.Fatal("слишком длинный слаг должен отклоняться")
	}
}

// Заглушка и ручной слаг должны различаться по смыслу: первая означает
// «модель выбирает прокси», второй — явный выбор, отключающий fallback.
func TestProxyStubIsNotCustomModel(t *testing.T) {
	models, err := ProxyCatalogLister{}.ListUserModels(nil)
	if err != nil || len(models) != 1 || models[0].ID != ProxyModelID {
		t.Fatalf("синтетический каталог изменился: %+v, err=%v", models, err)
	}
	if _, ok := ProxyCustomModel(models[0].ID); ok {
		t.Fatal("заглушка не должна проходить как ручной слаг")
	}
}
