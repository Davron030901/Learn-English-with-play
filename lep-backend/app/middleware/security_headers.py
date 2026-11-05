"""Security headers for a JSON API.

Set only when the application has not set them itself. ``Cache-Control: no-store`` is
the default because most responses carry personal data; the content endpoints of
Phase 2 set their own ETag and Cache-Control.
"""

from __future__ import annotations

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_API_CSP = "default-src 'none'; frame-ancestors 'none'"
#: Swagger UI loads its script and stylesheet from a CDN, so /docs gets no CSP.
_DOCS_PREFIX = "/docs"


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp, *, hsts: bool) -> None:
        self.app = app
        self.hsts = hsts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        is_docs = str(scope["path"]).startswith(_DOCS_PREFIX)

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.setdefault("x-content-type-options", "nosniff")
                headers.setdefault("referrer-policy", "no-referrer")
                headers.setdefault("x-frame-options", "DENY")
                headers.setdefault("cache-control", "no-store")
                if not is_docs:
                    headers.setdefault("content-security-policy", _API_CSP)
                if self.hsts:
                    headers.setdefault(
                        "strict-transport-security", "max-age=63072000; includeSubDomains"
                    )
            await send(message)

        await self.app(scope, receive, send_with_headers)
