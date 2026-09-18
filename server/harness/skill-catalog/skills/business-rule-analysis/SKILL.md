---
name: business-rule-analysis
description: 识别条件、动作、权限、时限、计算和来源优先级等业务规则，并区分明确规则与推断。
allowed-tools: read_source, locate_source, validate_reference
---

# Business Rule Analysis

提取规则的触发条件、适用对象、结果和例外。只有材料明确给出的规则使用 `explicit`；根据上下文推导的结论使用 `inferred`。来源优先级只有在材料或已批准知识中明确存在时才记录。
