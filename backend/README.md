# TestMesh FastAPI 后端

当前迁移阶段只承载传统 API 自动化核心，现有 Express 模块在完成逐模块验收前不删除。

## 分层结构

- `testmesh_api/api/`：FastAPI 路由与输入输出转换，不放业务执行逻辑。
- `testmesh_api/application/`：用例编排、受限流程控制和结果汇总，只依赖端口接口。
- `testmesh_api/domain/`：YAML 协议、执行结果等稳定业务模型。
- `testmesh_api/infrastructure/`：httpx、JSONPath，以及后续 PostgreSQL、Redis、SkyWalking 适配器。
- `testmesh_api/agent_skills/`：现有 Deep Agents Harness 后续加载的业务提示词，不建立第二套 Harness。

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-fastapi.txt
$env:PYTHONPATH = "backend"
.venv\Scripts\python -m uvicorn testmesh_api.main:app --host 127.0.0.1 --port 8000
```

`testmesh-api/v1` 由 FastAPI/Pydantic 校验，使用 `httpx.AsyncClient` 执行请求，`jsonpath-ng` 负责 JSONPath。应用层通过 `HttpClient` 和 `ResponseExtractor` 端口调用这些成熟能力，因此后续替换或扩展数据源不会污染流程控制。TestMesh 自研范围仅包括确定性的变量上下文、提取、断言、受限流程控制和执行证据汇总。

安全边界：单次响应不超过 2 MB、单场景最多 500 个请求、`foreach` 每层最多 100 项且最多嵌套 3 层，不执行任意 Python、Shell 或用户脚本。

当前控制与证据能力：

- `kind: request`：异步 HTTP、响应 JSONPath/正则/Header/body/status 提取及断言。
- `kind: foreach`：运行时数组逐项执行，单项失败保留证据并继续下一项。
- `kind: condition`：结构化 `if / elif / else`，只允许白名单比较，不使用 `eval`。
- `kind: evidence`：统一读取项目治理的数据源。PostgreSQL/MySQL 查询只允许已保存的单条 `SELECT/WITH` 模板；SkyWalking 使用官方 TraceQL/Tempo 兼容 v2 Trace API。结果继续使用 JSONPath/正则并进入同一变量上下文。

PostgreSQL/MySQL 与 SkyWalking 当前完成适配器和隔离测试；取得真实连接配置前不能标记为外部环境验收通过。
