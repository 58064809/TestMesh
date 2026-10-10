---
name: state-transition
description: 对明确状态、事件与迁移应用状态迁移测试。
---

# 状态迁移

- 区分可观察状态、触发事件、前置条件和迁移结果。
- 将每条迁移拆为当前状态、事件、守卫、动作和下一状态；分别设计可判断成败的原子用例。
- 覆盖核心有效迁移、规范明确的禁止迁移、重复事件、失败/超时后的状态保持或恢复。
- 只有起点、节点、边和守卫足够明确时才适用 GraphWalker；缺少边时不得让 AI 补造状态图。
- GraphWalker 适用时，状态/边必须带基线 requirement ID，以便使用 requirement coverage。
