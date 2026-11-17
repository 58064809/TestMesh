from __future__ import annotations

import re
from typing import Any, Literal, Union

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

API_YAML_FORMAT = "testmesh-api/v1"
MAX_YAML_BYTES = 512 * 1024


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class RequestSpec(StrictModel):
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
    path: str = Field(min_length=1, max_length=2000)
    headers: dict[str, Any] = Field(default_factory=dict)
    query: dict[str, Any] = Field(default_factory=dict)
    json_body: Any | None = Field(default=None, alias="json", serialization_alias="json")
    form: dict[str, Any] | None = None
    text: str | None = Field(default=None, max_length=256 * 1024)

    @model_validator(mode="after")
    def validate_request(self) -> "RequestSpec":
        if not self.path.startswith("/") or "://" in self.path:
            raise ValueError("path 必须是以 / 开头的相对路径，Base URL 只能来自项目环境")
        if sum(value is not None for value in (self.json_body, self.form, self.text)) > 1:
            raise ValueError("json、form、text 请求体只能选择一种")
        return self


class CaptureSpec(StrictModel):
    name: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    type: Literal["jsonpath", "regex", "header", "body", "status"]
    expression: str | None = Field(default=None, max_length=2000)
    mode: Literal["first", "all"] = "first"
    group: int = Field(default=1, ge=0, le=99)

    @model_validator(mode="after")
    def validate_capture(self) -> "CaptureSpec":
        if self.type in {"jsonpath", "regex", "header"} and not self.expression:
            raise ValueError(f"{self.type} 提取必须填写 expression")
        if self.type in {"body", "status"} and self.expression:
            raise ValueError(f"{self.type} 提取不需要 expression")
        if self.mode == "all" and self.type not in {"jsonpath", "regex"}:
            raise ValueError("mode=all 只适用于 jsonpath 或 regex")
        return self


class AssertionSpec(StrictModel):
    type: Literal["jsonpath", "regex", "header", "body", "status", "duration"]
    expression: str | None = Field(default=None, max_length=2000)
    operator: Literal["==", "!=", ">", ">=", "<", "<=", "contains", "startsWith", "endsWith", "matches", "exists", "not exists"]
    expected: Any | None = None


class RequestOptions(StrictModel):
    delay_ms: int = Field(default=0, ge=0, le=60_000)
    retry: int = Field(default=0, ge=0, le=10)
    retry_interval_ms: int = Field(default=0, ge=0, le=60_000)
    timeout_ms: int = Field(default=30_000, ge=100, le=60_000)


class RequestStep(StrictModel):
    kind: Literal["request"]
    name: str = Field(min_length=1, max_length=120)
    request: RequestSpec
    expected_status: int = Field(ge=100, le=599)
    captures: list[CaptureSpec] = Field(default_factory=list, max_length=50)
    assertions: list[AssertionSpec] = Field(default_factory=list, max_length=100)
    options: RequestOptions = Field(default_factory=RequestOptions)


class ValueExtraction(StrictModel):
    type: Literal["jsonpath", "regex", "raw"] = "raw"
    expression: str | None = Field(default=None, max_length=2000)
    mode: Literal["first", "all"] = "first"
    group: int = Field(default=1, ge=0, le=99)


class DatabaseEvidenceSource(StrictModel):
    type: Literal["database"]
    data_source_id: str = Field(min_length=1, max_length=100)
    query_id: str = Field(min_length=1, max_length=100)
    params: dict[str, Any] = Field(default_factory=dict)


class TraceEvidenceSource(StrictModel):
    type: Literal["trace"]
    provider_id: str = Field(min_length=1, max_length=100)
    trace_id: Any


class EvidenceStep(StrictModel):
    kind: Literal["evidence"]
    name: str = Field(min_length=1, max_length=120)
    source: DatabaseEvidenceSource | TraceEvidenceSource
    save_as: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    extract: ValueExtraction = Field(default_factory=ValueExtraction)


class ForeachSpec(StrictModel):
    source: str = Field(pattern=r"^\$\{[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*\}$")
    item: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    index: str = Field(default="index", pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    max_items: int = Field(default=100, ge=1, le=100)
    empty: Literal["fail", "skip"] = "fail"
    continue_on_failure: bool = True


class ForeachStep(StrictModel):
    kind: Literal["foreach"]
    name: str = Field(min_length=1, max_length=120)
    foreach: ForeachSpec
    steps: list[Union[RequestStep, EvidenceStep, "ForeachStep", "ConditionalStep"]] = Field(min_length=1, max_length=50)


class Condition(StrictModel):
    left: Any
    operator: Literal["==", "!=", ">", ">=", "<", "<=", "contains", "in", "exists", "not exists"]
    right: Any | None = None


class PythonCondition(StrictModel):
    expression: str = Field(min_length=1, max_length=2000)


class ElifBranch(StrictModel):
    when: Condition | PythonCondition
    steps: list[Union[RequestStep, EvidenceStep, ForeachStep, "ConditionalStep"]] = Field(min_length=1, max_length=50)


class ConditionalStep(StrictModel):
    kind: Literal["condition"]
    name: str = Field(min_length=1, max_length=120)
    if_condition: Condition | PythonCondition = Field(alias="if", serialization_alias="if")
    then: list[Union[RequestStep, EvidenceStep, ForeachStep, "ConditionalStep"]] = Field(min_length=1, max_length=50)
    elif_branches: list[ElifBranch] = Field(default_factory=list, alias="elif", serialization_alias="elif", max_length=10)
    else_steps: list[Union[RequestStep, EvidenceStep, ForeachStep, "ConditionalStep"]] = Field(default_factory=list, alias="else", serialization_alias="else", max_length=50)


class DataCase(StrictModel):
    id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$")
    name: str = Field(min_length=1, max_length=120)
    enabled: bool = True
    tags: list[str] = Field(default_factory=list, max_length=20)
    variables: dict[str, Any] = Field(default_factory=dict, max_length=100)

    @model_validator(mode="after")
    def validate_variables(self) -> "DataCase":
        invalid = [name for name in self.variables if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name)]
        if invalid:
            raise ValueError(f"数据行变量名不合法：{', '.join(invalid)}")
        return self


