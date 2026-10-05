"""Convenience launcher: python run.py  (equivalent to `uvicorn app.main:app --port 8000`).

The AI service is internal: it binds to loopback only and is reached through
the Go API. No auto-reload — the reloader's event loop cannot spawn the
Playwright browser on Windows.
"""

import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=False)
