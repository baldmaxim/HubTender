package openrouter

import "context"

// Синтетический каталог для режима proxy_llm, вариант A.
//
// У прокси нет GET /models/user: модель выбирает он сам, а присланное поле
// model вырезает. Каталог из ОДНОЙ псевдо-модели нужен не для красоты — на нём
// держатся уже существующие механические гарантии админки:
//
//   - выбор модели остаётся radio-выбором из server-каталога, free-text
//     по-прежнему невозможен;
//   - SaveDraft продолжает валидировать model ID через FindModel, без
//     отдельной ветки «в proxy-режиме не проверяем»;
//   - config hash по-прежнему покрывает model ID, а смена модели по-прежнему
//     сбрасывает model test и выключает rollout.
//
// Альтернатива (спрятать каталог и писать selected_model_id мимо валидации)
// потребовала бы обхода FindModel — ровно того паттерна «гвард зелёный,
// гарантия исчезла», против которого весь этот контур и построен.

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
