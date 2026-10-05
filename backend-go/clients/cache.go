// Package clients contains adapters for external systems: Redis (cache,
// rate limiting, locks) and the Python AI service.
package clients

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// ErrCacheMiss is returned by Get when the key does not exist.
var ErrCacheMiss = errors.New("cache miss")

// Cache is the subset of Redis behaviour the API relies on. When REDIS_URL is
// not configured an in-process implementation is used (single instance only).
type Cache interface {
	Get(ctx context.Context, key string) ([]byte, error)
	Set(ctx context.Context, key string, val []byte, ttl time.Duration) error
	Delete(ctx context.Context, keys ...string) error
	// Incr increments a counter, setting ttl when the key is created.
	Incr(ctx context.Context, key string, ttl time.Duration) (int64, error)
	// Lock acquires a best-effort lock (SET NX). Returns false when held.
	Lock(ctx context.Context, key string, ttl time.Duration) (bool, error)
	Ping(ctx context.Context) error
	Kind() string
	Close() error
}

// NewCache returns a Redis cache when url is set, otherwise an in-memory one.
func NewCache(url string) (Cache, error) {
	if url == "" {
		return newMemoryCache(), nil
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	c := &redisCache{rdb: redis.NewClient(opts)}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := c.Ping(ctx); err != nil {
		return nil, err
	}
	return c, nil
}

// GetJSON / SetJSON are typed helpers.
func GetJSON(ctx context.Context, c Cache, key string, dst any) bool {
	b, err := c.Get(ctx, key)
	if err != nil {
		return false
	}
	return json.Unmarshal(b, dst) == nil
}

func SetJSON(ctx context.Context, c Cache, key string, v any, ttl time.Duration) {
	if b, err := json.Marshal(v); err == nil {
		_ = c.Set(ctx, key, b, ttl)
	}
}

// ── Redis ───────────────────────────────────────────────────────────────────

type redisCache struct{ rdb *redis.Client }

func (r *redisCache) Get(ctx context.Context, key string) ([]byte, error) {
	b, err := r.rdb.Get(ctx, key).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, ErrCacheMiss
	}
	return b, err
}

func (r *redisCache) Set(ctx context.Context, key string, val []byte, ttl time.Duration) error {
	return r.rdb.Set(ctx, key, val, ttl).Err()
}

func (r *redisCache) Delete(ctx context.Context, keys ...string) error {
	var exact []string
	for _, k := range keys {
		if !strings.HasSuffix(k, "*") {
			exact = append(exact, k)
			continue
		}
		// Prefix delete, used for invalidation.
		iter := r.rdb.Scan(ctx, 0, k, 200).Iterator()
		for iter.Next(ctx) {
			exact = append(exact, iter.Val())
		}
		if err := iter.Err(); err != nil {
			return err
		}
	}
	if len(exact) == 0 {
		return nil
	}
	return r.rdb.Del(ctx, exact...).Err()
}

func (r *redisCache) Incr(ctx context.Context, key string, ttl time.Duration) (int64, error) {
	pipe := r.rdb.TxPipeline()
	incr := pipe.Incr(ctx, key)
	pipe.ExpireNX(ctx, key, ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, err
	}
	return incr.Val(), nil
}

func (r *redisCache) Lock(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	return r.rdb.SetNX(ctx, key, "1", ttl).Result()
}

func (r *redisCache) Ping(ctx context.Context) error { return r.rdb.Ping(ctx).Err() }
func (r *redisCache) Kind() string                   { return "redis" }
func (r *redisCache) Close() error                   { return r.rdb.Close() }

// ── In-memory fallback ──────────────────────────────────────────────────────

type memEntry struct {
	val     []byte
	expires time.Time
}

type memoryCache struct {
	mu   sync.Mutex
	data map[string]memEntry
}

func newMemoryCache() *memoryCache {
	m := &memoryCache{data: map[string]memEntry{}}
	go m.janitor()
	return m
}

func (m *memoryCache) janitor() {
	t := time.NewTicker(time.Minute)
	for range t.C {
		now := time.Now()
		m.mu.Lock()
		for k, e := range m.data {
			if !e.expires.IsZero() && now.After(e.expires) {
				delete(m.data, k)
			}
		}
		m.mu.Unlock()
	}
}

func (m *memoryCache) get(key string) (memEntry, bool) {
	e, ok := m.data[key]
	if ok && !e.expires.IsZero() && time.Now().After(e.expires) {
		delete(m.data, key)
		return memEntry{}, false
	}
	return e, ok
}

func (m *memoryCache) Get(_ context.Context, key string) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if e, ok := m.get(key); ok {
		return e.val, nil
	}
	return nil, ErrCacheMiss
}

func (m *memoryCache) Set(_ context.Context, key string, val []byte, ttl time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	e := memEntry{val: val}
	if ttl > 0 {
		e.expires = time.Now().Add(ttl)
	}
	m.data[key] = e
	return nil
}

func (m *memoryCache) Delete(_ context.Context, keys ...string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, k := range keys {
		if strings.HasSuffix(k, "*") { // prefix delete, used for invalidation
			p := strings.TrimSuffix(k, "*")
			for kk := range m.data {
				if strings.HasPrefix(kk, p) {
					delete(m.data, kk)
				}
			}
			continue
		}
		delete(m.data, k)
	}
	return nil
}

func (m *memoryCache) Incr(_ context.Context, key string, ttl time.Duration) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.get(key)
	var n int64
	if ok {
		_ = json.Unmarshal(e.val, &n)
	} else if ttl > 0 {
		e.expires = time.Now().Add(ttl)
	}
	n++
	e.val, _ = json.Marshal(n)
	m.data[key] = e
	return n, nil
}

func (m *memoryCache) Lock(_ context.Context, key string, ttl time.Duration) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.get(key); ok {
		return false, nil
	}
	m.data[key] = memEntry{val: []byte("1"), expires: time.Now().Add(ttl)}
	return true, nil
}

func (m *memoryCache) Ping(context.Context) error { return nil }
func (m *memoryCache) Kind() string               { return "memory" }
func (m *memoryCache) Close() error               { return nil }

// ── Store-scoped cache versioning ───────────────────────────────────────────
// Cached analytics embed a per-store version number; any write bumps it,
// which invalidates every cached result for that store without key scans.

func StoreVersion(ctx context.Context, c Cache, storeID string) string {
	b, err := c.Get(ctx, "ver:"+storeID)
	if err != nil {
		return "0"
	}
	return string(b)
}

func BumpStoreVersion(ctx context.Context, c Cache, storeID string) {
	n, err := c.Incr(ctx, "vercounter:"+storeID, 0)
	if err != nil {
		return
	}
	b, _ := json.Marshal(n)
	_ = c.Set(ctx, "ver:"+storeID, b, 0)
}
