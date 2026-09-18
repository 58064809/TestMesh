---
name: source-conflict-analysis
description: 比对 PRD、流程图、截图和补充说明中的规则差异，保留冲突双方证据，不擅自选择真值。
allowed-tools: read_source, locate_source, validate_reference
---

# Source Conflict Analysis

多文件表达不一致时建立一个 `issue_type=conflict` 的待确认问题，分别引用每一方原文。只有存在明确且适用于本次材料的来源优先级规则时，才把它作为业务规则展示；冲突本身仍保留给人工确认。
