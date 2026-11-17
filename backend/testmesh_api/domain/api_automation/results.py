from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class AssertionResult:
    assertion_type: str
    expression: str
    operator: str
    expected: Any
    actual: Any
    passed: bool
    message: str = ""


@dataclass(frozen=True)
class StepResult:
    name: str
    status: str
    duration_ms: float
    detail: str
    iteration: str = ""
    assertions: list[AssertionResult] = field(default_factory=list)


@dataclass(frozen=True)
class DataCaseResult:
    id: str
    name: str
    status: str
    passed: int
    failed: int
    variables: dict[str, Any]
    tags: list[str] = field(default_factory=list)
    detail: str = ""


@dataclass
class RunResult:
    status: str
    passed: int
    failed: int
    variables: dict[str, Any]
    items: list[StepResult] = field(default_factory=list)
    data_cases: list[DataCaseResult] = field(default_factory=list)
