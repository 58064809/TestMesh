import { CheckCircleOutlined, FileTextOutlined, PlayCircleOutlined, QuestionCircleOutlined, SaveOutlined } from "@ant-design/icons";
import { Alert, App as AntdApp, Button, Card, Col, Collapse, Empty, Flex, Input, List, Modal, Row, Select, Space, Statistic, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ApprovedTestCaseVersionOption, ProjectRecord } from "./types";
import ExecutionDiagnosis from "./ExecutionDiagnosis";

const { Text } = Typography;
const FASTAPI_BASE = import.meta.env.VITE_TESTMESH_API_URL || "http://127.0.0.1:8000";

const YAML_TEMPLATE = `format: testmesh-api/v1
name: 售后申请数据驱动链路
data_driven:
  continue_on_failure: true
  cases:
    - id: damaged-product
      name: 商品破损退货
      variables: { order_id: order-1001, reason: 商品破损, expected_status: review_pending }
    - id: wrong-product
      name: 商品错发退货
      variables: { order_id: order-1002, reason: 商品错发, expected_status: review_pending }
steps:
  - kind: request
    name: 创建售后申请
    request:
      method: POST
      path: /after-sales
      json: { orderId: "\${order_id}", reason: "\${reason}" }
    expected_status: 201
    captures:
      - { name: applicationId, type: jsonpath, expression: $.data.id }
    assertions:
      - { type: jsonpath, expression: $.code, operator: "==", expected: 0 }
  - "if \${expected_status} == 'review_pending'":
      - kind: request
        name: 查询申请状态
        request: { method: GET, path: "/after-sales/\${applicationId}" }
        expected_status: 200
`;

type ScenarioAsset = {
  id: string; project_id: string; environment_id: string; approved_version_id: string;
  approved_test_case_ids: string[]; parent_scenario_id: string | null; name: string;
  yaml_content: string; content_sha256: string; status: "draft" | "approved";
  created_by: string; change_reason: string; approved_by: string; approved_at: string | null; created_at: string;
};
type Assertion = { assertion_type: string; expression: string; operator: string; expected: unknown; actual: unknown; passed: boolean; message: string };
type RunItem = { name: string; status: string; duration_ms: number; detail: string; iteration: string; assertions: Assertion[] };
type DataCaseRun = { id: string; name: string; status: "passed" | "failed" | "skipped"; passed: number; failed: number; tags: string[]; detail: string };
type ProductRun = { id: string; scenario_id: string; status: string; passed: number; failed: number; items_json: RunItem[]; data_cases_json?: DataCaseRun[]; started_at: string; finished_at: string };

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { detail?: string };
  if (!response.ok) throw new Error(body.detail || `请求失败（HTTP ${response.status}）`);
  return body;
}

