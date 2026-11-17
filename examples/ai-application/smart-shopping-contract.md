# 模拟智能导购 Agent 契约 v1

状态：`simulated`。本文件是 TestMesh 在本地与云端进行 AI 应用测试的默认调试资料，不代表真实公司系统或业务验收证据。来源为用户提供的《虚拟规则.txt》；原文中多个表格只显示“暂时无法在飞书文档外展示此内容”，这些部分在本版保持未定义。

## 已明确的流程

用户自然语言输入 → 意图识别 → 参数提取 → 参数与业务规则校验 → `search_products` → 结果过滤、排序、截取及硬约束校验 → 商品卡片和推荐理由 → 下一轮输入。输入、业务或技术异常发生时应进入澄清、无结果或错误分支，不继续不合法的工具调用。

## 意图与参数

唯一明确意图：`product_recommendation`。必填槽位：`category`。可选槽位：`quantity`、`min_price`、`max_price`、`brand`、`weight_min`、`weight_max`、`color`、`sort_by`、`sort_order`。没有给出默认数量、价格上限、单位换算、品牌别名或冲突处理规则；测试中不得自行补定。

多轮示例：

1. “帮我推荐3款羽毛球拍” → `category=badminton_racket`、`quantity=3`。
2. “300元以内” → 在保留前轮有效槽位的基础上加入 `max_price=300`。
3. “要轻一点的，80到85克” → 继续保留有效槽位，加入 `weight_min=80`、`weight_max=85`。

再次查询时必须传递所有仍有效的约束。状态指业务工作流状态，并非模型内部思考过程。状态枚举和完整迁移规则尚未定义。

## 工具与受控夹具

工具名：`search_products`。示例请求：

```json
{
  "category": "badminton_racket",
  "limit": 3,
  "filters": { "max_price": 300, "weight_min": 80, "weight_max": 85, "status": "ON_SALE", "in_stock": true },
  "sort": { "field": "recommendation_score", "order": "desc" }
}
```

固定工具响应：

```json
{
  "code": 0,
  "data": {
    "total": 2,
    "products": [
      { "product_id": "P001", "name": "羽毛球拍A", "price": 269, "weight": 82, "stock": 12, "status": "ON_SALE" },
      { "product_id": "P002", "name": "羽毛球拍B", "price": 299, "weight": 85, "stock": 8, "status": "ON_SALE" }
    ]
  }
}
```

在此夹具下只能推荐 `P001` 与 `P002`；不得补造第三款商品，价格与重量须与工具结果一致，回复应说明只有两款满足条件。工具调用断言必须使用实际完整参数；简写的 `tool_calls.arguments={category,limit}` 不足以验证筛选正确性。

## 可观测性与待定义项

测试环境可通过结构化 Trace 或受控调试接口提供 `intent`、`slots`、业务 `state`、完整 `tool_calls` 和 `recommended_product_ids`。不能仅凭最终回复推断内部参数或工具调用正确。具体目标 URL、认证、Trace 契约、完整状态枚举、错误码、更多商品数据和业务阈值尚未定义。具备这些真实契约前，只能用固定夹具验证工程链路，并将评测对象及结果标记为模拟。
