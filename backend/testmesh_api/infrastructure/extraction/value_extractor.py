import json
import re
from typing import Any

from jsonpath_ng.ext import parse as parse_jsonpath


class JsonValueExtractor:
    def extract(self, value: Any, extraction_type: str, expression: str | None,
                mode: str = "first", group: int = 1) -> Any:
        if extraction_type == "raw":
            return value
        if extraction_type == "jsonpath":
            values = [match.value for match in parse_jsonpath(expression or "").find(value)]
            if mode == "all":
                return values
            if not values:
                raise ValueError(f"JSONPath 未匹配：{expression}")
            return values[0]
        text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        matches = list(re.finditer(expression or "", text))
        if mode == "all":
            return [match.group(group) for match in matches]
        if not matches:
            raise ValueError(f"正则未匹配：{expression}")
        return matches[0].group(group)
