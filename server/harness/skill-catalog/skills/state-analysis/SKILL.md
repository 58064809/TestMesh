---
name: state-analysis
description: 当需求包含状态、生命周期、状态图或状态变化条件时，分析状态及状态迁移。
allowed-tools: read_source, locate_source, validate_reference
---

# State Analysis

识别状态名称、进入条件、离开条件、触发事件和不可达迁移。没有状态信息时 `states` 保持空数组；状态名称或迁移条件不清时写入 `open_questions`。
