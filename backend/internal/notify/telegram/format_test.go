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
		Items: []NoticeItem{
			{
				ItemID: "0f8fad5b-d9cb-469f-a165-70867728950e", RuleCode: "U", RuleTitle: "Нет ГП", Position: "5.2", Detail: "<b>x</b>",
				Link: "https://tender.example/positions/p1/items?itemId=i1&positionId=p1&tenderId=t1",
			},
			{ItemID: "1f8fad5b-d9cb-469f-a165-70867728950e", RuleCode: "Q", Detail: strings.Repeat("я", 1000)},
		},
	})
	if strings.Contains(text, "<Парк>") || strings.Contains(text, "<b>x</b>") || !strings.Contains(text, "&amp; Ко") {
		t.Fatalf("текст не экранирован: %s", text)
	}
	if len([]rune(text)) > 4096 {
		t.Fatal("сообщение длиннее лимита Telegram")
	}
	const wantLink = `<a href="https://tender.example/positions/p1/items?itemId=i1&amp;positionId=p1&amp;tenderId=t1">Позиция 5.2</a>`
	if !strings.Contains(text, wantLink) {
		t.Fatalf("нет ссылки на строку: %s", text)
	}
	if strings.Count(text, "<a ") != 1 {
		t.Fatalf("ссылка должна быть только у первой находки: %s", text)
	}
	if len(kb) != 2 || kb[0][0].CallbackData != "a:0f8fad5b-d9cb-469f-a165-70867728950e" {
		t.Fatalf("клавиатура: %+v", kb)
	}
	for _, row := range kb {
		for _, btn := range row {
			if btn.URL != "" {
				t.Fatalf("у кнопки не должно быть URL: %+v", btn)
			}
		}
	}

	text, kb = RenderNotice(Notice{Items: []NoticeItem{
		{ItemID: "0f8fad5b-d9cb-469f-a165-70867728950e", Position: "7", Link: "javascript:alert(1)"},
	}})
	if strings.Contains(text, "<a ") || strings.Contains(text, "javascript") || !strings.Contains(text, "Позиция 7") || len(kb) != 1 {
		t.Fatalf("небезопасная ссылка: %s %+v", text, kb)
	}

	text, _ = RenderNotice(Notice{Items: []NoticeItem{
		{ItemID: "0f8fad5b-d9cb-469f-a165-70867728950e", Position: "<i>1</i>", Link: "https://tender.example/p"},
	}})
	if strings.Contains(text, "<i>") || !strings.Contains(text, `">Позиция &lt;i&gt;1&lt;/i&gt;</a>`) {
		t.Fatalf("метка ссылки не экранирована: %s", text)
	}

	text, _ = RenderNotice(Notice{Items: []NoticeItem{
		{ItemID: "0f8fad5b-d9cb-469f-a165-70867728950e", Link: "https://tender.example/p"},
	}})
	if !strings.Contains(text, `<a href="https://tender.example/p">Открыть в TenderHUB</a>`) {
		t.Fatalf("метка по умолчанию: %s", text)
	}
}
