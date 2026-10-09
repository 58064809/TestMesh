---
name: equivalence-boundary
description: 对明确输入域应用等价类和边界值分析，并为 fast-check 保留约束。
---

# 等价类与边界值

- 只处理基线中明确存在的类型、范围、枚举、长度、格式或阈值。
- 分出有效与无效等价类；边界覆盖最小值、最小值相邻、最大值、最大值相邻。
- 不推测文档没有给出的数值。缺失阈值应记录为不可生成精确边界，而不是自行设定。
- 存在可执行属性时说明 fast-check 所需的 generator constraint；随机样本由 fast-check 生成和 shrink，不人工枚举。
