from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class HttpResponseData:
    status_code: int
    headers: dict[str, str]
    text: str
    json_body: Any | None
    duration_ms: float


class HttpClient(Protocol):
    async def request(self, method: str, path: str, *, query: dict[str, Any], headers: dict[str, Any],
                      json_body: Any | None, form: dict[str, Any] | None, text: str | None,
                      timeout_ms: int) -> HttpResponseData: ...


class ResponseExtractor(Protocol):
    def extract(self, capture_type: str, expression: str | None, response: HttpResponseData,
                mode: str = "first", group: int = 1) -> Any: ...


@dataclass(frozen=True)
class DatabaseConnection:
    provider: str
    host: str
    port: int
    database: str
    username: str
    password: str


class DatabaseQueryRunner(Protocol):
    async def query(self, connection: DatabaseConnection, sql: str, params: dict[str, Any],
                    timeout_ms: int, max_rows: int) -> list[dict[str, Any]]: ...


class TraceReader(Protocol):
    async def get_trace(self, trace_id: str) -> dict[str, Any]: ...


class EvidenceProvider(Protocol):
    async def load(self, source: Any, context: dict[str, Any]) -> Any: ...


class ValueExtractor(Protocol):
    def extract(self, value: Any, extraction_type: str, expression: str | None,
                mode: str = "first", group: int = 1) -> Any: ...
