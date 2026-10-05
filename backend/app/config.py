"""
config.py — AI service settings (environment variables / backend/.env).

The AI service is an *internal* service: the Go API is its only client.
Every request must carry X-Internal-Token = AI_SERVICE_TOKEN.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    database_url: str = Field(..., alias="DATABASE_URL")
    ai_service_token: str = Field(..., alias="AI_SERVICE_TOKEN")
    go_api_url: str = Field("http://localhost:8080", alias="GO_API_URL")

    models_dir: Path = Field(REPO_ROOT / "models", alias="MODELS_DIR")
    dataset_path: Path = Field(REPO_ROOT / "data" / "priceiq_synthetic_daily.csv", alias="DATASET_PATH")

    # Pricing policy: "model_ts" (model-informed Thompson Sampling — the
    # production default) or "contextual_ts" (linear Thompson Sampling, runs in
    # shadow mode until validated and switched on here).
    pricing_policy: str = Field("model_ts", alias="PRICING_POLICY")

    # LLM (Retail Copilot) — see agents/llm.py. All three of provider, key and
    # model must be set for LLM mode; otherwise (or when the provider fails)
    # the deterministic rule-based assistant answers from the same tools.
    # AI_MODEL has no default in code on purpose: the model is always an
    # explicit choice in backend/.env (.env.example uses the openrouter/free
    # router, which picks an available free model per request).
    ai_provider: str = Field("openrouter", alias="AI_PROVIDER")  # "none" disables the external LLM
    openrouter_api_key: str | None = Field(None, alias="OPENROUTER_API_KEY")
    openrouter_base_url: str = Field("https://openrouter.ai/api/v1", alias="OPENROUTER_BASE_URL")
    # Optional attribution headers (HTTP-Referer / X-Title). Public values only.
    openrouter_site_url: str = Field("", alias="OPENROUTER_SITE_URL")
    openrouter_app_name: str = Field("PriceIQ", alias="OPENROUTER_APP_NAME")
    ai_model: str = Field("", alias="AI_MODEL")
    ai_timeout_s: float = Field(30.0, alias="AI_TIMEOUT_S")      # one LLM request
    # Whole LLM answer (all tool rounds). Must stay well below the Go API's
    # AI_TIMEOUT so a slow model ends in a rule-based answer, not an error.
    ai_budget_s: float = Field(40.0, alias="AI_BUDGET_S")
    ai_max_tokens: int = Field(2048, alias="AI_MAX_TOKENS")

    # Optional hosted embeddings for RAG; default is a local hashing embedder.
    voyage_api_key: str | None = Field(None, alias="VOYAGE_API_KEY")

    # Competitor fetching
    playwright_enabled: bool = Field(True, alias="PLAYWRIGHT_ENABLED")
    scrape_timeout_s: float = Field(35.0, alias="SCRAPE_TIMEOUT_S")
    store_lat: float = Field(12.9716, alias="DEFAULT_LAT")
    store_lon: float = Field(77.5946, alias="DEFAULT_LON")

    @property
    def sqlalchemy_url(self) -> str:
        url = self.database_url
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
