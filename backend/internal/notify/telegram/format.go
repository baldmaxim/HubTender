package telegram

import (
	"fmt"
	"html"
	"regexp"
	"strings"
	"unicode/utf8"
)

// MaxItemsPerMessage — находок в одном сообщении. Больше — следующее сообщение:
// у каждой находки две кнопки, а длинная простыня в чате не читается.
const MaxItemsPerMessage = 10

// Лимит текста сообщения Telegram — 4096 символов; держим запас под разметку.
const maxDetailRunes = 300

// Callback-действия: a — «норма», e — «ошибка, исправлю».
const (
	ActionAccept = "a"
	ActionError  = "e"
)

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// CallbackData — «a:<uuid элемента рассылки>», 38 байт при лимите 64.
func CallbackData(action, itemID string) string { return action + ":" + itemID }

// ParseCallback разбирает callback_data; ok=false — чужие или битые данные.
func ParseCallback(data string) (action, itemID string, ok bool) {
	action, itemID, found := strings.Cut(data, ":")
	if !found || (action != ActionAccept && action != ActionError) || !uuidRe.MatchString(itemID) {
		return "", "", false
	}
	return action, strings.ToLower(itemID), true
}

// ParseStart — токен из «/start <токен>» (или «/start@bot <токен>»).
func ParseStart(text string) (token string, isStart bool) {
	fields := strings.Fields(text)
	if len(fields) == 0 {
		return "", false
	}
	cmd, _, _ := strings.Cut(fields[0], "@")
	if cmd != "/start" {
		return "", false
	}
	if len(fields) > 1 {
		return fields[1], true
	}
	return "", true
}

// IsStop — команда отвязки.
func IsStop(text string) bool {
	fields := strings.Fields(text)
	if len(fields) == 0 {
		return false
	}
	cmd, _, _ := strings.Cut(fields[0], "@")
	return cmd == "/stop"
}

// NoticeItem — находка в сообщении.
type NoticeItem struct {
	ItemID    string
	RuleCode  string
	RuleTitle string
	Position  string
	Detail    string
}

// Notice — одно сообщение адресату.
type Notice struct {
	TenderTitle string
	SenderName  string
	Link        string
	Items       []NoticeItem
}

func truncateRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n]) + "…"
}

// RenderNotice — HTML-текст и клавиатура. Весь пользовательский текст экранируется.
func RenderNotice(n Notice) (string, [][]InlineButton) {
	var b strings.Builder
	fmt.Fprintf(&b, "<b>Замечания проверки расчёта</b>\n%s\n", html.EscapeString(n.TenderTitle))
	if n.SenderName != "" {
		fmt.Fprintf(&b, "Отправил: %s\n", html.EscapeString(n.SenderName))
	}
	keyboard := make([][]InlineButton, 0, len(n.Items)+1)
	for i, it := range n.Items {
		num := i + 1
		title := it.RuleCode
		if it.RuleTitle != "" {
			title += " · " + it.RuleTitle
		}
		fmt.Fprintf(&b, "\n<b>%d.</b> %s\n", num, html.EscapeString(title))
		if it.Position != "" {
			fmt.Fprintf(&b, "Позиция %s\n", html.EscapeString(it.Position))
		}
		b.WriteString(html.EscapeString(truncateRunes(it.Detail, maxDetailRunes)))
		b.WriteString("\n")
		keyboard = append(keyboard, []InlineButton{
			{Text: fmt.Sprintf("%d ✅ Норма", num), CallbackData: CallbackData(ActionAccept, it.ItemID)},
			{Text: fmt.Sprintf("%d ❗ Ошибка, исправлю", num), CallbackData: CallbackData(ActionError, it.ItemID)},
		})
	}
	if strings.HasPrefix(n.Link, "https://") {
		keyboard = append(keyboard, []InlineButton{{Text: "Открыть в TenderHUB", URL: n.Link}})
	}
	return b.String(), keyboard
}
