package openrouter

import (
	"context"
	"regexp"
	"strings"
)

// Синтетический каталог для режима proxy_llm, вариант A.
//
// У прокси нет GET /models/user: модель выбирает он сам, а присланное поле
// model вырезает. Каталог из ОДНОЙ псевдо-модели нужен не для красоты — на нём
// держатся уже существующие механические гарантии админки:
//
//   - SaveDraft продолжает проходить через один резолвер model ID, без
//     отдельной ветки «в proxy-режиме не проверяем»;
//   - config hash по-прежнему покрывает model ID, а смена модели по-прежнему
//     сбрасывает model test и выключает rollout.
//
// Вариант B (оператор разрешил клиенту выбирать модель, allowedModels: ["*"])
// каталогом не покрывается: списка моделей взять неоткуда — эндпоинта каталога
// у прокси нет, а прямого доступа к openrouter.ai у хоста нет по условию. Слаг
// вводится вручную и проходит ProxyCustomModel: формат проверяем мы,
// существование модели — только реальный вызов (SKILL §1: прокси слаги не
// валидирует и вернёт ошибку OpenRouter). Поэтому единственной настоящей
// проверкой остаётся model test, а его протухание (model_test_max_age_hours) —
// единственная защита от дрейфа модели на стороне оператора.

// ProxyModelID — заглушка «модель выбирает прокси» (SKILL §1, вариант A).
// Это НЕ слаг реальной модели: вендорного префикса у него нет намеренно.
const ProxyModelID = "proxy"

// ProxyCatalogSource — метка источника каталога для admin UI. Синтетический
// каталог обязан быть виден как синтетический, иначе оператор примет пустые
// цены и контекст за настоящие данные модели.
const ProxyCatalogSource = "proxy_synthetic"

// ProxyCatalogLister реализует modelsLister без единого сетевого вызова.
type ProxyCatalogLister struct{}

// ListUserModels — ровно одна запись. Цены, контекст и supported_parameters
// остаются ПУСТЫМИ: они неизвестны, и подставлять правдоподобные значения
// означало бы соврать в интерфейсе и в оценке бюджета.
func (ProxyCatalogLister) ListUserModels(context.Context) ([]rawModel, error) {
	m := rawModel{
		ID:            ProxyModelID,
		CanonicalSlug: ProxyModelID,
		Name:          "Модель выбирает LLM-прокси (вариант A)",
		Description: "Прокси игнорирует поле model и маршрутизирует запрос на дефолтную модель " +
			"клиента плюс её fallback-цепочку. Цена, длина контекста и набор поддерживаемых " +
			"параметров модели на стороне HUBTender неизвестны — их контролирует оператор прокси.",
	}
	m.Architecture.InputModalities = []string{"text"}
	m.Architecture.OutputModalities = []string{"text"}
	return []rawModel{m}, nil
}

// proxySlugRe — форма слага OpenRouter: author/model с необязательным
// :variant (":free", ":nitro", ":beta"). Проверка формата, а не существования:
// каталога, по которому можно было бы сверить, в этом режиме нет.
var proxySlugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*(:[a-z0-9._-]+)?$`)

// ProxyCustomModel — модель, введённая оператором вручную (вариант B/C).
//
// Возвращает запись с ПУСТЫМИ ценами, контекстом и supported_parameters: они
// неизвестны ровно так же, как у заглушки, и подставлять правдоподобные
// значения означало бы соврать в оценке бюджета. Второе значение — false, если
// слаг не похож на слаг OpenRouter.
//
// Отклоняются: заглушка ProxyModelID (она приходит из каталога, а не отсюда) и
// author=openrouter — это router/alias-псевдомодели (openrouter/auto), которые
// FilterCatalog отбрасывает и в прямом режиме; их динамическая маршрутизация
// поверх и без того непрозрачного прокси не диагностируема.
func ProxyCustomModel(slug string) (Model, bool) {
	s := strings.ToLower(strings.TrimSpace(slug))
	if s == "" || len(s) > 128 || s == ProxyModelID {
		return Model{}, false
	}
	if !proxySlugRe.MatchString(s) {
		return Model{}, false
	}
	if modelAuthor(s) == routerAuthor {
		return Model{}, false
	}
	m := rawModel{
		ID:            s,
		CanonicalSlug: s,
		Name:          s,
		Description: "Слаг задан вручную (вариант B/C). HUBTender не знает ни цены, ни длины " +
			"контекста, ни набора поддерживаемых параметров этой модели и не может проверить, " +
			"что она существует и разрешена оператором прокси, — это подтверждает только " +
			"model test. Явный выбор модели отключает fallback-цепочку прокси.",
	}
	m.Architecture.InputModalities = []string{"text"}
	m.Architecture.OutputModalities = []string{"text"}
	return NormalizeModel(m), true
}
