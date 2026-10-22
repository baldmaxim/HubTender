package quality

import (
	"strings"
	"unicode"
)

// Команды «Хронологии» (tender_groups.name).
const (
	TeamGeneral  = "Общестрой"
	TeamFacade   = "Фасады"
	TeamFinish   = "Отделка"
	TeamElectric = "ЭОМ/СС"
	TeamHVAC     = "ОВиВК"
)

// Teams — все команды в порядке приоритета при равенстве совпадений.
var Teams = []string{TeamGeneral, TeamFacade, TeamFinish, TeamElectric, TeamHVAC}

// teamKeys — ключи команды: stems ищутся подстрокой, tokens — целым словом.
type teamKeys struct {
	stems  []string
	tokens []string
}

type teamRule struct {
	team   string
	strong teamKeys
	weak   teamKeys
}

// teamRules — ключи в нормализованном виде (нижний регистр, ё → е).
var teamRules = []teamRule{
	{
		team: TeamGeneral,
		strong: teamKeys{
			stems: []string{
				"монолит", "бетон", "ж/б", "железобетон", "арматур", "опалуб", "котлован", "земляны",
				"грунт", "засыпк", "свай", "шпунт", "фундамент", "кладк", "перегород", "кровл",
				"гидроизол", "теплоизол", "утепл", "металлоконстр", "каркас", "перекрыт", "лестниц",
				"благоустр", "озеленен", "газон", "малые архитектурн", "дорог", "проезд", "тротуар",
				"асфальт", "бордюр", "двер", "ворот", "лифт", "подъемник", "эскалатор",
				"вертикального транспорт", "технолог", "мусороудал", "мусоропровод", "паркинг",
				"автостоян", "рамп", "подготов", "временн", "бытов", "демонтаж", "снос",
				"нулевого цикла", "водопонижен", "водоотлив", "дренаж", "деформацион", "гидрошпонк",
				"генподряд", "сдач", "документац", "дератизац", "мойк", "планировк", "охран",
			},
			tokens: []string{"маф", "леса", "лесов"},
		},
		weak: teamKeys{
			stems: []string{
				"стен", "конструкц", "подземн", "надземн", "наземн", "ограждени", "содержани",
				"площадк", "покрыт",
			},
		},
	},
	{
		team: TeamFacade,
		strong: teamKeys{
			stems: []string{
				"фасад", "витраж", "светопрозрач", "остеклен", "оконн", "ограждающ", "навесн", "зенитн",
			},
			tokens: []string{"окна", "окно", "окон", "нвф", "спк"},
		},
	},
	{
		team: TeamFinish,
		strong: teamKeys{
			stems: []string{
				"отделк", "отделоч", "штукатур", "окраск", "малярн", "шпатлев", "плитк", "плиточн",
				"покрытия пол", "покрытие пол", "напольн", "потолк", "обои", "чистов", "черновая",
			},
			tokens: []string{"моп"},
		},
	},
	{
		team: TeamElectric,
		strong: teamKeys{
			stems: []string{
				"электр", "освещен", "слаботоч", "связи", "связь", "сигнализац", "оповещен",
				"автоматизац", "диспетчериз", "видеонаблюд", "домофон", "радиофик", "телевиден",
				"молниезащ", "заземлен", "кабел", "трансформатор", "противопожарной автомат",
				"противопожарная автомат", "контроля доступ", "контроль доступ",
			},
			tokens: []string{
				"эом", "эм", "эо", "сс", "апс", "аупс", "скуд", "соуэ", "асутп", "аскуэ", "тп", "ктп",
				"вру", "грщ",
			},
		},
	},
	{
		team: TeamHVAC,
		strong: teamKeys{
			stems: []string{
				"отоплен", "вентиляц", "кондиционир", "водоснаб", "водопровод", "канализ", "водоотвед",
				"водосток", "ливнев", "теплоснаб", "теплов", "холодоснаб", "дымоудал", "противодым",
				"пожаротуш", "спринклер", "дренчер", "сантехн", "газоснаб", "трубопровод",
				"механическ",
			},
			tokens: []string{"ов", "вк", "овик", "овивк", "итп", "впв", "ауп", "аупт"},
		},
	},
}

// ClassifyTeam — команда по разделу позиции. headers — заголовки над позицией от
// ближайшего к верхнему, own — наименование самой позиции. ok=false — не распознано.
func ClassifyTeam(headers []string, own string) (string, bool) {
	for _, strong := range []bool{true, false} {
		for _, h := range headers {
			if team, ok := matchTeam(h, strong); ok {
				return team, true
			}
		}
	}
	for _, strong := range []bool{true, false} {
		if team, ok := matchTeam(own, strong); ok {
			return team, true
		}
	}
	return "", false
}

// matchTeam — команда с самым ранним вхождением ключа в имени; при равенстве —
// с более длинным ключом, затем по порядку Teams.
func matchTeam(name string, strong bool) (string, bool) {
	norm := normalizeTeamName(name)
	if norm == "" {
		return "", false
	}
	tokens := teamTokens(norm)
	bestTeam, bestIdx, bestLen := "", -1, 0
	consider := func(team string, idx, length int) {
		if idx < 0 {
			return
		}
		if bestIdx < 0 || idx < bestIdx || (idx == bestIdx && length > bestLen) {
			bestTeam, bestIdx, bestLen = team, idx, length
		}
	}
	for _, rule := range teamRules {
		keys := rule.weak
		if strong {
			keys = rule.strong
		}
		for _, stem := range keys.stems {
			consider(rule.team, strings.Index(norm, stem), len(stem))
		}
		for _, key := range keys.tokens {
			for _, tk := range tokens {
				if tk.text == key {
					consider(rule.team, tk.idx, len(key))
					break
				}
			}
		}
	}
	return bestTeam, bestIdx >= 0
}

func normalizeTeamName(s string) string {
	return strings.ReplaceAll(strings.ToLower(strings.TrimSpace(s)), "ё", "е")
}

type teamToken struct {
	text string
	idx  int
}

// teamTokens режет имя на слова и цифры; idx — смещение в байтах.
func teamTokens(s string) []teamToken {
	var out []teamToken
	start := -1
	for i, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			if start < 0 {
				start = i
			}
			continue
		}
		if start >= 0 {
			out = append(out, teamToken{s[start:i], start})
			start = -1
		}
	}
	if start >= 0 {
		out = append(out, teamToken{s[start:], start})
	}
	return out
}
