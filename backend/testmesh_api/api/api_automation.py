from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, ConfigDict, Field

from ..application.api_automation.service import ApiScenarioService
from ..domain.api_automation.models import parse_scenario_yaml
from ..infrastructure.extraction.response_extractor import JsonPathResponseExtractor
from ..infrastructure.http.httpx_client import HttpxApiClient
from ..infrastructure.persistence.api_automation_repository import ApiAutomationRepository

router = APIRouter(prefix="/api/api-automation/scenarios", tags=["API Automation"])


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ValidateRequest(StrictRequest):
    yaml_content: str = Field(max_length=512 * 1024)


class ExecuteRequest(ValidateRequest):
    base_url: str
    headers: dict[str, str] = Field(default_factory=dict)
    variables: dict[str, object] = Field(default_factory=dict)


class CreateScenarioRequest(ValidateRequest):
    project_id: str = Field(min_length=1)
    environment_id: str = Field(min_length=1)
    approved_version_id: str = Field(min_length=1)
    approved_test_case_ids: list[str] = Field(min_length=1, max_length=500)
    created_by: str = Field(min_length=1, max_length=100)
    change_reason: str = Field(min_length=1, max_length=1000)
    parent_scenario_id: str | None = None


class ApprovalRequest(StrictRequest):
    approved_by: str = Field(min_length=1, max_length=100)


class DatasetSampleRunRequest(StrictRequest):
    sample_id: str = Field(min_length=1, max_length=200)
    input: dict[str, object] = Field(min_length=1)


def repository() -> ApiAutomationRepository:
    return ApiAutomationRepository.from_environment()


Repository = Annotated[ApiAutomationRepository, Depends(repository)]


@router.post("/validate")
async def validate_scenario(request: ValidateRequest) -> dict[str, object]:
    try:
        scenario = parse_scenario_yaml(request.yaml_content)
        return {
            "name": scenario.name,
            "step_count": len(scenario.steps),
            "data_case_count": len(scenario.data_driven.cases) if scenario.data_driven else 0,
            "ai_application": scenario.ai_application.model_dump(mode="json") if scenario.ai_application else None,
            "plan": scenario.model_dump(mode="json", by_alias=True),
        }
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/execute")
async def execute_scenario(request: ExecuteRequest) -> dict[str, object]:
    try:
        scenario = parse_scenario_yaml(request.yaml_content)
        async with HttpxApiClient(request.base_url, request.headers) as client:
            result = await ApiScenarioService(client, JsonPathResponseExtractor()).run(scenario, request.variables)
        return {
            "status": result.status,
            "passed": result.passed,
            "failed": result.failed,
            "items": [item.__dict__ for item in result.items],
            "data_cases": [item.__dict__ for item in result.data_cases],
        }
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/assets", status_code=201)
async def create_scenario_asset(request: CreateScenarioRequest, store: Repository) -> dict[str, object]:
    try:
        scenario = parse_scenario_yaml(request.yaml_content)
        row = await store.create_draft(
            project_id=request.project_id, environment_id=request.environment_id,
            approved_version_id=request.approved_version_id,
            approved_test_case_ids=request.approved_test_case_ids, name=scenario.name,
            yaml_content=request.yaml_content, created_by=request.created_by,
            change_reason=request.change_reason, parent_scenario_id=request.parent_scenario_id,
        )
        return jsonable_encoder(row)
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/assets")
async def list_scenario_assets(project_id: str, store: Repository) -> list[dict[str, object]]:
    try:
        return jsonable_encoder(await store.list_scenarios(project_id))
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/assets/{scenario_id}/approve")
async def approve_scenario_asset(scenario_id: str, request: ApprovalRequest, store: Repository) -> dict[str, object]:
    try:
        return jsonable_encoder(await store.approve(scenario_id, request.approved_by))
    except Exception as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/assets/{scenario_id}/runs", status_code=201)
async def execute_approved_asset(scenario_id: str, store: Repository, request: DatasetSampleRunRequest | None = None) -> dict[str, object]:
    started = datetime.now(timezone.utc)
    try:
        context = await store.execution_context(scenario_id)
        scenario = parse_scenario_yaml(context["yaml_content"])
        if request is not None:
            if scenario.ai_application is None:
                raise ValueError("Dataset 样本只能执行已批准的 AI 应用场景")
            if scenario.data_driven is not None:
                raise ValueError("Phoenix Dataset 已逐样本编排，AI 场景不能同时声明内联 data_driven")
            if "${dataset_input" not in scenario.model_dump_json(by_alias=True):
                raise ValueError("AI YAML 未引用 ${dataset_input}，不能证明样本输入被执行")
        headers = {str(item["name"]): str(item["value"]) for item in context["headers_json"]}
        variables = {str(item["name"]): item["value"] for item in context["variables_json"]}
        if request is not None:
            variables["dataset_sample_id"] = request.sample_id
            variables["dataset_input"] = request.input
        async with HttpxApiClient(str(context["base_url"]), headers) as client:
            result = await ApiScenarioService(client, JsonPathResponseExtractor()).run(scenario, variables)
        saved = await store.save_run(context, result, started.isoformat(), datetime.now(timezone.utc).isoformat())
        return jsonable_encoder(saved)
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/runs")
async def list_product_runs(project_id: str, store: Repository) -> list[dict[str, object]]:
    try:
        return jsonable_encoder(await store.list_runs(project_id))
    except Exception as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
