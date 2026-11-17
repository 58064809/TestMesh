from __future__ import annotations

import ast
import asyncio
import json
import re
import time
from copy import deepcopy
from typing import Any

from ...domain.api_automation.models import ApiScenario, CaptureSpec, Condition, ConditionalStep, DatabaseEvidenceSource, EvidenceStep, ForeachStep, PythonCondition, RequestStep, TraceEvidenceSource
from ...domain.api_automation.results import AssertionResult, DataCaseResult, RunResult, StepResult
from .ports import EvidenceProvider, HttpClient, HttpResponseData, ResponseExtractor, ValueExtractor

MAX_REQUESTS = 500
VARIABLE_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*)\}")


class ApiScenarioService:
    def __init__(self, http_client: HttpClient, extractor: ResponseExtractor,
                 evidence_provider: EvidenceProvider | None = None,
                 value_extractor: ValueExtractor | None = None) -> None:
        self.http_client = http_client
        self.extractor = extractor
        self.evidence_provider = evidence_provider
        self.value_extractor = value_extractor
        self.request_count = 0

    async def run(self, scenario: ApiScenario, variables: dict[str, Any] | None = None) -> RunResult:
        base_context = deepcopy(variables or {})
        self.request_count = 0
        if scenario.data_driven is not None:
            return await self._run_data_cases(scenario, base_context)
        context = deepcopy(base_context)
        items: list[StepResult] = []
        await self._run_steps(scenario.steps, context, items, "", False)
        self._append_ai_evidence_check(scenario, context, items, "")
        failed = sum(item.status in {"failed", "error"} for item in items)
        return RunResult("failed" if failed else "passed", len(items) - failed, failed, context, items)

    async def _run_data_cases(self, scenario: ApiScenario, base_context: dict[str, Any]) -> RunResult:
        assert scenario.data_driven is not None
        items: list[StepResult] = []
        case_results: list[DataCaseResult] = []
        stop_remaining = False
        for case in scenario.data_driven.cases:
            if not case.enabled or stop_remaining:
                detail = "数据行已禁用" if not case.enabled else "前序数据行失败，按 continue_on_failure=false 跳过"
                case_results.append(DataCaseResult(
                    case.id, case.name, "skipped", 0, 0, deepcopy(case.variables), list(case.tags), detail,
                ))
                continue
            context = deepcopy(base_context)
            context.update(deepcopy(case.variables))
            start = len(items)
            marker = f"data[{case.id}]"
            passed_case = await self._run_steps(scenario.steps, context, items, marker, False)
            self._append_ai_evidence_check(scenario, context, items, marker)
            case_items = items[start:]
            failed = sum(item.status in {"failed", "error"} for item in case_items)
            passed = len(case_items) - failed
            case_results.append(DataCaseResult(
                case.id, case.name, "passed" if passed_case and not failed else "failed",
                passed, failed, context, list(case.tags),
                "" if passed_case and not failed else "至少一个执行步骤失败",
            ))
            if failed and not scenario.data_driven.continue_on_failure:
                stop_remaining = True
        failed = sum(item.status in {"failed", "error"} for item in items)
        return RunResult(
            "failed" if failed else "passed", len(items) - failed, failed,
            deepcopy(base_context), items, case_results,
        )

    @staticmethod
    def _append_ai_evidence_check(scenario: ApiScenario, context: dict[str, Any],
                                  items: list[StepResult], iteration: str) -> None:
        contract = scenario.ai_application
        if contract is None:
            return
        problems: list[str] = []
        if contract.session_id_variable:
            session_id = context.get(contract.session_id_variable)
            if not isinstance(session_id, str) or not session_id.strip():
                problems.append(f"缺少会话变量 {contract.session_id_variable}")
        trace_id = context.get(contract.trace_id_variable)
        if contract.require_trace and (not isinstance(trace_id, str) or not re.fullmatch(r"[0-9a-fA-F]{32}", trace_id)):
            problems.append(f"{contract.trace_id_variable} 必须是 OpenTelemetry 32 位十六进制 Trace ID")
        items.append(StepResult(
            "AI 应用证据契约",
            "failed" if problems else "passed",
            0,
            "；".join(problems) if problems else (
                f"target={contract.target_id}@{contract.target_version}；"
                f"Trace ID 格式已校验，原始 OpenInference Span 仍需在观测平台复核；Phoenix Evaluator={','.join(contract.evaluator_names)}"
            ),
            iteration,
        ))

    async def _run_steps(self, steps: list[RequestStep | EvidenceStep | ForeachStep | ConditionalStep], context: dict[str, Any],
                         items: list[StepResult], iteration: str,
                         continue_after_failure: bool) -> bool:
        all_passed = True
        for step in steps:
            if isinstance(step, ForeachStep):
                passed = await self._run_foreach(step, context, items, iteration)
            elif isinstance(step, ConditionalStep):
                passed = await self._run_condition(step, context, items, iteration)
            elif isinstance(step, EvidenceStep):
                result = await self._run_evidence(step, context, iteration)
                items.append(result)
                passed = result.status == "passed"
            else:
                result = await self._run_request(step, context, iteration)
                items.append(result)
                passed = result.status == "passed"
            all_passed = all_passed and passed
            if not passed and not continue_after_failure:
                break
        return all_passed

    async def _run_evidence(self, step: EvidenceStep, context: dict[str, Any], iteration: str) -> StepResult:
        started = time.perf_counter()
        try:
            if self.evidence_provider is None or self.value_extractor is None:
                raise ValueError("当前运行未配置证据数据源")
            source = step.source
            if isinstance(source, DatabaseEvidenceSource):
                source = source.model_copy(update={"params": render_value(source.params, context)})
            elif isinstance(source, TraceEvidenceSource):
                source = source.model_copy(update={"trace_id": render_value(source.trace_id, context)})
            value = await self.evidence_provider.load(source, context)
            extracted = self.value_extractor.extract(
                value, step.extract.type, step.extract.expression, step.extract.mode, step.extract.group
            )
            context[step.save_as] = extracted
            return StepResult(step.name, "passed", (time.perf_counter() - started) * 1000,
                              f"{step.source.type} 证据已保存为 {step.save_as}", iteration)
        except Exception as error:
            return StepResult(step.name, "error", (time.perf_counter() - started) * 1000, str(error), iteration)

    async def _run_condition(self, step: ConditionalStep, context: dict[str, Any],
                             items: list[StepResult], iteration: str) -> bool:
        if evaluate_condition(step.if_condition, context):
            return await self._run_steps(step.then, context, items, iteration, False)
        for branch in step.elif_branches:
            if evaluate_condition(branch.when, context):
                return await self._run_steps(branch.steps, context, items, iteration, False)
        if step.else_steps:
            return await self._run_steps(step.else_steps, context, items, iteration, False)
        return True

    async def _run_foreach(self, step: ForeachStep, context: dict[str, Any],
                           items: list[StepResult], parent_iteration: str) -> bool:
        value = resolve_reference(step.foreach.source, context)
        if not isinstance(value, list):
            items.append(StepResult(step.name, "error", 0, "foreach source 必须是数组", parent_iteration))
            return False
        if not value:
            status = "failed" if step.foreach.empty == "fail" else "passed"
            items.append(StepResult(step.name, status, 0, "数组为空" if status == "failed" else "数组为空，按配置跳过", parent_iteration))
            return status == "passed"
        if len(value) > step.foreach.max_items:
            items.append(StepResult(step.name, "error", 0, f"数组长度 {len(value)} 超过 max_items={step.foreach.max_items}", parent_iteration))
            return False
        all_passed = True
        for index, item in enumerate(value):
            local = deepcopy(context)
            local[step.foreach.item] = item
            local[step.foreach.index] = index
            marker = f"{parent_iteration}/{step.name}[{index}]".lstrip("/")
            passed = await self._run_steps(step.steps, local, items, marker, False)
            all_passed = all_passed and passed
            if not passed and not step.foreach.continue_on_failure:
                break
        return all_passed

    async def _run_request(self, step: RequestStep, context: dict[str, Any],
                           iteration: str) -> StepResult:
        if self.request_count >= MAX_REQUESTS:
            return StepResult(step.name, "error", 0, f"请求数超过安全上限 {MAX_REQUESTS}", iteration)
        if step.options.delay_ms:
            await asyncio.sleep(step.options.delay_ms / 1000)
        started = time.perf_counter()
        last_detail = ""
        for attempt in range(step.options.retry + 1):
            self.request_count += 1
            try:
                response = await self._send(step, context)
                assertion_results = evaluate_assertions(step, response, context, self.extractor)
                status_passed = response.status_code == step.expected_status
                assertion_results.insert(0, AssertionResult(
                    "status", "", "==", step.expected_status, response.status_code, status_passed,
                    "" if status_passed else f"HTTP 状态码期望 {step.expected_status}，实际 {response.status_code}",
                ))
                failures = [item.message for item in assertion_results if not item.passed]
                if not failures:
                    apply_captures(step.captures, response, context, self.extractor)
                    duration = (time.perf_counter() - started) * 1000
                    return StepResult(step.name, "passed", duration, f"HTTP {response.status_code}；attempt={attempt + 1}", iteration, assertion_results)
                last_detail = "；".join(failures)
            except Exception as error:  # converted into auditable run evidence
                last_detail = str(error)
            if attempt < step.options.retry and step.options.retry_interval_ms:
                await asyncio.sleep(step.options.retry_interval_ms / 1000)
        duration = (time.perf_counter() - started) * 1000
        return StepResult(step.name, "failed", duration, last_detail, iteration)

    async def _send(self, step: RequestStep, context: dict[str, Any]) -> HttpResponseData:
        request = step.request
        return await self.http_client.request(
            request.method,
            render_value(request.path, context),
            query=render_value(request.query, context),
            headers=render_value(request.headers, context),
            json_body=render_value(request.json_body, context) if request.json_body is not None else None,
            form=render_value(request.form, context) if request.form is not None else None,
            text=render_value(request.text, context) if request.text is not None else None,
            timeout_ms=step.options.timeout_ms,
        )


