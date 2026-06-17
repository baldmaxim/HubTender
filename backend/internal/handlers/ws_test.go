package handlers

import (
	"testing"

	"github.com/su10/hubtender/backend/internal/middleware"
)

func TestAuthoriseTopic(t *testing.T) {
	h := &WsHandler{}
	admin := &middleware.AuthUser{ID: "u1", Role: "administrator"}
	dev := &middleware.AuthUser{ID: "u1", Role: "developer"}
	eng := &middleware.AuthUser{ID: "u1", Role: "engineer"}

	tests := []struct {
		name  string
		user  *middleware.AuthUser
		topic string
		want  bool
	}{
		{"own notifications", eng, "notifications:u1", true},
		{"other notifications", eng, "notifications:u2", false},
		{"tender any", eng, "tender:abc", true},
		{"tenders global", eng, "tenders", true},
		{"tasks", eng, "tasks", true},
		{"references", eng, "references", true},
		{"templates", eng, "templates", true},
		{"markup", eng, "markup", true},
		{"projects", eng, "projects", true},
		{"imports", eng, "imports", true},
		{"users as administrator", admin, "users", true},
		{"users as developer", dev, "users", true},
		{"users as engineer", eng, "users", false},
		{"unknown topic", eng, "bogus", false},
		{"empty topic", eng, "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := h.authoriseTopic(tt.user, tt.topic); got != tt.want {
				t.Errorf("authoriseTopic(role=%s, %q) = %v, want %v", tt.user.Role, tt.topic, got, tt.want)
			}
		})
	}
}
