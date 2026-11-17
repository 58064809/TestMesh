from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from ...application.api_automation.ports import DatabaseConnection, DatabaseQueryRunner
from ...domain.api_automation.models import DatabaseEvidenceSource, TraceEvidenceSource
from ..tracing.skywalking import SkyWalkingTraceReader


@dataclass(frozen=True)
class DatabaseQueryConfig:
    provider: str
    host: str
    port: int
    database: str
    username: str
    password_secret_ref: str
    sql: str
    timeout_ms: int = 10_000
    max_rows: int = 1_000


@dataclass(frozen=True)
class TraceProviderConfig:
    query_base_url: str
    auth_secret_ref: str = ""


class EvidenceConfigRepository(Protocol):
    async def get_database_query(self, data_source_id: str, query_id: str) -> DatabaseQueryConfig: ...
    async def get_trace_provider(self, provider_id: str) -> TraceProviderConfig: ...


class SecretResolver(Protocol):
    async def resolve(self, reference: str) -> str: ...


class ProjectEvidenceProvider:
    def __init__(self, configs: EvidenceConfigRepository, secrets: SecretResolver,
                 database: DatabaseQueryRunner) -> None:
        self.configs = configs
        self.secrets = secrets
        self.database = database

    async def load(self, source: Any, context: dict[str, Any]) -> Any:
        del context
        if isinstance(source, DatabaseEvidenceSource):
            config = await self.configs.get_database_query(source.data_source_id, source.query_id)
            password = await self.secrets.resolve(config.password_secret_ref)
            connection = DatabaseConnection(
                config.provider, config.host, config.port, config.database, config.username, password
            )
            return await self.database.query(
                connection, config.sql, source.params, config.timeout_ms, config.max_rows
            )
        if isinstance(source, TraceEvidenceSource):
            config = await self.configs.get_trace_provider(source.provider_id)
            headers: dict[str, str] = {}
            if config.auth_secret_ref:
                headers["authorization"] = await self.secrets.resolve(config.auth_secret_ref)
            async with SkyWalkingTraceReader(config.query_base_url, headers) as reader:
                return await reader.get_trace(str(source.trace_id))
        raise ValueError("不支持的证据数据源")
