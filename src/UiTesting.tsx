import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExperimentOutlined,
  FolderOpenOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { Alert, App as AntdApp, Button, Card, Checkbox, Col, Empty, Flex, List, Row, Select, Space, Statistic, Tabs, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { ApprovedTestCaseVersionOption, ProjectRecord, RepositoryInspection, UiTestRunRecord } from "./types";

const { Text } = Typography;

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T | { error?: string };
  if (!response.ok) throw new Error((body as { error?: string }).error || `请求失败（HTTP ${response.status}）`);
  return body as T;
}

function outputBlock(value: string, empty: string) {
  return value ? <pre className="engineering-output">{value}</pre> : <Empty description={empty} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
}

function RunResult({ run }: { run: UiTestRunRecord }) {
  const color = run.status === "passed" ? "success" : run.status === "failed" ? "error" : "warning";
  const label = run.status === "passed" ? "通过" : run.status === "failed" ? "测试失败" : run.status === "error" ? "运行错误" : "运行中";
  return (
    <Card className="engineering-result-card">
      <Flex justify="space-between" align="flex-start" gap={12} wrap>
        <div>
          <Space wrap><Tag color={color}>{label}</Tag><Text strong>{run.testFile}</Text></Space>
          <div><Text type="secondary">{run.targetBaseUrl} · 关联 {run.approvedTestCaseIds.length} 条 Approved TestCase</Text></div>
        </div>
        <Space wrap><Tag>Playwright {run.playwrightVersion}</Tag><Tag>Chromium</Tag></Space>
      </Flex>
      {run.error && <Alert className="engineering-task-error" type="error" showIcon message={run.error} />}
      <Row gutter={[12, 12]} className="engineering-metrics">
        <Col xs={12} md={6}><Statistic title="通过" value={run.passed} /></Col>
        <Col xs={12} md={6}><Statistic title="失败" value={run.failed} /></Col>
        <Col xs={12} md={6}><Statistic title="跳过" value={run.skipped} /></Col>
        <Col xs={12} md={6}><Statistic title="失败 Trace" value={run.artifacts.length} /></Col>
      </Row>
      <Tabs items={[
        {
          key: "results",
          label: `TestRun ${run.results.length}`,
          children: run.results.length ? <List size="small" dataSource={run.results} renderItem={(item) => (
            <List.Item><Space align="start">{item.status === "passed" ? <CheckCircleOutlined className="ui-test-pass" /> : <CloseCircleOutlined className="ui-test-fail" />}<div><Text strong>{item.title}</Text><div><Text type="secondary">{item.projectName} · {item.durationMs.toFixed(0)} ms · {item.status}</Text></div>{item.error && <pre className="engineering-event-output">{item.error}</pre>}</div></Space></List.Item>
          )} /> : <Empty description="无可用 JSON Reporter 结果" />,
        },
        { key: "output", label: "运行输出", children: outputBlock(run.runnerOutput, "无运行输出") },
        {
          key: "evidence",
          label: `Trace Evidence ${run.artifacts.length}`,
          children: run.artifacts.length ? <List dataSource={run.artifacts} renderItem={(artifact) => <List.Item><a href={`/api/ui-automation/runs/${run.id}/artifacts/${artifact.id}`}>{artifact.name}</a></List.Item>} /> : <Empty description="本次没有失败 Trace" />,
        },
      ]} />
    </Card>
  );
}