export default function ApiScenarioTesting() {
  const { message } = AntdApp.useApp();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [versions, setVersions] = useState<ApprovedTestCaseVersionOption[]>([]);
  const [assets, setAssets] = useState<ScenarioAsset[]>([]);
  const [runs, setRuns] = useState<ProductRun[]>([]);
  const [projectId, setProjectId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [testCaseIds, setTestCaseIds] = useState<string[]>([]);
  const [assetId, setAssetId] = useState("");
  const [yamlContent, setYamlContent] = useState(YAML_TEMPLATE);
  const [operator, setOperator] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [run, setRun] = useState<ProductRun>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manualOpen, setManualOpen] = useState(false);

  const project = useMemo(() => projects.find((item) => item.id === projectId), [projects, projectId]);
  const version = useMemo(() => versions.find((item) => item.id === versionId), [versions, versionId]);
  const selectedAsset = useMemo(() => assets.find((item) => item.id === assetId), [assets, assetId]);
  const assetRuns = useMemo(() => runs.filter((item) => item.scenario_id === assetId), [runs, assetId]);

  async function refreshProduct(selectedProjectId: string, preferredAssetId = "") {
    if (!selectedProjectId) { setAssets([]); setRuns([]); return; }
    const [assetRows, runRows] = await Promise.all([
      readJson<ScenarioAsset[]>(await fetch(`${FASTAPI_BASE}/api/api-automation/scenarios/assets?project_id=${encodeURIComponent(selectedProjectId)}`, { cache: "no-store" })),
      readJson<ProductRun[]>(await fetch(`${FASTAPI_BASE}/api/api-automation/scenarios/runs?project_id=${encodeURIComponent(selectedProjectId)}`, { cache: "no-store" })),
    ]);
    setAssets(assetRows); setRuns(runRows);
    const next = assetRows.find((item) => item.id === preferredAssetId) ?? assetRows[0];
    setAssetId(next?.id ?? ""); setRun(next ? runRows.find((item) => item.scenario_id === next.id) : undefined);
  }

  useEffect(() => {
    void Promise.all([
      fetch("/api/projects", { cache: "no-store" }).then(readJson<ProjectRecord[]>),
      fetch("/api/api-automation/approved-versions", { cache: "no-store" }).then(readJson<ApprovedTestCaseVersionOption[]>),
    ]).then(([projectRows, versionRows]) => {
      const initialProject = projectRows[0];
      setProjects(projectRows); setVersions(versionRows); setProjectId(initialProject?.id ?? "");
      setEnvironmentId(initialProject?.defaultApiEnvironmentId || initialProject?.environments[0]?.id || "");
      setVersionId(versionRows[0]?.id ?? "");
      if (initialProject) void refreshProduct(initialProject.id).catch((cause) => setError(cause instanceof Error ? cause.message : "场景加载失败"));
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "配置加载失败"));
  }, []);

  async function validateYaml(): Promise<boolean> {
    setBusy(true); setError("");
    try {
      const result = await readJson<{ name: string; step_count: number; data_case_count: number }>(await fetch(`${FASTAPI_BASE}/api/api-automation/scenarios/validate`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ yaml_content: yamlContent }),
      }));
      message.success(`YAML 校验通过：${result.name}，顶层步骤 ${result.step_count} 个，数据行 ${result.data_case_count} 条`); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "YAML 校验失败"); return false; }
    finally { setBusy(false); }
  }

  async function saveDraft() {
    if (!projectId || !environmentId || !versionId || !testCaseIds.length || !operator.trim() || !changeReason.trim()) {
      message.warning("项目、环境、Approved TestCase、操作人和变更原因均为必填项"); return;
    }
    if (!await validateYaml()) return;
    setBusy(true);
    try {
      const saved = await readJson<ScenarioAsset>(await fetch(`${FASTAPI_BASE}/api/api-automation/scenarios/assets`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ yaml_content: yamlContent, project_id: projectId, environment_id: environmentId,
          approved_version_id: versionId, approved_test_case_ids: testCaseIds, created_by: operator,
          change_reason: changeReason, parent_scenario_id: selectedAsset?.id ?? null }),
      }));
      await refreshProduct(projectId, saved.id); message.success("候选场景已保存；人工批准前不能执行");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function approve() {
    if (!selectedAsset || !operator.trim()) return;
    setBusy(true);
    try {
      await readJson(await fetch(`${FASTAPI_BASE}/api/api-automation/scenarios/assets/${selectedAsset.id}/approve`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved_by: operator }),
      }));
      await refreshProduct(projectId, selectedAsset.id); message.success("场景已人工批准并冻结");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "批准失败"); }
    finally { setBusy(false); }
  }

  async function execute() {
    if (!selectedAsset || selectedAsset.status !== "approved") return;
    setBusy(true); setError("");
    try {
      const completed = await readJson<ProductRun>(await fetch(`${FASTAPI_BASE}/api/api-automation/scenarios/assets/${selectedAsset.id}/runs`, { method: "POST" }));
      await refreshProduct(projectId, selectedAsset.id); setRun(completed);
      message[completed.status === "passed" ? "success" : "warning"](completed.status === "passed" ? "场景执行通过" : "场景发现失败，证据已归档");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "执行失败"); }
    finally { setBusy(false); }
  }

  return <div className="api-testing-page"><Row gutter={[16, 16]}>
    <Col xs={24} xl={10}><Card title={<Space><FileTextOutlined />传统 API YAML 场景</Space>} extra={<Button aria-label="打开 YAML 操作手册" title="YAML 操作手册" type="text" shape="circle" icon={<QuestionCircleOutlined />} onClick={() => setManualOpen(true)} />}><Space direction="vertical" size={14} className="api-main-stack">
      <Alert type="info" showIcon message="FastAPI 确定性执行" description="Base URL、公共 Header 和变量来自项目配置；候选 YAML 必须关联 Approved TestCase、通过 Pydantic 校验并完成人工批准。" />
      <Field title="项目 *"><Select value={projectId || undefined} onChange={(value) => { const selected = projects.find((item) => item.id === value); setProjectId(value); setEnvironmentId(selected?.defaultApiEnvironmentId || selected?.environments[0]?.id || ""); void refreshProduct(value); }} options={projects.map((item) => ({ value: item.id, label: item.name }))} /></Field>
      <Field title="测试环境 *"><Select value={environmentId || undefined} onChange={setEnvironmentId} options={(project?.environments ?? []).map((item) => ({ value: item.id, label: `${item.name} · ${item.baseUrl}` }))} /></Field>
      <Field title="Approved TestCase 版本 *"><Select value={versionId || undefined} onChange={(value) => { setVersionId(value); setTestCaseIds([]); }} options={versions.map((item) => ({ value: item.id, label: `v${item.version} · ${item.testCases.length} 条` }))} /></Field>
      <Field title="关联 Approved TestCase *"><Select mode="multiple" value={testCaseIds} onChange={setTestCaseIds} options={(version?.testCases ?? []).map((item) => ({ value: item.id, label: `${item.id} · ${item.title}` }))} /></Field>
      <Row gutter={8}><Col span={10}><Field title="操作人 *"><Input value={operator} onChange={(event) => setOperator(event.target.value)} /></Field></Col><Col span={14}><Field title="变更/修正原因 *"><Input value={changeReason} onChange={(event) => setChangeReason(event.target.value)} /></Field></Col></Row>
      <Flex justify="space-between"><Text strong>YAML *</Text><Button size="small" onClick={() => setYamlContent(YAML_TEMPLATE)}>载入模板</Button></Flex>
      <Input.TextArea value={yamlContent} onChange={(event) => setYamlContent(event.target.value)} rows={22} className="testcase-gherkin-editor" />
      <Space><Button icon={<CheckCircleOutlined />} loading={busy} onClick={() => void validateYaml()}>校验</Button><Button type="primary" icon={<SaveOutlined />} loading={busy} onClick={() => void saveDraft()}>保存候选版本</Button></Space>
    </Space></Card></Col>
    <Col xs={24} xl={14}><Space direction="vertical" size={16} className="api-main-stack">
      {error && <Alert type="error" showIcon message="流程已停止" description={error} />}
      <Card title={<Space><PlayCircleOutlined />人工批准与执行</Space>}><Space direction="vertical" className="api-main-stack">
        <Field title="场景版本"><Select value={assetId || undefined} onChange={(value) => { const selected = assets.find((item) => item.id === value); setAssetId(value); setYamlContent(selected?.yaml_content ?? ""); setRun(runs.find((item) => item.scenario_id === value)); }} options={assets.map((item) => ({ value: item.id, label: `${item.name} · ${item.status} · ${item.content_sha256.slice(0, 8)}` }))} /></Field>
        {selectedAsset && <Alert type={selectedAsset.status === "approved" ? "success" : "warning"} showIcon message={`${selectedAsset.name} · ${selectedAsset.status}`} description={`关联 ${selectedAsset.approved_test_case_ids.length} 条用例；创建人 ${selectedAsset.created_by}；变更原因：${selectedAsset.change_reason}`} />}
        <Space><Button disabled={!selectedAsset || selectedAsset.status !== "draft" || !operator.trim()} onClick={() => void approve()} loading={busy}>人工批准并冻结</Button><Button type="primary" icon={<PlayCircleOutlined />} disabled={!selectedAsset || selectedAsset.status !== "approved"} onClick={() => void execute()} loading={busy}>执行已批准场景</Button></Space>
      </Space></Card>
      {run ? <><Card title="API TestRun"><Field title="执行历史"><Select value={run.id} onChange={(value) => setRun(assetRuns.find((item) => item.id === value))} options={assetRuns.map((item) => ({ value: item.id, label: `${new Date(item.started_at).toLocaleString("zh-CN")} · ${item.status}` }))} /></Field><Row gutter={12}><Col span={12}><Statistic title="通过步骤" value={run.passed} /></Col><Col span={12}><Statistic title="失败步骤" value={run.failed} /></Col></Row>{Boolean(run.data_cases_json?.length) && <Card size="small" title="数据驱动执行结果" className="api-data-case-results"><List size="small" dataSource={run.data_cases_json} renderItem={(item) => <List.Item><Space><Tag color={item.status === "passed" ? "green" : item.status === "failed" ? "red" : "default"}>{item.status}</Tag><Text strong>{item.id} · {item.name}</Text><Text type="secondary">通过 {item.passed} / 失败 {item.failed}{item.detail ? ` · ${item.detail}` : ""}</Text></Space></List.Item>} /></Card>}<List dataSource={run.items_json} renderItem={(item) => <List.Item><Card size="small" className="api-operation-card"><Flex justify="space-between"><Text strong>{item.name}{item.iteration ? ` · ${item.iteration}` : ""}</Text><Tag color={item.status === "passed" ? "green" : "red"}>{item.status}</Tag></Flex><Text type="secondary">{item.duration_ms.toFixed(1)} ms · {item.detail}</Text><List size="small" dataSource={item.assertions} renderItem={(assertion) => <List.Item><Tag color={assertion.passed ? "green" : "red"}>{assertion.passed ? "通过" : "失败"}</Tag><Text code>{assertion.assertion_type} {assertion.expression} {assertion.operator}</Text><Text>预期 {JSON.stringify(assertion.expected)} / 实际 {JSON.stringify(assertion.actual)}</Text></List.Item>} /></Card></List.Item>} /></Card>{(run.status === "failed" || run.status === "error") && <ExecutionDiagnosis runKind="fastapi_yaml" runId={run.id} />}</> : <Empty description="批准并执行后显示逐条断言证据" />}
    </Space></Col>
  </Row><YamlManual open={manualOpen} onClose={() => setManualOpen(false)} /></div>;
}

