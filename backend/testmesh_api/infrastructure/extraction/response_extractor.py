import re
from typing import Any

from jsonpath_ng.ext import parse as parse_jsonpath

from ...application.api_automation.ports import HttpResponseData


class JsonPathResponseExtractor:
    def extract(self, capture_type: str, expression: str | None, response: HttpResponseData,
                mode: str = "first", group: int = 1) -> Any:
        if capture_type == "status":
            return response.status_code
        if capture_type == "body":
            return response.text
        if capture_type == "header":
            return response.headers.get((expression or "").lower())
        if capture_type == "jsonpath":
            if response.json_body is None:
                raise ValueError("响应体不是有效 JSON")
            values = [match.value for match in parse_jsonpath(expression or "").find(response.json_body)]
            if mode == "all":
                return values
            if not values:
                raise ValueError(f"JSONPath 未匹配：{expression}")
            return values[0]
        matches = list(re.finditer(expression or "", response.text))
        if mode == "all":
            return [match.group(group) for match in matches]
        if not matches:
            raise ValueError(f"正则未匹配：{expression}")
        return matches[0].group(group)
