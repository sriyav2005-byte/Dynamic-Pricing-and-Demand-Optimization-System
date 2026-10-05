package clients

import (
	"fmt"
	"net/smtp"
	"strings"
	"time"
)

// Mailer sends plain-text e-mail over SMTP. It is disabled unless SMTP_HOST
// and SMTP_FROM are configured, in which case alert e-mails are skipped.
type Mailer struct {
	Host, Port, User, Password, From string
}

func (m *Mailer) Enabled() bool { return m != nil && m.Host != "" && m.From != "" }

func (m *Mailer) Send(to, subject, body string) error {
	if !m.Enabled() {
		return fmt.Errorf("mailer not configured")
	}
	if strings.ContainsAny(to+subject, "\r\n") {
		return fmt.Errorf("invalid header value")
	}
	port := m.Port
	if port == "" {
		port = "587"
	}
	msg := "From: " + m.From + "\r\nTo: " + to + "\r\nSubject: " + subject +
		"\r\nDate: " + time.Now().Format(time.RFC1123Z) +
		"\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n" + body + "\r\n"
	var auth smtp.Auth
	if m.User != "" {
		auth = smtp.PlainAuth("", m.User, m.Password, m.Host)
	}
	return smtp.SendMail(m.Host+":"+port, auth, m.From, []string{to}, []byte(msg))
}
