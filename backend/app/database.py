"""
database.py — SQLAlchemy Database Configuration
================================================
Sets up the SQLAlchemy engine and session factory.

Currently uses SQLite for simplicity (no separate server needed).
To upgrade to PostgreSQL, just change the DATABASE_URL env variable:
    DATABASE_URL=postgresql://user:password@localhost:5432/pricing

All ORM models inherit from `Base`. Tables are created at startup
via `Base.metadata.create_all(bind=engine)` in main.py.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
import os
from dotenv import load_dotenv

# Load values from backend/.env file
load_dotenv()

# Read DATABASE_URL from environment; fall back to local SQLite file
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./pricing.db")

# SQLite requires check_same_thread=False because FastAPI may access
# the same connection from different async worker threads.
connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

# Create the engine — this is the core connection pool to the database
engine = create_engine(DATABASE_URL, connect_args=connect_args)

# SessionLocal is a factory for database sessions.
# autocommit=False means we control transactions manually (db.commit()).
# autoflush=False prevents SQLAlchemy from auto-sending pending changes.
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# Base class for all ORM models.
# Each model (Product, Sale) will inherit from this.
class Base(DeclarativeBase):
    pass


def get_db():
    """
    FastAPI dependency that yields a database session per request.

    Usage in a route:
        @router.get("/")
        def my_route(db: Session = Depends(get_db)):
            ...

    The `finally` block ensures the session is always closed,
    even if an exception occurs during the request.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
