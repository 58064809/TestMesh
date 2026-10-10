---
name: equivalence-boundary
description: 对明确输入域应用等价类和边界值分析，并为 fast-check 保留约束。
---

# 等价类与边界值

- 只处理 PRD/基线中明确存在的类型、范围、枚举、长度、格式或阈值。
- 先列出互斥且非空的有效与无效等价类，每个分区至少由一个用例覆盖。
- 仅对有序分区使用边界值；明确采用 2-value 或 3-value BVA，并覆盖该方法要求的边界及相邻值。
- 不推测文档没有给出的数值。缺失阈值应记录为不可生成精确边界，而不是自行设定。
- 存在可执行属性时说明 fast-check 所需的 generator constraint；随机样本由 fast-check 生成和 shrink，不人工枚举。
