import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("AI_SERVICE_TOKEN", "test-token")
# Integration tests use the database configured in backend/.env (Supabase or the
# local dev database); the local default only applies when there is no .env.
if not (Path(__file__).resolve().parents[1] / ".env").exists():
    os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@localhost:54322/priceiq")


def _db_available() -> bool:
    try:
        from app import db
        db.fetch_one("select 1 as ok")
        return db.fetch_one("select count(*) as n from stores where code = 'BLR-KOR'")["n"] > 0
    except Exception:
        return False


DB = _db_available()
requires_db = pytest.mark.skipif(not DB, reason="seeded PriceIQ database not reachable (run backend-go cmd/devdb + migrate + seed)")


@pytest.fixture(scope="session")
def store_id():
    from app import db
    return db.fetch_one("select id::text from stores where code = 'BLR-KOR'")["id"]


@pytest.fixture(scope="session")
def product_id(store_id):
    from app import db
    return db.fetch_one("select id::text from products where store_id = :s and legacy_product_id = 0", s=store_id)["id"]
