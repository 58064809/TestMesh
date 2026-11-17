from __future__ import annotations

import json
import time
from typing import Any

import httpx

from ...application.api_automation.ports import HttpResponseData

MAX_RESPONSE_BYTES = 2 * 1024 * 1024


class HttpxApiClient:
    def __init__(self, base_url: str, shared_headers: dict[str, str] | None = None,
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"), headers=shared_headers, transport=transport, follow_redirects=False
        )

    async def __aenter__(self) -> "HttpxApiClient":
        await self._client.__aenter__()
        return self

    async def __aexit__(self, exc_type: object, exc: object, traceback: object) -> None:
        await self._client.__aexit__(exc_type, exc, traceback)

    async def request(self, method: str, path: str, *, query: dict[str, Any], headers: dict[str, Any],
                      json_body: Any | None, form: dict[str, Any] | None, text: str | None,
                      timeout_ms: int) -> HttpResponseData:
        kwargs: dict[str, Any] = {"params": query, "headers": headers, "timeout": timeout_ms / 1000}
        if json_body is not None:
            kwargs["json"] = json_body
        elif form is not None:
            kwargs["data"] = form
        elif text is not None:
            kwargs["content"] = text
        started = time.perf_counter()
        response = await self._client.request(method, path, **kwargs)
        duration_ms = (time.perf_counter() - started) * 1000
        if len(response.content) > MAX_RESPONSE_BYTES:
            raise ValueError("响应体超过 2 MB 安全上限")
        try:
            json_body_value = json.loads(response.text)
        except json.JSONDecodeError:
            json_body_value = None
        return HttpResponseData(
            status_code=response.status_code,
            headers={name.lower(): value for name, value in response.headers.items()},
            text=response.text,
            json_body=json_body_value,
            duration_ms=duration_ms,
        )
