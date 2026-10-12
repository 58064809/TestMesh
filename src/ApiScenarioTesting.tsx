import { CloudUploadOutlined, PlayCircleOutlined } from "@ant-design/icons";
import {
  Alert, App as AntdApp, Button, Card, Col, Empty, Flex, Input, List, Row, Select,
  Space, Statistic, Tag, Typography, Upload, type UploadFile,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ApiScenarioRunRecord, ApiScenarioSuiteRecord, ApprovedTestCaseVersionOption, ProjectRecord } from "./types";

const { Text } = Typography;
const { Dragger } = Upload;

export default function ApiScenarioTesting() {
  const { message } = AntdApp.useApp();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [versions, setVersions] = useState<ApprovedTestCaseVersionOption[]>([]);
  const [suites, setSuites] = useState<ApiScenarioSuiteRecord[]>([]);
  const [runs, setRuns] = useState<ApiScenarioRunRecord[]>([]);
  const [projectId, setProjectId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [testCaseIds, setTestCaseIds] = useState<string[]>([]);
  const [file, setFile] = useState<UploadFile>();
  const [suiteId, setSuiteId] = useState("");
  const [authType, setAuthType] = useState<"none" | "bearer" | "basic">("none");
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [run, setRun] = useState<ApiScenarioRunRecord>();

  useEffect(() => {
    void Promise.all([
      fetch("/api/projects", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("项目配置加载失败");
        return await response.json() as ProjectRecord[];
      }),
      fetch("/api/api-automation/approved-versions", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("Approved TestCase 加载失败");
        return await response.json() as ApprovedTestCaseVersionOption[];
      }),
      fetch("/api/api-automation/scenario-suites", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("Hurl 场景集加载失败");
        return await response.json() as ApiScenarioSuiteRecord[];
      }),
      fetch("/api/api-automation/scenario-runs", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("Hurl TestRun 加载失败");
        return await response.json() as ApiScenarioRunRecord[];
      }),
    ]).then(([loadedProjects, loadedVersions, loadedSuites, loadedRuns]) => {
      setProjects(loadedProjects); setVersions(loadedVersions); setSuites(loadedSuites);
      setRuns(loadedRuns);
      const initialSuite = loadedSuites[0];
      setProjectId(initialSuite?.projectId ?? loadedProjects[0]?.id ?? "");
      setEnvironmentId(initialSuite?.environmentId ?? loadedProjects[0]?.environments[0]?.id ?? "");
      setVersionId(initialSuite?.approvedVersionId ?? loadedVersions[0]?.id ?? "");
      setTestCaseIds(initialSuite?.approvedTestCaseIds ?? []);
      setSuiteId(initialSuite?.id ?? "");
      setRun(initialSuite ? loadedRuns.find((item) => item.suiteId === initialSuite.id) : undefined);
    }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "业务场景配置加载失败"));
  }, []);

  const project = useMemo(() => projects.find((item) => item.id === projectId), [projects, projectId]);
  const version = useMemo(() => versions.find((item) => item.id === versionId), [versions, versionId]);
  const selectedSuite = useMemo(() => suites.find((item) => item.id === suiteId), [suites, suiteId]);

  async function saveSuite() {
    const scenario = file?.originFileObj;
    if (!projectId || !environmentId || !versionId || !scenario || testCaseIds.length === 0) {
      message.warning("项目、环境、Approved 版本、关联用例和 .hurl 文件均为必填项");
      return;
    }
    setSaving(true); setError("");
    try {
      const form = new FormData();
      form.append("scenario", scenario, file.name);
      form.append("projectId", projectId); form.append("environmentId", environmentId);
      form.append("approvedVersionId", versionId); form.append("approvedTestCaseIds", JSON.stringify(testCaseIds));
      const response = await fetch("/api/api-automation/scenario-suites", { method: "POST", body: form });
      const body = await response.json() as ApiScenarioSuiteRecord | { error?: string };
      if (!response.ok) throw new Error("error" in body ? body.error || "Hurl 场景导入失败" : "Hurl 场景导入失败");
      const saved = body as ApiScenarioSuiteRecord;
      setSuites((current) => [saved, ...current]); setSuiteId(saved.id); setRun(undefined);
      message.success("业务场景已保存并关联 Approved TestCase");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Hurl 场景导入失败");
      message.error("场景导入失败，流程已停止");
    } finally { setSaving(false); }
  }

  async function execute() {
    if (!suiteId) { message.warning("请先导入或选择一个 Hurl 场景集"); return; }
    setRunning(true); setError(""); setRun(undefined);
    try {
      const response = await fetch("/api/api-automation/scenario-runs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ suiteId, auth: { type: authType, token, username, password } }),
      });
      const body = await response.json() as ApiScenarioRunRecord | { error?: string };
      if (!response.ok && !("items" in body)) throw new Error("error" in body ? body.error || "Hurl 运行失败" : "Hurl 运行失败");
      const completed = body as ApiScenarioRunRecord; setRun(completed); setRuns((current) => [completed, ...current]);
      if (completed.status === "error") throw new Error("Hurl Runner 失败，已保留真实错误并停止");
      message[completed.status === "passed" ? "success" : "warning"](completed.status === "passed" ? "业务场景执行通过" : "业务场景发现失败");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Hurl 运行失败");
      message.error("业务场景执行已停在失败点");
    } finally { setRunning(false); }
  }

  return <div className="api-testing-page"><Row gutter={[16, 16]}>
    <Col xs={24} xl={9}><Card title={<Space><CloudUploadOutlined />导入业务场景</Space>}>
      <Space direction="vertical" size={14} className="api-main-stack">
        <Alert type="info" showIcon message="Hurl 执行确定性业务链路" description="请求链、变量捕获和断言由 Hurl 8.0.1 执行；TestMesh 只绑定环境、Approved TestCase 和结果证据。" />
        <Field title="项目 *"><Select value={projectId || undefined} onChange={(value) => { setProjectId(value); setEnvironmentId(projects.find((item) => item.id === value)?.environments[0]?.id ?? ""); }} options={projects.map((item) => ({ value: item.id, label: item.name }))} /></Field>
        <Field title="测试环境 *"><Select value={environmentId || undefined} placeholder="请先在项目配置中添加环境" onChange={setEnvironmentId} options={(project?.environments ?? []).map((item) => ({ value: item.id, label: `${item.name} · ${item.baseUrl}` }))} /></Field>
        <Field title="Approved TestCase 版本 *"><Select value={versionId || undefined} onChange={(value) => { setVersionId(value); setTestCaseIds([]); }} options={versions.map((item) => ({ value: item.id, label: `v${item.version} · ${item.testCases.length} 条` }))} /></Field>
        <Field title="关联 Approved TestCase *"><Select mode="multiple" value={testCaseIds} onChange={setTestCaseIds} placeholder="选择该场景实际验证的用例" options={(version?.testCases ?? []).map((item) => ({ value: item.id, label: `${item.id} · ${item.title}` }))} /></Field>
        <Dragger accept=".hurl" maxCount={1} fileList={file ? [file] : []} beforeUpload={() => false} onChange={({ fileList }) => setFile(fileList[0])} onRemove={() => { setFile(undefined); return true; }}><p className="ant-upload-drag-icon"><CloudUploadOutlined /></p><p className="ant-upload-text">选择 .hurl 业务场景文件 *</p><p className="ant-upload-hint">请求地址必须以 {"{{baseUrl}}"} 开头；Token 使用 {"{{token}}"}</p></Dragger>
        <Button block type="primary" loading={saving} onClick={() => void saveSuite()}>保存场景集</Button>
      </Space>
    </Card></Col>
    <Col xs={24} xl={15}><Space direction="vertical" size={16} className="api-main-stack">
      {error && <Alert type="error" showIcon message="流程已停止" description={error} />}
      <Card title={<Space><PlayCircleOutlined />执行已审核场景</Space>}><Space direction="vertical" size={14} className="api-main-stack">
        <Field title="场景集 *"><Select value={suiteId || undefined} placeholder="请先导入 .hurl 场景" onChange={(value) => {
          const selected = suites.find((item) => item.id === value);
          setSuiteId(value);
          setRun(runs.find((item) => item.suiteId === value));
          if (selected) {
            setProjectId(selected.projectId);
            setEnvironmentId(selected.environmentId);
            setVersionId(selected.approvedVersionId);
            setTestCaseIds(selected.approvedTestCaseIds);
          }
        }} options={suites.map((item) => ({ value: item.id, label: `${item.filename} · ${item.approvedTestCaseIds.length} 条关联用例` }))} /></Field>
        {selectedSuite && <Alert type="success" showIcon message={selectedSuite.filename} description={`已关联 ${selectedSuite.approvedTestCaseIds.length} 条 Approved TestCase；目标取自绑定的项目环境。`} />}
        <Field title="本次运行鉴权"><Select value={authType} onChange={setAuthType} options={[{ value: "none", label: "无鉴权" }, { value: "bearer", label: "Bearer Token" }, { value: "basic", label: "Basic Auth" }]} />
          {authType === "bearer" && <Input.Password value={token} onChange={(event) => setToken(event.target.value)} placeholder="Token（仅本次运行）" />}
          {authType === "basic" && <Space.Compact block><Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名" /><Input.Password value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码" /></Space.Compact>}
          <Text type="secondary">凭证只通过运行时变量注入，不写入场景和数据库。</Text>
        </Field>
        <Button block size="large" type="primary" icon={<PlayCircleOutlined />} disabled={!suiteId} loading={running} onClick={() => void execute()}>运行 Hurl 业务场景</Button>
        <Text type="secondary">Hurl 8.0.1 · chained requests / captures / asserts · JUnit evidence · zero retry</Text>
      </Space></Card>
      {run ? <Card title="最近一次业务场景 TestRun"><Flex justify="space-between"><Tag color={run.status === "passed" ? "green" : "red"}>{run.status === "passed" ? "通过" : "失败"}</Tag><Text type="secondary">{run.targetBaseUrl}</Text></Flex><Row gutter={12} className="metric-row"><Col span={12}><Statistic title="通过" value={run.passed} /></Col><Col span={12}><Statistic title="失败" value={run.failed} /></Col></Row><List dataSource={run.items} renderItem={(item) => <List.Item><Card size="small" className="api-operation-card"><Flex justify="space-between"><Text strong>{item.name}</Text><Tag color={item.status === "passed" ? "green" : "red"}>{item.status}</Tag></Flex>{item.detail && <pre>{item.detail}</pre>}</Card></List.Item>} /></Card> : <Empty description="执行后展示 Hurl JUnit 证据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
    </Space></Col>
  </Row></div>;
}

function Field({ title, children }: { title: string; children: ReactNode }) {
  return <div className="api-field"><Text strong>{title}</Text>{children}</div>;
}
