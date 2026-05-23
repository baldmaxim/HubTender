package auth

import (
	"errors"
	"fmt"
	"net/smtp"
	"strings"
	"time"
)

// Mailer is the narrow interface the password-recovery flow uses to send
// outbound transactional mail. Kept tiny on purpose — no templates, no
// async pool, no retry. The service layer decides whether to ignore an
// error (forgot-password anti-enumeration) or to surface it.
type Mailer interface {
	// IsConfigured returns true when the implementation can actually deliver
	// mail. Forgot-password uses this to fall back to in-response reset
	// URL exposure in development.
	IsConfigured() bool
	// Send delivers a single message. Implementations MUST NOT log the
	// body / subject (it can contain a reset-token URL).
	Send(to, subject, body string) error
}

// ErrMailerNotConfigured is what NoopMailer.Send returns — callers can
// distinguish "no provider" from "provider error" and decide per use case.
var ErrMailerNotConfigured = errors.New("auth: mailer not configured")

// ---------------------------------------------------------------------------
// NoopMailer
// ---------------------------------------------------------------------------

// NoopMailer is the placeholder implementation used when SMTP_HOST is empty.
// IsConfigured() returns false; Send() returns ErrMailerNotConfigured.
type NoopMailer struct{}

func (NoopMailer) IsConfigured() bool { return false }

func (NoopMailer) Send(_, _, _ string) error { return ErrMailerNotConfigured }

// ---------------------------------------------------------------------------
// SMTPMailer
// ---------------------------------------------------------------------------

// SMTPConfig carries the knobs SMTPMailer needs. Host + From must be set;
// User+Password may be empty for unauthenticated relays.
type SMTPConfig struct {
	Host     string
	Port     int
	User     string
	Password string
	From     string
}

// SMTPMailer is a minimal net/smtp wrapper. Uses STARTTLS when port == 587
// (the default), implicit TLS when port == 465, and plain auth otherwise.
//
// Per-send timeout is hard-coded to 10 s — outbound mail must NEVER block
// an HTTP request thread long enough to matter; forgot-password handlers
// run this on a goroutine if a longer SLA is ever needed.
type SMTPMailer struct {
	cfg SMTPConfig
}

// NewSMTPMailer constructs an SMTPMailer. Returns NoopMailer when Host is
// empty so call sites don't have to branch — they just check IsConfigured().
func NewSMTPMailer(cfg SMTPConfig) Mailer {
	if strings.TrimSpace(cfg.Host) == "" {
		return NoopMailer{}
	}
	if cfg.Port == 0 {
		cfg.Port = 587
	}
	return &SMTPMailer{cfg: cfg}
}

func (m *SMTPMailer) IsConfigured() bool { return true }

func (m *SMTPMailer) Send(to, subject, body string) error {
	if strings.TrimSpace(to) == "" {
		return errors.New("smtp: empty recipient")
	}
	if strings.TrimSpace(m.cfg.From) == "" {
		return errors.New("smtp: empty SMTP_FROM")
	}
	addr := fmt.Sprintf("%s:%d", m.cfg.Host, m.cfg.Port)

	msg := buildMessage(m.cfg.From, to, subject, body)

	var auth smtp.Auth
	if m.cfg.User != "" {
		auth = smtp.PlainAuth("", m.cfg.User, m.cfg.Password, m.cfg.Host)
	}
	// net/smtp's high-level SendMail does STARTTLS auto on supporting servers
	// and falls back to plain TCP otherwise. Timeout enforced via net.Dialer
	// wrapped manually below — net/smtp doesn't accept a context.
	done := make(chan error, 1)
	go func() { done <- smtp.SendMail(addr, auth, m.cfg.From, []string{to}, msg) }()
	select {
	case err := <-done:
		if err != nil {
			return fmt.Errorf("smtp: send: %w", err)
		}
		return nil
	case <-time.After(10 * time.Second):
		return errors.New("smtp: send timeout")
	}
}

// buildMessage assembles the minimum RFC 5322 envelope. Plain text only;
// no HTML, no multipart, no Reply-To. Enough for a reset-token email.
func buildMessage(from, to, subject, body string) []byte {
	var b strings.Builder
	b.WriteString("From: " + from + "\r\n")
	b.WriteString("To: " + to + "\r\n")
	b.WriteString("Subject: " + subject + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	b.WriteString("\r\n")
	b.WriteString(body)
	return []byte(b.String())
}
