---
name: requirement-extraction
description: 从当前需求来源中提取原文明确存在的需求项、参与角色、约束和异常，不补写测试风险或测试用例。
allowed-tools: read_source, locate_source, validate_reference
---

# Requirement Extraction

逐个来源识别原文明确表达的需求。每个结论关联 `sources` 中可核对的引用；原文没有验收标准时，`acceptance_criteria` 保持空数组。重复表述合并为一个语义项，同时保留全部必要引用。
