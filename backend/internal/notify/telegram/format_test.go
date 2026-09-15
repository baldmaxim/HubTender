package telegram

import (
	"strings"
	"testing"
)

func TestParseCallback(t *testing.T) {
	id := "0F8FAD5B-D9CB-469F-A165-70867728950E"
	if a, item, ok := ParseCallback("a:" + id); !ok || a != ActionAccept || item != strings.ToLower(id) {
		t.Fatalf("валидный callback: %q %q %v", a, item, ok)
	}
	for _, bad := range []string{"", "a", "x:" + id, "a:not-uuid", "a:" + id + "'--", "e:" + id + ":1"} {
		if _, _, ok := ParseCallback(bad); ok {
			t.Fatalf("принят битый callback %q", bad)
		}
	}
	if len(CallbackData(ActionError, id)) > 64 {
		t.Fatal("callback_data длиннее 64 байт")
	}
}

func TestParseStart(t *testing.T) {
	cases := []struct {
		in, token string
		start     bool
	}{
		{"/start abc", "abc", true},
		{"/start@hub_bot abc", "abc", true},
		{"/start", "", true},
		{"привет", "", false},
		{"/stop", "", false},
	}
	for _, c := range cases {
		tok, st := ParseStart(c.in)
		if tok != c.token || st != c.start {
			t.Fatalf("%q → %q %v", c.in, tok, st)
		}
	}
	if !IsStop("/stop") || IsStop("/start") {
		t.Fatal("IsStop")
	}
}

func TestRenderNoticeEscapesAndButtons(t *testing.T) {
	text, kb := RenderNotice(Notice{
		TenderTitle: "ЖК <Парк>",
		SenderName:  "Иванов & Ко",
		Link:        "https://tender.example/data-quality?tenderId=1",
		Items: []NoticeItem{
			{ItemID: "0f8fad5b-d9cb-469f-a165-70867728950e", RuleCode: "U", RuleTitle: "Нет ГП", Position: "5.2", Detail: "<b>x</b>"},
			{ItemID: "1f8fad5b-d9cb-469f-a165-70867728950e", RuleCode: "Q", Detail: strings.Repeat("я", 1000)},
		},
	})
	if strings.Contains(text, "<Парк>") || strings.Contains(text, "<b>x</b>") || !strings.Contains(text, "&amp; Ко") {
		t.Fatalf("текст не экранирован: %s", text)
	}
	if len([]rune(text)) > 4096 {
		t.Fatal("сообщение длиннее лимита Telegram")
	}
	if len(kb) != 3 || kb[0][0].CallbackData != "a:0f8fad5b-d9cb-469f-a165-70867728950e" || kb[2][0].URL == "" {
		t.Fatalf("клавиатура: %+v", kb)
	}
	_, kb = RenderNotice(Notice{Link: "javascript:alert(1)", Items: []NoticeItem{{ItemID: "0f8fad5b-d9cb-469f-a165-70867728950e"}}})
	if len(kb) != 1 {
		t.Fatal("небезопасная ссылка попала в кнопку")
	}
}

func TestAPIErrorHidesNothingSecret(t *testing.T) {
	c, err := NewClient(Config{Token: "123:SECRET", APIBaseURL: "http://127.0.0.1:1"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.SendMessage(t.Context(), 1, "x", nil)
	if err == nil || strings.Contains(err.Error(), "SECRET") {
		t.Fatalf("ошибка раскрывает токен или отсутствует: %v", err)
	}
}
