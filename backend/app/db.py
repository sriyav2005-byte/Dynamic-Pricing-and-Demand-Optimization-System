"""
db.py — database access for the AI service.

The AI service connects with the service (owner) role. It never takes
tenant decisions itself: the Go API authorizes every request (RBAC + RLS)
before calling it with explicit store/product ids, and every query here is
filtered by those ids.

Round trips matter: with a hosted database (Supabase) every statement costs a
network round trip, and one recommendation issues ~20 queries. So
  * reads run in AUTOCOMMIT — one round trip per query instead of
    BEGIN + query + ROLLBACK;
  * there is no pre-ping on checkout; connections are recycled before the
    pooler's idle timeout, and a read that still hits a dead connection is
    retried once on a fresh one.
Writes keep real transactions (transaction() / execute()) and are not retried.
"""

from contextlib import contextmanager
from typing import Any, Callable, Iterator, TypeVar

import pandas as pd
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import DBAPIError

from app.config import get_settings

T = TypeVar("T")
_engine: Engine | None = None
_reads: Engine | None = None


def engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(
            get_settings().sqlalchemy_url,
            pool_size=5,
            max_overflow=5,
            pool_recycle=240,
            connect_args={"client_encoding": "utf8"},
        )
    return _engine


def _read_engine() -> Engine:
    global _reads
    if _reads is None:  # same connection pool, different transaction behaviour
        _reads = engine().execution_options(isolation_level="AUTOCOMMIT")
    return _reads


@contextmanager
def connect() -> Iterator[Connection]:
    """Read-only use: statements are not wrapped in a transaction."""
    with _read_engine().connect() as conn:
        yield conn


@contextmanager
def transaction() -> Iterator[Connection]:
    with engine().begin() as conn:
        yield conn


def _read(fn: Callable[[], T]) -> T:
    try:
        return fn()
    except DBAPIError as exc:
        if not exc.connection_invalidated:
            raise
        return fn()  # the pool dropped the dead connection; one retry on a fresh one


def fetch_all(sql: str, **params: Any) -> list[dict]:
    def run() -> list[dict]:
        with connect() as c:
            return [dict(r._mapping) for r in c.execute(text(sql), params)]
    return _read(run)


def fetch_one(sql: str, **params: Any) -> dict | None:
    def run() -> dict | None:
        with connect() as c:
            row = c.execute(text(sql), params).first()
            return dict(row._mapping) if row else None
    return _read(run)


def fetch_df(sql: str, **params: Any) -> pd.DataFrame:
    def run() -> pd.DataFrame:
        with connect() as c:
            return pd.read_sql(text(sql), c, params=params)
    return _read(run)


def execute(sql: str, **params: Any) -> None:
    with transaction() as c:
        c.execute(text(sql), params)
