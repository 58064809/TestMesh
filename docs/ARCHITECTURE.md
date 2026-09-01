# TestMesh 架构

## 架构原则

TestMesh 采用“统一工作台 + 薄领域层 + 成熟能力适配”的演进方式。当前架构仅描述已批准阶段；P02–P05 的组件是规划边界，不是 P01 的实现授权。

## P01 运行结构

```text
浏览器
  └─ Refine + Ant Design 中文工作台
       ├─ AI Chat
       ├─ Chat Attachment（本次对话附件）
       └─ Project Knowledge（最小文件清单）
             │
             ▼
        TestMesh Node 服务
       ├─ 上传校验与临时存储
       ├─ PRD 分析提示与结构化 Schema
       └─ OpenAI Responses API 客户端
             │
             ▼
       单一 OpenAI 多模态模型
```

## P01 技术决策

- 前端使用 React、Refine、Ant Design 和 React Router。
- 服务端使用 Node.js，负责持有 `OPENAI_API_KEY`、接收附件、调用 Responses API 和校验结构化结果。
- 文件通过 Responses API `input_file` 直接输入；独立图片使用 `input_image`。
- P01 使用本地临时目录保存上传内容，仅用于当前分析闭环；不建设向量库或复杂知识库。
- 服务端返回显式来源能力说明。PDF 可按页引用；纯文本可按段引用；对无法可靠定位的格式，Evidence 必须使用 `定位受限` 并说明原因。
- API 调用失败直接返回失败信息，不生成本地替代分析。

## 数据流

1. 用户上传 PRD、图片或支持的文档。
2. 服务端校验数量、大小和格式，生成稳定来源 ID。
3. 用户发送分析请求。
4. 服务端把文本、文件/图片和来源目录一次性发送给 Responses API。
5. 模型按严格 Schema 返回 Requirement、Risk、Pending Question、Evidence。
6. 服务端验证每条 Evidence 的来源 ID，拒绝未知来源。
7. 工作台展示结构化结果与来源定位限制。

## 安全与成本边界

- API Key 仅从服务端环境变量读取，绝不进入前端构建产物。
- 上传设置明确的格式、数量和大小上限。
- 单次请求限制输出 token；不自动重试或切换模型。
- 上传文件和分析结果不提交到 Git。

## P02 运行结构

```text
OpenAPI JSON/YAML
  └─ operation → TestCase 定义
       ├─ Requirement / Evidence 追溯关系
       └─ uvx Schemathesis 4.24.3
             └─ JUnit → TestRun / 失败复现信息

SQLite（better-sqlite3 12.10.0）
  └─ Requirement / Risk / Evidence / TestCase / TestRun
```

- Header/Auth 仅进入本次 Runner 进程，不持久化。
- generated examples 只归属于 TestRun，不展开成 TestCase。
- JUnit 缺失时 TestRun 标记为 error 并停止，不解析其他报告格式。

## 后续演进边界

- P02 已交付领域数据模型与 Schemathesis API 测试闭环。
- P03 接入 OpenHands 提供工程上下文。
- P04 通过适配层接入 Playwright、Appium、k6、ZAP。
- P05 增加检索、失败归因、质量门禁和 CI。

任何提前接入均视为路线变更，必须先获用户批准。