export default function UiTesting() {
  const { message } = AntdApp.useApp();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [versions, setVersions] = useState<ApprovedTestCaseVersionOption[]>([]);
  const [projectId, setProjectId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [approvedVersionId, setApprovedVersionId] = useState("");
  const [approvedTestCaseIds, setApprovedTestCaseIds] = useState<string[]>([]);
  const [inspection, setInspection] = useState<RepositoryInspection>();
  const [testFile, setTestFile] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [runs, setRuns] = useState<UiTestRunRecord[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();

  const project = useMemo(() => projects.find((item) => item.id === projectId), [projects, projectId]);
  const repoPath = project?.uiRepositoryPath ?? "";
  const version = useMemo(() => versions.find((item) => item.id === approvedVersionId), [versions, approvedVersionId]);
  const testFiles = useMemo(() => inspection?.repoPath === repoPath ? inspection.files : [], [inspection, repoPath]);

  useEffect(() => {
    void Promise.all([
      fetch("/api/projects", { cache: "no-store" }).then((response) => readJson<ProjectRecord[]>(response)),
      fetch("/api/api-automation/approved-versions", { cache: "no-store" }).then((response) => readJson<ApprovedTestCaseVersionOption[]>(response)),
      fetch("/api/ui-automation/runs", { cache: "no-store" }).then((response) => readJson<UiTestRunRecord[]>(response)),
    ]).then(([loadedProjects, loadedVersions, loadedRuns]) => {
      setProjects(loadedProjects);
      setVersions(loadedVersions);
      setRuns(loadedRuns);
      setProjectId(loadedProjects[0]?.id ?? "");
      setEnvironmentId(loadedProjects[0]?.defaultUiEnvironmentId || loadedProjects[0]?.environments[0]?.id || "");
      setApprovedVersionId(loadedVersions[0]?.id ?? "");
    }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "UI 自动化配置加载失败"));
  }, []);

  useEffect(() => {
    if (!project?.uiRepositoryPath) {
      return;
    }
    void fetch("/api/ui-automation/repository", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoPath: project.uiRepositoryPath }),
    }).then((response) => readJson<RepositoryInspection>(response)).then((result) => {
      setError(undefined);
      setInspection(result);
      setTestFile("");
    }).catch((caught: unknown) => {
      setInspection(undefined);
      setError(caught instanceof Error ? caught.message : "Playwright 仓库读取失败");
    });
  }, [project]);

  async function runTest() {
    setRunning(true);
    setError(undefined);
    try {
      const run = await readJson<UiTestRunRecord>(await fetch("/api/ui-automation/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, environmentId, approvedVersionId, approvedTestCaseIds, repoPath, testFile, authorized }),
      }));
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setAuthorized(false);
      message.success(run.status === "passed" ? "Playwright UI 测试通过" : "Playwright UI 测试已完成");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Playwright UI 测试未启动");
    } finally { setRunning(false); }
  }

  const missing = !projectId || !environmentId || !approvedVersionId || approvedTestCaseIds.length === 0 || !repoPath || inspection?.repoPath !== repoPath || !testFile;
  return (
    <div className="engineering-page">
      <Alert type="info" showIcon message="成熟能力边界" description="测试规划、代码生成与失败修复复用 Playwright 官方 Test Agents；TestMesh 只负责 Approved TestCase 关联、人工授权、真实执行与 Trace 证据。" />
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={10}>
          <Space direction="vertical" size={16} className="engineering-main-stack">
            <Card title="业务与目标环境">
              <Space direction="vertical" size={12} className="engineering-main-stack">
                <Text strong>项目 *</Text>
                <Select value={projectId || undefined} options={projects.map((item) => ({ value: item.id, label: `${item.name} · ${item.code}` }))} placeholder="请选择项目" onChange={(value) => { const selected = projects.find((item) => item.id === value); setProjectId(value); setEnvironmentId(selected?.defaultUiEnvironmentId || selected?.environments[0]?.id || ""); }} />
                <Text strong>目标环境 *</Text>
                <Select value={environmentId || undefined} options={(project?.environments ?? []).map((item) => ({ value: item.id, label: `${item.name} · ${item.baseUrl}` }))} placeholder="请先在项目配置中添加环境" onChange={setEnvironmentId} />
                <Text strong>Approved TestCase 版本 *</Text>
                <Select value={approvedVersionId || undefined} options={versions.map((item) => ({ value: item.id, label: `Approved v${item.version} · ${item.testCases.length} 条` }))} placeholder="请选择已批准版本" onChange={(value) => { setApprovedVersionId(value); setApprovedTestCaseIds([]); }} />
                <Text strong>本测试文件覆盖的用例 *</Text>
                <Select mode="multiple" value={approvedTestCaseIds} options={(version?.testCases ?? []).map((item) => ({ value: item.id, label: `${item.id} · ${item.title}` }))} placeholder="至少选择一条用例" onChange={setApprovedTestCaseIds} optionFilterProp="label" />
              </Space>
            </Card>
            <Card title={<Space><FolderOpenOutlined />Playwright 项目</Space>}>
              <Space direction="vertical" size={12} className="engineering-main-stack">
                <Text strong>Git 仓库根目录</Text>
                {repoPath ? <Text code>{repoPath}</Text> : <Alert type="warning" showIcon message="尚未配置 Playwright 仓库" description="请先到“项目配置 → API / UI 自动化配置”填写仓库根目录。" />}
                {inspection?.repoPath === repoPath && <Alert type="success" showIcon message={`${inspection.branch} · ${testFiles.length} 个 Playwright 测试文件`} />}
                {inspection?.repoPath === repoPath && (
                  <Alert
                    type={inspection.agentsInitialized ? "success" : "warning"}
                    showIcon
                    message={inspection.agentsInitialized ? "Playwright 官方 Test Agents 已初始化" : "尚未初始化 Playwright 官方 Test Agents"}
                    description={inspection.agentsInitialized
                      ? "planner、generator、healer 均来自 Playwright 官方初始化命令。"
                      : "请在目标仓库运行：npx playwright init-agents --loop=codex --config=playwright.config.ts --project=chromium --prompts"}
                  />
                )}
                <Text strong>Playwright 测试文件 *</Text>
                <Select showSearch value={testFile || undefined} onChange={setTestFile} options={testFiles.map((file) => ({ label: file, value: file }))} placeholder="选择一个 spec/test 文件" disabled={inspection?.repoPath !== repoPath || running} optionFilterProp="label" />
              </Space>
            </Card>
          </Space>
        </Col>
        <Col xs={24} xl={14}>
          <Space direction="vertical" size={16} className="engineering-main-stack">
            <Card title={<Space><SafetyCertificateOutlined />人工授权执行</Space>}>
              <Space direction="vertical" size={12} className="engineering-main-stack">
                <Alert type="warning" showIcon message="所选测试代码会在本机以当前用户权限执行" description="请先审阅仓库 Diff 和测试文件；当前电脑没有 Docker，因此不提供容器隔离，也不会静默换用其他 Runner。" />
                <Checkbox checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} disabled={running}>我已审阅所选代码，并明确授权 TestMesh 在本机执行。</Checkbox>
                <Button type="primary" icon={<PlayCircleOutlined />} loading={running} disabled={missing || !authorized || running} onClick={() => void runTest()}>运行 UI 测试</Button>
                <Text type="secondary"><ExperimentOutlined /> Playwright 1.64.0 · Chromium · single worker · retries 0 · failure trace</Text>
              </Space>
            </Card>
            {error && <Alert type="error" showIcon message="UI 自动化已停在失败点" description={error} />}
            {runs.length ? <RunResult run={runs[0]} /> : <Card><Empty description="尚无 UI TestRun" /></Card>}
          </Space>
        </Col>
      </Row>
    </div>
  );
}