def resolve_reference(reference: str, context: dict[str, Any]) -> Any:
    match = VARIABLE_PATTERN.fullmatch(reference)
    if not match:
        raise ValueError(f"不是有效变量引用：{reference}")
    path = re.sub(r"\[(\d+)\]", r".\1", match.group(1)).split(".")
    value: Any = context
    for part in path:
        if isinstance(value, dict) and part in value:
            value = value[part]
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            raise ValueError(f"变量不存在：{match.group(1)}")
    return value


def render_value(value: Any, context: dict[str, Any]) -> Any:
    if isinstance(value, str):
        if VARIABLE_PATTERN.fullmatch(value):
            return deepcopy(resolve_reference(value, context))
        return VARIABLE_PATTERN.sub(lambda match: stringify(resolve_reference(match.group(0), context)), value)
    if isinstance(value, list):
        return [render_value(item, context) for item in value]
    if isinstance(value, dict):
        return {key: render_value(item, context) for key, item in value.items()}
    return value


def stringify(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def apply_captures(captures: list[CaptureSpec], response: HttpResponseData, context: dict[str, Any],
                   extractor: ResponseExtractor) -> None:
    for capture in captures:
        context[capture.name] = extractor.extract(capture.type, capture.expression, response, capture.mode, capture.group)


def evaluate_assertions(step: RequestStep, response: HttpResponseData, context: dict[str, Any],
                        extractor: ResponseExtractor) -> list[AssertionResult]:
    results: list[AssertionResult] = []
    for assertion in step.assertions:
        try:
            actual = response.duration_ms if assertion.type == "duration" else extractor.extract(assertion.type, assertion.expression, response)
            expected = render_value(assertion.expected, context)
            passed = compare(actual, assertion.operator, expected)
            message = "" if passed else f"{assertion.type} {assertion.expression or ''}：实际={actual!r} {assertion.operator} 期望={expected!r} 不成立"
            results.append(AssertionResult(assertion.type, assertion.expression or "", assertion.operator, expected, actual, passed, message))
        except Exception as error:
            results.append(AssertionResult(assertion.type, assertion.expression or "", assertion.operator, assertion.expected, None, False, str(error)))
    return results


def compare(actual: Any, operator: str, expected: Any) -> bool:
    if operator == "exists": return actual is not None
    if operator == "not exists": return actual is None
    if operator == "==": return actual == expected
    if operator == "!=": return actual != expected
    if operator == ">": return actual > expected
    if operator == ">=": return actual >= expected
    if operator == "<": return actual < expected
    if operator == "<=": return actual <= expected
    if operator == "contains": return expected in actual
    if operator == "startsWith": return str(actual).startswith(str(expected))
    if operator == "endsWith": return str(actual).endswith(str(expected))
    if operator == "matches": return re.search(str(expected), str(actual)) is not None
    raise ValueError(f"不支持的断言操作符：{operator}")


def evaluate_condition(condition: Condition | PythonCondition, context: dict[str, Any]) -> bool:
    if isinstance(condition, PythonCondition):
        return evaluate_python_expression(condition.expression, context)
    actual = render_value(condition.left, context)
    expected = render_value(condition.right, context)
    if condition.operator == "in":
        return actual in expected
    return compare(actual, condition.operator, expected)


def evaluate_python_expression(expression: str, context: dict[str, Any]) -> bool:
    values: dict[str, Any] = {}

    def replace(match: re.Match[str]) -> str:
        name = f"__tm_value_{len(values)}"
        values[name] = resolve_reference(match.group(0), context)
        return name

    normalized = VARIABLE_PATTERN.sub(replace, expression)
    try:
        tree = ast.parse(normalized, mode="eval")
    except SyntaxError as error:
        raise ValueError(f"条件表达式语法错误：{expression}") from error
    result = _evaluate_ast(tree.body, values)
    if not isinstance(result, bool):
        raise ValueError("条件表达式必须返回布尔值")
    return result


def _evaluate_ast(node: ast.AST, values: dict[str, Any]) -> Any:
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        if node.id in values:
            return values[node.id]
        literals = {"true": True, "false": False, "null": None}
        if node.id in literals:
            return literals[node.id]
        raise ValueError(f"条件表达式包含不允许的名称：{node.id}")
    if isinstance(node, ast.List):
        return [_evaluate_ast(item, values) for item in node.elts]
    if isinstance(node, ast.Tuple):
        return tuple(_evaluate_ast(item, values) for item in node.elts)
    if isinstance(node, ast.BoolOp):
        if isinstance(node.op, ast.And):
            return all(bool(_evaluate_ast(item, values)) for item in node.values)
        if isinstance(node.op, ast.Or):
            return any(bool(_evaluate_ast(item, values)) for item in node.values)
    if isinstance(node, ast.UnaryOp):
        operand = _evaluate_ast(node.operand, values)
        if isinstance(node.op, ast.Not):
            return not bool(operand)
        if isinstance(node.op, ast.USub) and isinstance(operand, (int, float)):
            return -operand
        if isinstance(node.op, ast.UAdd) and isinstance(operand, (int, float)):
            return operand
    if isinstance(node, ast.Compare):
        left = _evaluate_ast(node.left, values)
        for operator, comparator in zip(node.ops, node.comparators, strict=True):
            right = _evaluate_ast(comparator, values)
            if isinstance(operator, ast.Eq): passed = left == right
            elif isinstance(operator, ast.NotEq): passed = left != right
            elif isinstance(operator, ast.Gt): passed = left > right
            elif isinstance(operator, ast.GtE): passed = left >= right
            elif isinstance(operator, ast.Lt): passed = left < right
            elif isinstance(operator, ast.LtE): passed = left <= right
            elif isinstance(operator, ast.In): passed = left in right
            elif isinstance(operator, ast.NotIn): passed = left not in right
            elif isinstance(operator, ast.Is): passed = left is right
            elif isinstance(operator, ast.IsNot): passed = left is not right
            else: raise ValueError("条件表达式包含不允许的比较操作")
            if not passed:
                return False
            left = right
        return True
    raise ValueError(f"条件表达式包含不允许的语法：{type(node).__name__}")

