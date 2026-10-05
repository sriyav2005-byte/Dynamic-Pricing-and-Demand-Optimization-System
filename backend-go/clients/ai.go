package clients

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// AIClient calls the Python/FastAPI AI service. Every request carries the
// shared X-Internal-Token; copilot requests additionally forward the end
// user's bearer token so the AI's tools call back into this API *as that
// user* (and are therefore subject to the same RBAC/RLS).
type AIClient struct {
	baseURL string
	token   string
	http    *http.Client
}

// AIError is a non-2xx response from the AI service.
type AIError struct {
	Status int
	Detail string
}

func (e *AIError) Error() string { return fmt.Sprintf("ai service %d: %s", e.Status, e.Detail) }

// ErrAIUnavailable means the AI service could not be reached.
var ErrAIUnavailable = errors.New("ai service unavailable")

func NewAIClient(baseURL, token string, timeout time.Duration) *AIClient {
	return &AIClient{
		baseURL: baseURL,
		token:   token,
		http: &http.Client{
			Timeout: timeout,
			Transport: &http.Transport{
				MaxIdleConns:        50,
				MaxIdleConnsPerHost: 50,
				IdleConnTimeout:     90 * time.Second,
			},
		},
	}
}

// Post sends body as JSON and decodes the JSON response into out.
func (a *AIClient) Post(ctx context.Context, path string, body, out any, userToken string) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	return a.do(ctx, http.MethodPost, path, bytes.NewReader(b), out, userToken)
}

// Get performs a GET with query parameters.
func (a *AIClient) Get(ctx context.Context, path string, q url.Values, out any) error {
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	return a.do(ctx, http.MethodGet, path, nil, out, "")
}

func (a *AIClient) do(ctx context.Context, method, path string, body io.Reader, out any, userToken string) error {
	req, err := http.NewRequestWithContext(ctx, method, a.baseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Token", a.token)
	if userToken != "" {
		req.Header.Set("X-User-Authorization", "Bearer "+userToken)
	}
	resp, err := a.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("%w: %v", ErrAIUnavailable, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode >= 300 {
		var e struct {
			Detail any `json:"detail"`
		}
		detail := string(raw)
		if json.Unmarshal(raw, &e) == nil && e.Detail != nil {
			if s, ok := e.Detail.(string); ok {
				detail = s
			} else {
				d, _ := json.Marshal(e.Detail)
				detail = string(d)
			}
		}
		return &AIError{Status: resp.StatusCode, Detail: detail}
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(raw, out)
}

// Health returns nil when the AI service responds.
func (a *AIClient) Health(ctx context.Context) error {
	return a.do(ctx, http.MethodGet, "/health", nil, nil, "")
}
