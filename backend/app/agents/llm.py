"""
agents/llm.py — language-model provider for the Retail Copilot.

The provider does one thing: send a chat request (messages + tool schemas) to
an OpenAI-compatible endpoint and return the reply. Which tools exist, what
they may read and how an answer is assembled stays in copilot.py / tools.py,
so swapping the provider or model is a configuration change:

    AI_PROVIDER=openrouter    # "none" disables the external LLM
    OPENROUTER_API_KEY=...    # only ever read here, never logged or returned
    AI_MODEL=openrouter/free  # or any model id OpenRouter serves

Failures are raised as LLMError subclasses with messages that are safe to show
to users (no key, no headers, no response body); the copilot turns them into a
rule-based answer. There are deliberately no automatic retries: a failed call
falls back immediately instead of holding the request open.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.config import Settings, get_settings

# provider name → (settings attribute holding the key, settings attribute holding the base URL)
PROVIDERS: dict[str, tuple[str, str]] = {
    "openrouter": ("openrouter_api_key", "openrouter_base_url"),
}
DISABLED = {"", "none", "off", "disabled", "rule_based"}


class LLMError(Exception):
    """Base class; str(exc) is safe to show to the user."""


class LLMRateLimited(LLMError):
    def __init__(self, retry_after: float | None):
        super().__init__("the language-model provider's rate limit was reached")
        self.retry_after = retry_after


class LLMTimeout(LLMError):
    pass


class LLMUnavailable(LLMError):
    pass


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict | None  # None when the model produced arguments that are not a JSON object


@dataclass
class ChatResult:
    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    finish_reason: str = "stop"
    # The assistant turn to append to the conversation (content + tool calls
    # only: provider-specific reasoning fields are dropped, never shown).
    message: dict = field(default_factory=dict)


def to_openai_tools(definitions: list[dict]) -> list[dict]:
    return [{"type": "function", "function": {"name": d["name"], "description": d["description"],
                                              "parameters": d["input_schema"]}} for d in definitions]


class OpenAICompatibleProvider:
    def __init__(self, name: str, base_url: str, api_key: str, model: str, timeout_s: float, max_tokens: int,
                 transport: httpx.AsyncBaseTransport | None = None, extra_headers: dict[str, str] | None = None):
        self.name, self.model = name, model
        self._extra_headers = extra_headers or {}
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._key, self._max_tokens = api_key, max_tokens
        self._timeout = httpx.Timeout(timeout_s, connect=min(10.0, timeout_s))
        self._transport = transport  # tests inject httpx.MockTransport

    async def chat(self, messages: list[dict], tools: list[dict] | None = None) -> ChatResult:
        body: dict[str, Any] = {"model": self.model, "messages": messages, "max_tokens": self._max_tokens, "temperature": 0.2}
        if tools:
            body["tools"], body["tool_choice"] = tools, "auto"
        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
                r = await client.post(self._url, json=body, headers={**self._extra_headers, "Authorization": f"Bearer {self._key}"})
        except httpx.TimeoutException:
            raise LLMTimeout(f"the language-model provider did not answer within {self._timeout.read:.0f}s") from None
        except httpx.HTTPError as exc:
            raise LLMUnavailable(f"the language-model provider could not be reached ({type(exc).__name__})") from None

        if r.status_code == 429:
            raise LLMRateLimited(_retry_after(r))
        if r.status_code in (401, 403):
            raise LLMUnavailable("the language-model provider rejected the API key")
        if r.status_code == 402:
            raise LLMUnavailable("the language-model provider reported insufficient credits (HTTP 402)")
        if r.status_code >= 400:
            raise LLMUnavailable(f"the language-model provider returned HTTP {r.status_code}{_error_code(r)}")
        try:
            data = r.json()
        except Exception:
            raise LLMUnavailable("the language-model provider returned an unreadable response") from None
        # OpenRouter can report an upstream failure inside an HTTP 200: a
        # top-level "error" object, or a choice with an "error" / finish_reason "error".
        try:
            choice = data["choices"][0]
            failed = choice.get("error") or (choice.get("finish_reason") == "error")
            msg = choice["message"]
            if not isinstance(msg, dict):
                raise TypeError
        except Exception:
            if isinstance(data, dict) and data.get("error"):
                raise LLMUnavailable(f"the language-model provider returned an error{_code_of(data['error'])}") from None
            raise LLMUnavailable("the language-model provider returned an unreadable response") from None
        if failed:
            raise LLMUnavailable(f"the selected model failed upstream{_code_of(choice.get('error'))}")

        calls = []
        for c in msg.get("tool_calls") or []:
            fn = c.get("function") or {}
            try:
                args = json.loads(fn.get("arguments") or "{}")
                args = args if isinstance(args, dict) else None
            except ValueError:
                args = None
            calls.append(ToolCall(id=str(c.get("id") or ""), name=str(fn.get("name") or ""), arguments=args))
        text = msg.get("content") or ""
        clean: dict[str, Any] = {"role": "assistant", "content": text}
        if msg.get("tool_calls"):
            clean["tool_calls"] = msg["tool_calls"]
        return ChatResult(text=text.strip(), tool_calls=calls, finish_reason=str(choice.get("finish_reason") or "stop"), message=clean)


def _retry_after(r: httpx.Response) -> float | None:
    try:
        return max(0.0, float(r.headers.get("retry-after", "")))
    except ValueError:
        return None


def _code_of(err: Any) -> str:
    code = err.get("code") if isinstance(err, dict) else None
    return f" ({str(code)[:60]})" if code else ""


def _error_code(r: httpx.Response) -> str:
    """Short machine code from the error body (e.g. model_not_found) — never the body itself."""
    try:
        return _code_of(r.json().get("error"))
    except Exception:
        return ""


def resolve(s: Settings | None = None) -> tuple[OpenAICompatibleProvider | None, str | None]:
    """Returns (provider, None) or (None, reason the LLM is not in use)."""
    s = s or get_settings()
    name = (s.ai_provider or "").strip().lower()
    if name in DISABLED:
        return None, "the external LLM is disabled (AI_PROVIDER=none)"
    if name not in PROVIDERS:
        return None, f"unknown AI_PROVIDER '{name}'"
    key_attr, url_attr = PROVIDERS[name]
    key = (getattr(s, key_attr) or "").strip()
    if not key:
        return None, f"{key_attr.upper()} is not set"
    model = (s.ai_model or "").strip()
    if not model:
        return None, "AI_MODEL is not set"
    headers = {}
    if name == "openrouter":  # optional app attribution; never anything sensitive
        if s.openrouter_site_url.strip():
            headers["HTTP-Referer"] = s.openrouter_site_url.strip()
        if s.openrouter_app_name.strip():
            headers["X-Title"] = s.openrouter_app_name.strip()
    return OpenAICompatibleProvider(name, getattr(s, url_attr), key, model, s.ai_timeout_s, s.ai_max_tokens,
                                    extra_headers=headers), None


def status(s: Settings | None = None) -> dict:
    """What /health and /v1/models report. Contains no secret."""
    provider, reason = resolve(s)
    if provider is None:
        return {"mode": "rule_based", "provider": None, "model": None, "reason": reason}
    return {"mode": "llm", "provider": provider.name, "model": provider.model, "reason": None}


# After a 429 the provider is left alone until the window it asked for has
# passed (capped), so a busy store does not burn its remaining quota on calls
# that are certain to fail. Per process, like the rest of the in-memory state.
_cooldown_until = 0.0
MAX_COOLDOWN_S = 300.0


def note_rate_limit(retry_after: float | None) -> None:
    global _cooldown_until
    _cooldown_until = time.monotonic() + min(retry_after if retry_after is not None else 30.0, MAX_COOLDOWN_S)


def cooling_down() -> bool:
    return time.monotonic() < _cooldown_until


def reset_cooldown() -> None:
    global _cooldown_until
    _cooldown_until = 0.0
