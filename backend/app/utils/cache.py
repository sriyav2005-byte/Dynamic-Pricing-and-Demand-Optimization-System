"""utils/cache.py — tiny thread-safe TTL memoization for expensive computations."""

from __future__ import annotations

import functools
import threading
import time
from typing import Any, Callable


def ttl_cache(seconds: float) -> Callable:
    def deco(fn: Callable) -> Callable:
        store: dict[Any, tuple[float, Any]] = {}
        lock = threading.Lock()

        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            key = (args, tuple(sorted(kwargs.items())))
            now = time.monotonic()
            with lock:
                hit = store.get(key)
                if hit and now - hit[0] < seconds:
                    return hit[1]
            val = fn(*args, **kwargs)
            with lock:
                store[key] = (now, val)
                if len(store) > 512:  # bound memory
                    for k, _ in sorted(store.items(), key=lambda kv: kv[1][0])[:128]:
                        store.pop(k, None)
            return val

        def clear() -> None:
            with lock:
                store.clear()

        wrapper.cache_clear = clear  # type: ignore[attr-defined]
        return wrapper

    return deco
