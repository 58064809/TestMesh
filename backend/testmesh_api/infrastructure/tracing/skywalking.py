from __future__ import annotations

import re
from typing import Any
from urllib.parse import quote

import httpx

TRACE_ID = re.compile(r"^[A-Za-z0-9._:-]{8,256}$")
MAX_TRACE_BYTES = 5 * 1024 * 1024


class SkyWalkingTraceReader:
    """Reads one trace through SkyWalking's official TraceQL/Tempo-compatible v2 API."""

    def __init__(self, query_base_url: str, headers: dict[str, str] | None = None,
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._client = httpx.AsyncClient(
            base_url=query_base_url.rstrip("/"), headers=headers, transport=transport, follow_redirects=False
        )

    async def __aenter__(self) -> "SkyWalkingTraceReader":
        await self._client.__aenter__()
        return self

    async def __aexit__(self, exc_type: object, exc: object, traceback: object) -> None:
        await self._client.__aexit__(exc_type, exc, traceback)

    async def get_trace(self, trace_id: str) -> dict[str, Any]:
        if not TRACE_ID.fullmatch(trace_id):
            raise ValueError("Trace ID 格式不合法")
        response = await self._client.get(
            f"/api/v2/traces/{quote(trace_id, safe='')}", headers={"accept": "application/json"}, timeout=15
        )
        response.raise_for_status()
        if len(response.content) > MAX_TRACE_BYTES:
            raise ValueError("调用链结果超过 5 MB 安全上限")
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("SkyWalking Trace 响应不是 JSON 对象")
        return payload
