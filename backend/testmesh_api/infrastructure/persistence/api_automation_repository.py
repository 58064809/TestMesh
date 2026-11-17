from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict
from typing import Any
from uuid import uuid4

from psycopg import AsyncConnection
from psycopg.rows import dict_row

from ...domain.api_automation.results import RunResult


class ApiAutomationRepository:
    def __init__(self, connection_string: str, schema: str = "testmesh_business") -> None:
        if not schema.replace("_", "").isalnum() or not schema[0].isalpha():
            raise ValueError("PostgreSQL Schema 名称不合法")
        self.connection_string = connection_string
        self.schema = schema

    @classmethod
    def from_environment(cls) -> "ApiAutomationRepository":
        password = os.environ.get("PG_LOCAL_PASSWORD", "")
        if not password:
            raise ValueError("缺少 PG_LOCAL_PASSWORD，无法连接 TestMesh PostgreSQL")
        connection_string = (
            f"host={os.environ.get('PGHOST', '127.0.0.1')} port={os.environ.get('PGPORT', '5432')} "
            f"dbname={os.environ.get('PGDATABASE', 'testmesh')} user={os.environ.get('PGUSER', 'postgres')} password={password}"
        )
        return cls(connection_string, os.environ.get("TESTMESH_BUSINESS_SCHEMA", "testmesh_business"))

    async def setup(self) -> None:
        async with await AsyncConnection.connect(self.connection_string) as connection:
            await connection.execute(f"""
                CREATE TABLE IF NOT EXISTS {self.schema}.api_yaml_scenarios (
                  id TEXT PRIMARY KEY,
                  project_id TEXT NOT NULL REFERENCES {self.schema}.projects(id) ON DELETE RESTRICT,
                  environment_id TEXT NOT NULL REFERENCES {self.schema}.project_environments(id) ON DELETE RESTRICT,
                  approved_version_id TEXT NOT NULL REFERENCES {self.schema}.approved_test_case_versions(id) ON DELETE RESTRICT,
                  approved_test_case_ids JSONB NOT NULL,
                  parent_scenario_id TEXT REFERENCES {self.schema}.api_yaml_scenarios(id) ON DELETE RESTRICT,
                  name TEXT NOT NULL,
                  yaml_content TEXT NOT NULL,
                  content_sha256 TEXT NOT NULL,
                  status TEXT NOT NULL CHECK (status IN ('draft', 'approved')),
                  created_by TEXT NOT NULL,
                  change_reason TEXT NOT NULL,
                  approved_by TEXT NOT NULL DEFAULT '',
                  approved_at TIMESTAMPTZ,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS {self.schema}.api_yaml_runs (
                  id TEXT PRIMARY KEY,
                  scenario_id TEXT NOT NULL REFERENCES {self.schema}.api_yaml_scenarios(id) ON DELETE RESTRICT,
                  project_id TEXT NOT NULL REFERENCES {self.schema}.projects(id) ON DELETE RESTRICT,
                  environment_id TEXT NOT NULL REFERENCES {self.schema}.project_environments(id) ON DELETE RESTRICT,
                  approved_version_id TEXT NOT NULL REFERENCES {self.schema}.approved_test_case_versions(id) ON DELETE RESTRICT,
                  approved_test_case_ids JSONB NOT NULL,
                  status TEXT NOT NULL,
                  passed INTEGER NOT NULL,
                  failed INTEGER NOT NULL,
                  variables_json JSONB NOT NULL,
                  items_json JSONB NOT NULL,
                  data_cases_json JSONB NOT NULL DEFAULT '[]'::jsonb,
                  started_at TIMESTAMPTZ NOT NULL,
                  finished_at TIMESTAMPTZ NOT NULL,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS api_yaml_scenarios_project_idx
                  ON {self.schema}.api_yaml_scenarios(project_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS api_yaml_runs_project_idx
                  ON {self.schema}.api_yaml_runs(project_id, started_at DESC);
                ALTER TABLE {self.schema}.api_yaml_runs
                  ADD COLUMN IF NOT EXISTS data_cases_json JSONB NOT NULL DEFAULT '[]'::jsonb;
            """)

    async def create_draft(self, *, project_id: str, environment_id: str, approved_version_id: str,
                           approved_test_case_ids: list[str], name: str, yaml_content: str,
                           created_by: str, change_reason: str, parent_scenario_id: str | None) -> dict[str, Any]:
        await self.setup()
        async with await AsyncConnection.connect(self.connection_string, row_factory=dict_row) as connection:
            environment = await (await connection.execute(
                f"SELECT base_url, headers_json, variables_json FROM {self.schema}.project_environments WHERE id=%s AND project_id=%s",
                (environment_id, project_id),
            )).fetchone()
            if not environment:
                raise ValueError("环境不存在或不属于所选项目")
            version = await (await connection.execute(
                f"SELECT snapshot_json FROM {self.schema}.approved_test_case_versions WHERE id=%s", (approved_version_id,),
            )).fetchone()
            if not version:
                raise ValueError("Approved TestCase 版本不存在")
            existing_ids = {str(item.get("id")) for item in version["snapshot_json"].get("test_cases", [])}
            missing = [item for item in approved_test_case_ids if item not in existing_ids]
            if missing:
                raise ValueError(f"Approved TestCase 不属于所选冻结版本：{', '.join(missing)}")
            if parent_scenario_id:
                parent = await (await connection.execute(
                    f"SELECT project_id FROM {self.schema}.api_yaml_scenarios WHERE id=%s", (parent_scenario_id,),
                )).fetchone()
                if not parent or parent["project_id"] != project_id:
                    raise ValueError("父场景不存在或不属于所选项目")
            scenario_id = str(uuid4())
            digest = hashlib.sha256(yaml_content.encode("utf-8")).hexdigest()
            row = await (await connection.execute(
                f"""INSERT INTO {self.schema}.api_yaml_scenarios
                (id,project_id,environment_id,approved_version_id,approved_test_case_ids,parent_scenario_id,name,yaml_content,content_sha256,status,created_by,change_reason)
                VALUES (%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s,'draft',%s,%s) RETURNING *""",
                (scenario_id, project_id, environment_id, approved_version_id, json.dumps(approved_test_case_ids),
                 parent_scenario_id, name, yaml_content, digest, created_by, change_reason),
            )).fetchone()
            return dict(row)

    async def approve(self, scenario_id: str, approved_by: str) -> dict[str, Any]:
        await self.setup()
        async with await AsyncConnection.connect(self.connection_string, row_factory=dict_row) as connection:
            row = await (await connection.execute(
                f"UPDATE {self.schema}.api_yaml_scenarios SET status='approved', approved_by=%s, approved_at=NOW() WHERE id=%s AND status='draft' RETURNING *",
                (approved_by, scenario_id),
            )).fetchone()
            if not row:
                raise ValueError("场景不存在或已经批准")
            return dict(row)

    async def list_scenarios(self, project_id: str) -> list[dict[str, Any]]:
        await self.setup()
        async with await AsyncConnection.connect(self.connection_string, row_factory=dict_row) as connection:
            rows = await (await connection.execute(
                f"SELECT * FROM {self.schema}.api_yaml_scenarios WHERE project_id=%s ORDER BY created_at DESC",
                (project_id,),
            )).fetchall()
            return [dict(row) for row in rows]

    async def list_runs(self, project_id: str) -> list[dict[str, Any]]:
        await self.setup()
        async with await AsyncConnection.connect(self.connection_string, row_factory=dict_row) as connection:
            rows = await (await connection.execute(
                f"SELECT * FROM {self.schema}.api_yaml_runs WHERE project_id=%s ORDER BY started_at DESC LIMIT 100",
                (project_id,),
            )).fetchall()
            return [dict(row) for row in rows]

    async def execution_context(self, scenario_id: str) -> dict[str, Any]:
        await self.setup()
        async with await AsyncConnection.connect(self.connection_string, row_factory=dict_row) as connection:
            row = await (await connection.execute(f"""
                SELECT s.*, e.base_url, e.headers_json, e.variables_json
                FROM {self.schema}.api_yaml_scenarios s
                JOIN {self.schema}.project_environments e ON e.id=s.environment_id AND e.project_id=s.project_id
                WHERE s.id=%s
            """, (scenario_id,))).fetchone()
            if not row:
                raise ValueError("场景不存在")
            if row["status"] != "approved":
                raise ValueError("只有人工批准的场景可以执行")
            return dict(row)

    async def save_run(self, context: dict[str, Any], result: RunResult, started_at: str, finished_at: str) -> dict[str, Any]:
        run_id = str(uuid4())
        items = [asdict(item) for item in result.items]
        data_cases = [asdict(item) for item in result.data_cases]
        async with await AsyncConnection.connect(self.connection_string, row_factory=dict_row) as connection:
            row = await (await connection.execute(f"""INSERT INTO {self.schema}.api_yaml_runs
                (id,scenario_id,project_id,environment_id,approved_version_id,approved_test_case_ids,status,passed,failed,variables_json,items_json,data_cases_json,started_at,finished_at)
                VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s::jsonb,%s::jsonb,%s::jsonb,%s,%s) RETURNING *""",
                (run_id, context["id"], context["project_id"], context["environment_id"], context["approved_version_id"],
                 json.dumps(context["approved_test_case_ids"]), result.status, result.passed, result.failed,
                 json.dumps(result.variables, ensure_ascii=False), json.dumps(items, ensure_ascii=False, default=str),
                 json.dumps(data_cases, ensure_ascii=False, default=str), started_at, finished_at),
            )).fetchone()
            return dict(row)
