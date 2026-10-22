// Package telegram — формирование сообщений и разбор обновлений для внешних
// Telegram-ботов (офисный ПК): бэкенд сам в Bot API не ходит, токена бота не
// хранит. Бот получает обновления у Telegram, пересылает их в наш API по
// машинному ключу и отправляет то, что API вернул (api/VERIFICATION_BOT.md,
// api/REGISTRY.md).
package telegram

// Update — нужные боту поля входящего обновления.
type Update struct {
	UpdateID      int64          `json:"update_id"`
	Message       *Message       `json:"message"`
	CallbackQuery *CallbackQuery `json:"callback_query"`
}

type Message struct {
	MessageID int64  `json:"message_id"`
	Date      int64  `json:"date"` // unix-время отправки сообщения
	Chat      Chat   `json:"chat"`
	From      *User  `json:"from"`
	Text      string `json:"text"`
}

type Chat struct {
	ID   int64  `json:"id"`
	Type string `json:"type"`
}

type User struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}

type CallbackQuery struct {
	ID      string   `json:"id"`
	From    User     `json:"from"`
	Message *Message `json:"message"`
	Data    string   `json:"data"`
}

// InlineButton — кнопка с callback_data (≤ 64 байт) или ссылкой.
type InlineButton struct {
	Text         string `json:"text"`
	CallbackData string `json:"callback_data,omitempty"`
	URL          string `json:"url,omitempty"`
}
