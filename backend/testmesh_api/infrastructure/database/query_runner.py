from __future__ import annotations

import re
from typing import Any

import asyncmy
import sqlglot
from asyncmy.cursors import DictCursor
from psycopg import AsyncConnection
from psycopg.rows import dict_row
from sqlglot import expressions as exp

from ...application.api_automation.ports import DatabaseConnection

PARAMETER = re.compile(r":([A-Za-z_][A-Za-z0-9_]*)")
FORBIDDEN = (exp.Insert, exp.Update, exp.Delete, exp.Create, exp.Drop, exp.Alter, exp.Command, exp.Merge)


def validate_read_only_sql(sql: str, dialect: str) -> None:
    try:
        statements = sqlglot.parse(sql, read=dialect)
    except sqlglot.errors.ParseError as error:
        raise ValueError(f"SQL 语法错误：{error}") from error
    if len(statements) != 1 or statements[0] is None:
        raise ValueError("查询模板只能包含一条 SQL")
    statement = statements[0]
    if not isinstance(statement, exp.Query) or any(statement.find(kind) is not None for kind in FORBIDDEN):
        raise ValueError("查询模板只允许 SELECT/WITH，不允许写入或管理语句")


class PgMysqlQueryRunner:
    async def query(self, connection: DatabaseConnection, sql: str, params: dict[str, Any],
                    timeout_ms: int = 10_000, max_rows: int = 1_000) -> list[dict[str, Any]]:
        if connection.provider == "postgresql":
            validate_read_only_sql(sql, "postgres")
            return await self._postgresql(connection, sql, params, timeout_ms, max_rows)
        if connection.provider == "mysql":
            validate_read_only_sql(sql, "mysql")
            return await self._mysql(connection, sql, params, timeout_ms, max_rows)
        raise ValueError(f"暂不支持数据库类型：{connection.provider}")

    async def _postgresql(self, config: DatabaseConnection, sql: str, params: dict[str, Any],
                          timeout_ms: int, max_rows: int) -> list[dict[str, Any]]:
        compiled = PARAMETER.sub(lambda match: f"%({match.group(1)})s", sql)
        async with await AsyncConnection.connect(
            host=config.host, port=config.port, dbname=config.database,
            user=config.username, password=config.password, row_factory=dict_row,
            options=f"-c default_transaction_read_only=on -c statement_timeout={timeout_ms}",
        ) as connection:
            async with connection.cursor() as cursor:
                await cursor.execute(compiled, params)
                rows = await cursor.fetchmany(max_rows + 1)
        if len(rows) > max_rows:
            raise ValueError(f"数据库结果超过 {max_rows} 行上限")
        return [dict(row) for row in rows]

    async def _mysql(self, config: DatabaseConnection, sql: str, params: dict[str, Any],
                     timeout_ms: int, max_rows: int) -> list[dict[str, Any]]:
        names = PARAMETER.findall(sql)
        missing = [name for name in names if name not in params]
        if missing:
            raise ValueError(f"SQL 缺少参数：{', '.join(sorted(set(missing)))}")
        compiled = PARAMETER.sub("%s", sql)
        connection = await asyncmy.connect(
            host=config.host, port=config.port, db=config.database,
            user=config.username, password=config.password, autocommit=False,
        )
        try:
            async with connection.cursor(cursor=DictCursor) as cursor:
                await cursor.execute(f"SET SESSION MAX_EXECUTION_TIME={int(timeout_ms)}")
                await cursor.execute("START TRANSACTION READ ONLY")
                await cursor.execute(compiled, tuple(params[name] for name in names))
                rows = await cursor.fetchmany(max_rows + 1)
            await connection.rollback()
        finally:
            connection.close()
        if len(rows) > max_rows:
            raise ValueError(f"数据库结果超过 {max_rows} 行上限")
        return [dict(row) for row in rows]
