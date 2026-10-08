# TestMesh

TestMesh 是面向 Agent / AI 应用的质量保障平台。它以真实需求、评估集、执行结果和 Trace 为证据，组织评测、回归与准入；成熟引擎负责具体能力，TestMesh 负责统一入口、业务关联和证据回链。

需求分析只有一个入口，目标是发现需求中的缺失、歧义和冲突并提供原文证据。形式化验证和 DMN 业务规则探索已从产品路径撤回，不作为第二、第三套需求分析。

## 文档解析

- PDF、Word、PowerPoint、Excel、OpenDocument 和图片统一调用 Docling Serve v1，使用其 OCR、表格、阅读顺序、版面与 provenance；TestMesh 不实现这些算法。
- TXT、Markdown、JSON、XML 只做稳定段落编号。
- Docling 失败或只返回部分结果时分析立即停止，不切换 OpenAI 文件解析或其他解析器。
- TestMesh 保存原文件、SHA-256、来源 ID、分析结果和引用；Docling 结构化结果只用于分析上下文。

## 当前 Harness

- 直接使用 Deep Agents 官方 `createDeepAgent`，原自研 `server/harness` 已删除。
- 官方 Harness Profile 控制工具暴露；官方 Skills、Permissions、Structured Output 负责技能加载、读权限和输出结构。
- 需求证据校验是领域中间件；人工评审使用 LangGraph `entrypoint/interrupt/Command`，PostgreSQL `PostgresSaver` 保存检查点。
- 不再维护自研阶段装配器、产物封装、通用完成判定器、运行状态表或追踪平台。
- 需求分析不生成 Risk/TestCase。业务数据使用 PostgreSQL；早期测试执行模块仍使用各自现有存储。

## 启动

要求 Node.js 22+、npm、PowerShell 7、PostgreSQL 和 Python 3.12。本机已配置 Node.js 24.19.0 LTS / npm 11.17.0 到用户级 PATH。首次在 Windows 配置 Docling：

```powershell
python -m venv data\docling-venv
data\docling-venv\Scripts\python.exe -m pip install -r requirements-docling.txt
```

日常使用只需运行 `npm run start:stack`：它会在本机启动 Docling、Phoenix 和 TestMesh。Docling 默认监听 `http://127.0.0.1:5001`，Phoenix 监听 `http://127.0.0.1:6006`，TestMesh 监听 `http://127.0.0.1:3011`；模型与运行数据留在项目 `data` 目录。Phoenix 的遥测、Agent Assistant、MCP、Web 访问和服务端 Bash 默认关闭。TestMesh 启动脚本读取系统代理和机器级 `OPENAI_API_KEY`，数据库密码从进程或本机用户环境变量 `PG_LOCAL_PASSWORD` 读取。其他配置见 `.env.example`，项目不会自动加载 .env 文件。默认开放已验收的 DOCX/PPTX/XLSX；旧版 DOC/PPT/XLS 需额外安装并验收 LibreOffice 后才能加入白名单。

```powershell
npm ci
npm run build
npm run start:stack
```

打开 http://localhost:3011；Trace、Dataset 和 Experiment 在 http://127.0.0.1:6006。每份新需求分析会保存对应 Phoenix Trace ID，报告页的“查看 Phoenix 运行轨迹”直接跳到该次执行；TestMesh 不复制 Trace Viewer。原有模型配置继续使用单一模型，不自动换模型。复杂文档必须先由 Docling 完整解析，原文件不会再直接发送给模型。

AQ01 的真实验收样本可重复运行：

```powershell
npm run aq01:spike -- "C:\path\to\PRD.pdf"
```

该命令复用产品中的同一个需求分析 Agent，并由 Phoenix 保存版本化 Dataset、Experiment、Trace 和代码评测；TestMesh 不自建这些平台能力。

## 原数据库迁移

停止旧服务，配置原来的 PostgreSQL 连接；不要将旧 `TESTMESH_CHECKPOINT_SCHEMA=harness_checkpoint` 带入新版本。

```powershell
npm run migrate:deepagents
```

迁移只根据既有业务数据重建官方评审恢复点，保留原报告、文件字节、评审事件和基线；成功后删除旧 Harness 检查点和运行记录 Schema。它不会迁移失败运行的内部历史。新建空库无需执行此命令。旧 Schema 名称自定义时使用 `TESTMESH_LEGACY_CHECKPOINT_SCHEMA` 和 `TESTMESH_LEGACY_RUNTIME_SCHEMA` 指定。

## 验证

```powershell
npm run lint
npm test
npm run build
npm run test:ra:postgres
```

数据库测试在随机隔离 Schema 内验证持久化、重新连接后恢复和迁移，不调用付费模型。单元测试使用框架测试模型，不代表真实多模态模型验收。

产品边界见 `docs/PRODUCT_DIRECTION.md`；Harness 迁移见 `docs/PHASES/HM01.md`；文档解析选型与验收状态见 `docs/PHASES/DI01.md`；后续阶段见 `docs/ROADMAP.md`。
