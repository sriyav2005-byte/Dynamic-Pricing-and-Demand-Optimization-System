// Command devdb runs a persistent embedded PostgreSQL 16 for local development
// when no Supabase project (or local Postgres install) is available.
//
//	go run ./cmd/devdb            # listens on 127.0.0.1:54322, data in .devdata/pg
//
// Connection string: postgres://postgres:postgres@localhost:54322/priceiq?sslmode=disable
// Afterwards run `go run ./cmd/migrate -local-shim` and `go run ./cmd/seed`.
package main

import (
	"flag"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	ep "github.com/fergusstrange/embedded-postgres"
)

func main() {
	port := flag.Uint("port", 54322, "port to listen on")
	dataDir := flag.String("data", ".devdata/pg", "persistent data directory")
	flag.Parse()

	abs, _ := filepath.Abs(*dataDir)
	home, _ := os.UserHomeDir()
	pg := ep.NewDatabase(ep.DefaultConfig().
		Version(ep.V16).
		Encoding("UTF8").
		Locale("C").
		Port(uint32(*port)).
		Database("priceiq").
		Username("postgres").
		Password("postgres").
		DataPath(filepath.Join(abs, "data")).
		RuntimePath(filepath.Join(abs, "runtime")).
		BinariesPath(filepath.Join(abs, "bin")).
		CachePath(filepath.Join(home, ".cache", "embedded-postgres")))

	if err := pg.Start(); err != nil {
		log.Fatalf("start embedded postgres: %v", err)
	}
	log.Printf("embedded PostgreSQL 16 ready: postgres://postgres:postgres@localhost:%d/priceiq?sslmode=disable", *port)

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	log.Println("stopping embedded postgres…")
	if err := pg.Stop(); err != nil {
		log.Fatalf("stop: %v", err)
	}
}