function YamlManual({ open, onClose }: { open: boolean; onClose: () => void }) {
  const code = (value: string) => <pre className="yaml-manual-code"><code>{value}</code></pre>;
  return <Modal width={1040} open={open} onCancel={onClose} footer={<Button type="primary" onClick={onClose}>知道了</Button>} title={<Space><QuestionCircleOutlined />TestMesh API YAML 操作手册</Space>}>
    <Alert type="info" showIcon message="YAML 是确定性执行协议，不是 Python 脚本" description="Python 风格 if/elif/else 和 for 只解析白名单语法；不会执行 eval、函数、模块或用户代码。Base URL、认证、公共变量和数据源连接仍来自项目配置。" />
    <Collapse className="yaml-manual-sections" defaultActiveKey={["start"]} items={[
      { key: "start", label: "1. 最小场景与变量", children: <><Text>完全等于变量表达式时保留数字、布尔、数组和对象类型；嵌入字符串时转成文本。</Text>{code(`format: testmesh-api/v1\nname: 查询订单\nsteps:\n  - kind: request\n    name: 查询订单\n    request:\n      method: GET\n      path: /orders/\${order_id}\n    expected_status: 200`)}</> },
      { key: "data", label: "2. 数据驱动", children: <><Text>每条 enabled 数据拥有独立变量上下文并完整执行一次 steps。变量优先级：项目环境 &lt; 执行传入 &lt; 当前数据行。</Text>{code(`data_driven:\n  source: inline\n  continue_on_failure: true\n  cases:\n    - id: normal-order\n      name: 正常订单\n      tags: [normal]\n      variables: { order_id: 123, expected_status: paid }\n    - id: cancelled-order\n      name: 已取消订单\n      variables: { order_id: 456, expected_status: cancelled }`)}</> },
      { key: "request", label: "3. 请求、提取与断言", children: code(`- kind: request\n  name: 创建订单\n  request:\n    method: POST\n    path: /orders\n    headers: { X-Request-Source: testmesh }\n    query: { tenant: "\${tenant_id}" }\n    json: { productId: "\${product_id}", quantity: "\${quantity}" }\n  expected_status: 201\n  captures:\n    - { name: order_id, type: jsonpath, expression: $.data.id }\n  assertions:\n    - { type: jsonpath, expression: $.code, operator: "==", expected: 0 }\n    - { type: duration, operator: "<=", expected: 1000 }\n  options: { timeout_ms: 30000, retry: 0, delay_ms: 0 }`) },
      { key: "condition", label: "4. Python 风格 if / elif / else", children: <><Text>支持 ==、!=、&gt;、&gt;=、&lt;、&lt;=、in、not in、is、is not、and、or、not 和括号。</Text>{code(`- "if \${order_id} == 123 and \${status} == 'paid'":\n    - kind: request\n      name: 查询支付记录\n      request: { method: GET, path: "/orders/\${order_id}/payment" }\n      expected_status: 200\n  "elif \${order_id} == 456":\n    - kind: request\n      name: 查询取消原因\n      request: { method: GET, path: "/orders/\${order_id}/cancel-reason" }\n      expected_status: 200\n  else:\n    - kind: request\n      name: 查询普通订单\n      request: { method: GET, path: "/orders/\${order_id}" }\n      expected_status: 200`)}</> },
      { key: "loop", label: "5. Python 风格 for", children: <><Text>简单循环默认最多100项、空列表跳过；enumerate 同时提供索引。高级形式可配置 max_items、empty 和 continue_on_failure。</Text>{code(`- "for product_index, product in enumerate(\${products})":\n    options:\n      max_items: 50\n      empty: fail\n      continue_on_failure: true\n    steps:\n      - kind: request\n        name: 查询商品详情\n        request: { method: GET, path: "/products/\${product.id}" }\n        expected_status: 200`)}</> },
      { key: "evidence", label: "6. 数据库与调用链证据", children: <><Alert type="warning" showIcon message="当前产品入口尚未完成数据源注入" description="PG/MySQL 和 SkyWalking/Tempo 语法及适配器已存在，但正式场景执行前仍需完成项目配置绑定；Redis 节点尚未实现。" />{code(`- kind: evidence\n  name: 查询订单落库结果\n  source:\n    type: database\n    data_source_id: order-pg\n    query_id: order-by-id\n    params: { order_id: "\${order_id}" }\n  save_as: order_record\n  extract: { type: jsonpath, expression: "$[0]" }`)}</> },
      { key: "ai", label: "7. AI 应用执行与证据契约", children: <><Text>AI 应用测试复用本执行器。YAML 只声明目标版本、会话/Trace 变量和 Phoenix Evaluator 要求；Phoenix 继续保存 Dataset、Experiment 与评测结果。</Text>{code(`ai_application:\n  target_id: after-sales-agent\n  target_version: candidate-v1\n  interaction: multi_turn\n  session_id_variable: session_id\n  trace_id_variable: trace_id\n  require_trace: true\n  observability_standard: openinference\n  evaluation_provider: phoenix\n  evaluator_names:\n    - intent_correctness\n    - conversation_coherence\n    - groundedness`) }<Alert type="warning" showIcon message="缺少真实会话或 Trace 证据时运行失败" description="multi_turn/agent 必须提供隔离的 session_id；require_trace=true 时必须从目标应用响应提取真实的 32 位 OpenTelemetry Trace ID。" /></> },
      { key: "limits", label: "8. 安全与治理边界", children: <List size="small" dataSource={["YAML 最大 512 KB；单次运行最多 500 个 HTTP 请求。", "for/foreach 每层最多 100 项，控制节点最多嵌套 3 层。", "不支持 while、无界递归、eval、函数调用、导入模块、Shell 或任意脚本。", "YAML 不保存 Base URL、Token、密码、连接串或自由 SQL。", "候选必须关联 Approved TestCase，经过校验和人工批准后才能执行。"]} renderItem={(item) => <List.Item>{item}</List.Item>} /> },
    ]} />
  </Modal>;
}

function Field({ title, children }: { title: string; children: ReactNode }) {
  return <div className="api-field"><Text strong>{title}</Text>{children}</div>;
}
