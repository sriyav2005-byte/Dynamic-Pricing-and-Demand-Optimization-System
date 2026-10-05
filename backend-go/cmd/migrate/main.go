// Command migrate applies supabase/migrations to DATABASE_URL.
//
//	go run ./cmd/migrate              # Supabase or any Postgres that already has auth.*
//	go run ./cmd/migrate -local-shim  # plain Postgres: install the auth shim first
package main

import (
	"context"
	"flag"
	"log"
	"os"
	"path/filepath"

	"github.com/joho/godotenv"

	"github.com/rishabh26raj/priceiq/backend-go/database"
)

func main() {
	shim := flag.Bool("local-shim", false, "apply supabase/local/00_auth_shim.sql first (NEVER on Supabase)")
	dir := flag.String("dir", "", "migrations directory (default $MIGRATIONS_DIR or ../supabase/migrations)")
	flag.Parse()
	_ = godotenv.Load()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is required")
	}
	migDir := *dir
	if migDir == "" {
		migDir = os.Getenv("MIGRATIONS_DIR")
	}
	if migDir == "" {
		migDir = "../supabase/migrations"
	}

	ctx := context.Background()
	db, err := database.Connect(ctx, dsn, 2)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	if *shim {
		path := filepath.Join(filepath.Dir(migDir), "local", "00_auth_shim.sql")
		if err := db.ApplyFile(ctx, path); err != nil {
			log.Fatalf("auth shim: %v", err)
		}
		log.Println("local auth shim applied")
	}
	applied, err := db.Migrate(ctx, migDir)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("%d migration(s) applied", len(applied))
}