class DataDrivenSpec(StrictModel):
    source: Literal["inline"] = "inline"
    continue_on_failure: bool = True
    cases: list[DataCase] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_cases(self) -> "DataDrivenSpec":
        ids = [item.id for item in self.cases]
        duplicates = sorted({item for item in ids if ids.count(item) > 1})
        if duplicates:
            raise ValueError(f"数据行 id 不能重复：{', '.join(duplicates)}")
        if not any(item.enabled for item in self.cases):
            raise ValueError("data_driven 至少需要一条 enabled=true 的数据")
        return self


class AiApplicationSpec(StrictModel):
    """Execution contract for a target AI application, not an evaluation engine."""

    target_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$")
    target_version: str = Field(min_length=1, max_length=100)
    interaction: Literal["single_turn", "multi_turn", "agent"]
    session_id_variable: str | None = Field(default=None, pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    trace_id_variable: str = Field(default="trace_id", pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    require_trace: bool = True
    observability_standard: Literal["openinference"] = "openinference"
    evaluation_provider: Literal["phoenix"] = "phoenix"
    evaluator_names: list[str] = Field(min_length=1, max_length=30)

    @model_validator(mode="after")
    def validate_interaction(self) -> "AiApplicationSpec":
        if self.interaction in {"multi_turn", "agent"} and not self.session_id_variable:
            raise ValueError("multi_turn/agent 必须声明 session_id_variable，以隔离会话并形成会话级证据")
        if len(set(self.evaluator_names)) != len(self.evaluator_names):
            raise ValueError("evaluator_names 不能重复")
        return self


class ApiScenario(StrictModel):
    format: Literal[API_YAML_FORMAT]
    name: str = Field(min_length=1, max_length=120)
    data_driven: DataDrivenSpec | None = None
    ai_application: AiApplicationSpec | None = None
    steps: list[RequestStep | EvidenceStep | ForeachStep | ConditionalStep] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_depth(self) -> "ApiScenario":
        def visit(steps: list[RequestStep | EvidenceStep | ForeachStep | ConditionalStep], depth: int) -> None:
            if depth > 3:
                raise ValueError("foreach 最多嵌套 3 层")
            for step in steps:
                if isinstance(step, ForeachStep):
                    visit(step.steps, depth + 1)
                elif isinstance(step, ConditionalStep):
                    visit(step.then, depth + 1)
                    for branch in step.elif_branches:
                        visit(branch.steps, depth + 1)
                    visit(step.else_steps, depth + 1)
        visit(self.steps, 0)
        return self


VARIABLE_REFERENCE = r"\$\{[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*\}"


def normalize_python_syntax(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    normalized = dict(value)
    if isinstance(normalized.get("steps"), list):
        normalized["steps"] = _normalize_steps(normalized["steps"])
    return normalized


def _normalize_steps(steps: list[Any]) -> list[Any]:
    return [_normalize_step(step) for step in steps]


def _normalize_step(step: Any) -> Any:
    if not isinstance(step, dict):
        return step
    keys = [key for key in step if isinstance(key, str)]
    if_keys = [key for key in keys if key.startswith("if ")]
    for_keys = [key for key in keys if key.startswith("for ")]
    if if_keys and for_keys:
        raise ValueError("同一执行节点不能同时声明 if 和 for")
    if if_keys:
        return _normalize_python_condition(step, if_keys)
    if for_keys:
        return _normalize_python_for(step, for_keys)

    normalized = dict(step)
    if isinstance(normalized.get("steps"), list):
        normalized["steps"] = _normalize_steps(normalized["steps"])
    if isinstance(normalized.get("then"), list):
        normalized["then"] = _normalize_steps(normalized["then"])
    if isinstance(normalized.get("else"), list):
        normalized["else"] = _normalize_steps(normalized["else"])
    if isinstance(normalized.get("elif"), list):
        normalized["elif"] = [
            {**branch, "steps": _normalize_steps(branch.get("steps", []))}
            if isinstance(branch, dict) else branch
            for branch in normalized["elif"]
        ]
    return normalized


def _normalize_python_condition(step: dict[str, Any], if_keys: list[str]) -> dict[str, Any]:
    if len(if_keys) != 1:
        raise ValueError("Python 风格条件必须且只能包含一个 if")
    branch_keys = [key for key in step if isinstance(key, str) and (key.startswith("if ") or key.startswith("elif ") or key == "else")]
    allowed = {"kind", "name", *branch_keys}
    unknown = [str(key) for key in step if key not in allowed]
    if unknown:
        raise ValueError(f"Python 风格条件包含未知字段：{', '.join(unknown)}")
    if branch_keys[0] != if_keys[0]:
        raise ValueError("Python 风格条件的第一个分支必须是 if")
    if "else" in branch_keys and branch_keys[-1] != "else":
        raise ValueError("else 必须是最后一个分支")
    seen_elif = False
    elif_branches: list[dict[str, Any]] = []
    else_steps: list[Any] = []
    if_expression = if_keys[0][3:].strip()
    if not if_expression:
        raise ValueError("if 条件表达式不能为空")
    then_steps = step[if_keys[0]]
    if not isinstance(then_steps, list):
        raise ValueError("if 分支内容必须是步骤列表")
    for key in branch_keys[1:]:
        if key.startswith("elif "):
            if key == "elif ":
                raise ValueError("elif 条件表达式不能为空")
            seen_elif = True
            branch_steps = step[key]
            if not isinstance(branch_steps, list):
                raise ValueError("elif 分支内容必须是步骤列表")
            elif_branches.append({"when": {"expression": key[5:].strip()}, "steps": _normalize_steps(branch_steps)})
        elif key == "else":
            if not seen_elif and len(branch_keys) > 2:
                raise ValueError("elif 必须位于 if 和 else 之间")
            if not isinstance(step[key], list):
                raise ValueError("else 分支内容必须是步骤列表")
            else_steps = _normalize_steps(step[key])
    return {
        "kind": "condition",
        "name": step.get("name") or f"条件：{if_expression}"[:120],
        "if": {"expression": if_expression},
        "then": _normalize_steps(then_steps),
        "elif": elif_branches,
        "else": else_steps,
    }


def _normalize_python_for(step: dict[str, Any], for_keys: list[str]) -> dict[str, Any]:
    if len(for_keys) != 1:
        raise ValueError("Python 风格循环必须且只能包含一个 for")
    key = for_keys[0]
    unknown = [str(item) for item in step if item not in {"kind", "name", key}]
    if unknown:
        raise ValueError(f"Python 风格循环包含未知字段：{', '.join(unknown)}")
    header = key.strip()
    simple = re.fullmatch(rf"for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+({VARIABLE_REFERENCE})", header)
    enumerated = re.fullmatch(rf"for\s+([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s+in\s+enumerate\(\s*({VARIABLE_REFERENCE})\s*\)", header)
    if enumerated:
        index_name, item_name, source = enumerated.groups()
    elif simple:
        item_name, source = simple.groups()
        index_name = f"{item_name}_index"
    else:
        raise ValueError("for 仅支持 'for item in ${items}' 或 'for index, item in enumerate(${items})'")
    body = step[key]
    options: dict[str, Any] = {}
    if isinstance(body, list):
        body_steps = body
    elif isinstance(body, dict):
        unknown_body = [str(item) for item in body if item not in {"options", "steps"}]
        if unknown_body:
            raise ValueError(f"for 循环体包含未知字段：{', '.join(unknown_body)}")
        options = body.get("options") or {}
        body_steps = body.get("steps")
        if not isinstance(options, dict):
            raise ValueError("for.options 必须是对象")
    else:
        raise ValueError("for 循环体必须是步骤列表，或包含 options/steps 的对象")
    if not isinstance(body_steps, list) or not body_steps:
        raise ValueError("for 循环至少需要一个执行步骤")
    unknown_options = [str(item) for item in options if item not in {"max_items", "empty", "continue_on_failure"}]
    if unknown_options:
        raise ValueError(f"for.options 包含未知字段：{', '.join(unknown_options)}")
    return {
        "kind": "foreach",
        "name": step.get("name") or f"遍历 {item_name}",
        "foreach": {
            "source": source,
            "item": item_name,
            "index": index_name,
            "max_items": options.get("max_items", 100),
            "empty": options.get("empty", "skip"),
            "continue_on_failure": options.get("continue_on_failure", True),
        },
        "steps": _normalize_steps(body_steps),
    }


def parse_scenario_yaml(content: str) -> ApiScenario:
    if not content.strip():
        raise ValueError("YAML 场景不能为空")
    if len(content.encode("utf-8")) > MAX_YAML_BYTES:
        raise ValueError("YAML 场景不能超过 512 KB")
    try:
        value = yaml.safe_load(content)
    except yaml.YAMLError as error:
        raise ValueError(f"YAML 语法错误：{error}") from error
    return ApiScenario.model_validate(normalize_python_syntax(value))

