import {
  ApiOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Input,
  List,
  Row,
  Select,
  Space,
  Statistic,
  Tabs,
  Tag,
  Typography,
  Upload,
  type UploadFile,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import ApiScenarioTesting from "./ApiScenarioTesting";
import type {
  ApprovedTestCaseVersionOption,
  OpenApiSpecRecord,
  ProjectRecord,
  TestCaseRecord,
  TestRunRecord,
} from "./types";

const { Title, Text } = Typography;
const { Dragger } = Upload;

function methodColor(method: string): string {
  return ({ GET: "green", POST: "blue", PUT: "gold", PATCH: "purple", DELETE: "red" } as Record<string, string>)[
    method
  ] ?? "default";
}

function FailureDetails({ run }: { run: TestRunRecord }) {
  const failedItems = run.items.filter((item) => item.status !== "passed");
  if (failedItems.length === 0) {
    return <Alert type="success" showIcon message="所有 operation 均通过 Schemathesis 检查" />;
  }
  return (
    <List
      dataSource={failedItems}
      renderItem={(item) => (
        <List.Item>
          <Card className="api-failure-card" size="small">
            <Flex justify="space-between" align="flex-start" gap={12} wrap>
              <Space>
                <Tag color="red">失败</Tag>
                <Text strong>{item.operation}</Text>
              </Space>
              <Text type="secondary">{item.failureType || "failure"}</Text>
            </Flex>
            {item.checks.length > 0 && (
              <Space size={[6, 6]} wrap className="api-checks">
                {item.checks.map((check) => (
                  <Tag color="volcano" key={check}>{check}</Tag>
                ))}
              </Space>
            )}
            {item.request && (
              <div className="api-detail-block">
                <Text type="secondary">请求 / 最小复现</Text>
                <pre>{item.request}</pre>
              </div>
            )}
            {item.response && (
              <div className="api-detail-block">
                <Text type="secondary">响应</Text>
                <pre>{item.response}</pre>
              </div>
            )}
            {item.reproduction && item.reproduction !== item.request && (
              <div className="api-detail-block">
                <Text type="secondary">完整复现信息</Text>
                <pre>{item.reproduction}</pre>
              </div>
            )}
          </Card>
        </List.Item>
      )}
    />
  );
}

function ContractApiTesting() {
  const { message } = AntdApp.useApp();
  const [specFile, setSpecFile] = useState<UploadFile>();
  const [spec, setSpec] = useState<OpenApiSpecRecord>();
  const [specs, setSpecs] = useState<OpenApiSpecRecord[]>([]);
  const [approvedVersions, setApprovedVersions] = useState<ApprovedTestCaseVersionOption[]>([]);
  const [approvedVersionId, setApprovedVersionId] = useState("");
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectId, setProjectId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [authType, setAuthType] = useState<"none" | "bearer" | "basic">("none");
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [importing, setImporting] = useState(false);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<TestRunRecord>();
  const [runs, setRuns] = useState<TestRunRecord[]>([]);
  const [error, setError] = useState<string>();
  const [configLoading, setConfigLoading] = useState(true);

  useEffect(() => {
    void Promise.all([
      fetch("/api/api-automation/approved-versions").then(async (response) => {
        if (!response.ok) throw new Error(`Approved TestCase 加载失败（HTTP ${response.status}）`);
        return (await response.json()) as ApprovedTestCaseVersionOption[];
      }),
      fetch("/api/projects", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error(`项目配置加载失败（HTTP ${response.status}）`);
        return (await response.json()) as ProjectRecord[];
      }),
      fetch("/api/api-automation/openapi", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error(`OpenAPI 历史加载失败（HTTP ${response.status}）`);
        return (await response.json()) as OpenApiSpecRecord[];
      }),
      fetch("/api/api-automation/test-runs", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error(`TestRun 历史加载失败（HTTP ${response.status}）`);
        return (await response.json()) as TestRunRecord[];
      }),
    ]).then(([versions, loadedProjects, loadedSpecs, loadedRuns]) => {
      setApprovedVersions(versions);
      setProjects(loadedProjects);
      setSpecs(loadedSpecs);
      setRuns(loadedRuns);
      const initialSpec = loadedSpecs[0];
      const initialProject = initialSpec
        ? loadedProjects.find((item) => item.id === initialSpec.projectId)
        : loadedProjects[0];
      setSpec(initialSpec);
      setRun(initialSpec ? loadedRuns.find((item) => item.specId === initialSpec.id) : undefined);
      setApprovedVersionId(initialSpec?.approvedVersionId || versions[0]?.id || "");
      setProjectId(initialSpec?.projectId || initialProject?.id || "");
      setEnvironmentId(initialSpec?.environmentId || initialProject?.environments[0]?.id || "");
    }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "API 自动化配置加载失败"))
      .finally(() => setConfigLoading(false));
  }, []);

  const project = useMemo(() => projects.find((item) => item.id === projectId), [projects, projectId]);
  const environment = useMemo(
    () => project?.environments.find((item) => item.id === environmentId),
    [project, environmentId],
  );

  const approvedVersion = useMemo(
    () => approvedVersions.find((item) => item.id === approvedVersionId),
    [approvedVersions, approvedVersionId],
  );
  const mappedCount = useMemo(
    () => spec?.testCases.filter((testCase) => testCase.approvedTestCaseIds.length > 0).length ?? 0,
    [spec],
  );

  async function importSpec() {
    const file = specFile?.originFileObj;
    if (!file || !approvedVersionId || !projectId || !environmentId) {
      message.warning(!projectId || !environmentId ? "请先选择项目和测试环境" : !approvedVersionId ? "请先选择 Approved TestCase 版本" : "请选择 OpenAPI JSON/YAML 文件");
      return;
    }
    setImporting(true);
    setError(undefined);
    setRun(undefined);
    try {
      const form = new FormData();
      form.append("spec", file, specFile.name);
      form.append("approvedVersionId", approvedVersionId);
      form.append("projectId", projectId);
      form.append("environmentId", environmentId);
      const response = await fetch("/api/api-automation/openapi", { method: "POST", body: form });
      const body = (await response.json()) as OpenApiSpecRecord | { error?: string };
      if (!response.ok) throw new Error("error" in body && body.error ? body.error : "OpenAPI 导入失败");
      const imported = body as OpenApiSpecRecord;
      setSpec(imported);
      setSpecs((current) => [imported, ...current]);
      message.success("OpenAPI 已导入，请关联需要执行的 Approved TestCase");
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "OpenAPI 导入失败";
      setError(detail);
      message.error("OpenAPI 导入失败，流程已停止");
    } finally {
      setImporting(false);
    }
  }

  async function updateLinks(
    testCase: TestCaseRecord,
    ids: string[],
  ) {
    if (!spec) return;
    const next = { ...testCase, approvedTestCaseIds: ids };
    setSpec({
      ...spec,
      testCases: spec.testCases.map((item) => (item.id === testCase.id ? next : item)),
    });
    try {
      const response = await fetch(`/api/api-automation/operations/${testCase.id}/links`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvedTestCaseIds: next.approvedTestCaseIds }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "追溯关系保存失败");
      }
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "追溯关系保存失败";
      setError(detail);
      message.error("追溯关系保存失败，流程已停止");
    }
  }

  async function executeRun() {
    if (!spec) {
      message.warning("请先选择项目环境并导入 OpenAPI");
      return;
    }
    if (mappedCount === 0) {
      message.warning("至少需要把一个 API operation 关联到 Approved TestCase");
      return;
    }
    setRunning(true);
    setError(undefined);
    setRun(undefined);
    try {
      const response = await fetch("/api/api-automation/test-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          specId: spec.id,
          auth: { type: authType, token, username, password },
        }),
      });
      const body = (await response.json()) as TestRunRecord | { error?: string };
      if (!response.ok && !("items" in body)) {
        throw new Error("error" in body && body.error ? body.error : "Schemathesis 运行失败");
      }
      const completedRun = body as TestRunRecord;
      setRun(completedRun);
      setRuns((current) => [completedRun, ...current]);
      if (completedRun.status === "error") {
        throw new Error("Schemathesis Runner 失败，已保留原始错误并停止");
      }
      message[completedRun.status === "passed" ? "success" : "warning"](
        completedRun.status === "passed" ? "API 测试通过" : "API 测试发现失败",
      );
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "Schemathesis 运行失败";
      setError(detail);
      message.error("API 测试已停在失败点");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="api-testing-page">
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={9}>
          <Card className="api-config-card" title={<Space><CloudUploadOutlined />导入与运行</Space>}>
            <div className="api-field">
              <Text strong>已保存的 OpenAPI</Text>
              <Select
                allowClear
                value={spec?.id}
                placeholder="选择历史契约，或清空后导入新契约"
                onChange={(value) => {
                  const selected = specs.find((item) => item.id === value);
                  setSpec(selected);
                  setRun(selected ? runs.find((item) => item.specId === selected.id) : undefined);
                  if (selected) {
                    setProjectId(selected.projectId);
                    setEnvironmentId(selected.environmentId);
                    setApprovedVersionId(selected.approvedVersionId);
                  }
                }}
                options={specs.map((item) => ({
                  value: item.id,
                  label: `${item.name} · ${item.filename}`,
                }))}
              />
              <Text type="secondary">刷新页面后会恢复最近契约、映射和 TestRun；清空选择即可导入新的契约。</Text>
            </div>
            <div className="api-field">
              <Text strong>项目</Text>
              <Select
                value={projectId || undefined}
                loading={configLoading}
                disabled={Boolean(spec)}
                placeholder="请先到项目配置创建项目"
                onChange={(value) => {
                  setProjectId(value);
                  setEnvironmentId(projects.find((item) => item.id === value)?.environments[0]?.id ?? "");
                }}
                options={projects.map((item) => ({ value: item.id, label: `${item.name} · ${item.code}` }))}
              />
            </div>
            <div className="api-field">
              <Text strong>测试环境</Text>
              <Select
                value={environmentId || undefined}
                disabled={Boolean(spec) || !project}
                placeholder={project ? "请选择测试环境" : "请先选择项目"}
                onChange={setEnvironmentId}
                options={(project?.environments ?? []).map((item) => ({ value: item.id, label: `${item.name} · ${item.baseUrl}` }))}
              />
              {!configLoading && projects.length === 0 && <Alert type="warning" showIcon message="尚未配置项目" description="请先打开左侧“项目配置”，创建项目和测试环境。" />}
              {!configLoading && project && project.environments.length === 0 && <Alert type="warning" showIcon message="该项目没有测试环境" description="请先在“项目配置”中新增测试环境。" />}
            </div>
            <div className="api-field">
              <Text strong>Approved TestCase 版本</Text>
              <Select
                value={approvedVersionId || undefined}
                disabled={Boolean(spec)}
                placeholder="请先在智能测试设计中批准一个版本"
                onChange={(value) => setApprovedVersionId(value)}
                options={approvedVersions.map((item) => ({
                  value: item.id,
                  label: `v${item.version} · ${item.testCases.length} 条 · ${item.approvedBy}`,
                }))}
              />
              <Text type="secondary">只允许不可覆盖的 Approved 版本进入自动化；RAG 不是执行前置条件。</Text>
            </div>
            <Dragger
              accept=".json,.yaml,.yml"
              maxCount={1}
              fileList={specFile ? [specFile] : []}
              beforeUpload={() => false}
              onChange={({ fileList }) => setSpecFile(fileList[0])}
              onRemove={() => {
                setSpecFile(undefined);
                return true;
              }}
            >
              <p className="ant-upload-drag-icon"><ApiOutlined /></p>
              <p className="ant-upload-text">选择 OpenAPI JSON/YAML</p>
              <p className="ant-upload-hint">导入后识别 operation，再与批准用例建立人工映射</p>
            </Dragger>
            <Button block type="primary" onClick={() => void importSpec()} loading={importing} className="api-import-button">
              导入 OpenAPI
            </Button>

            {environment && <Alert type="success" showIcon message={`${project?.name} / ${environment.name}`} description={`${environment.baseUrl} · ${environment.headers.length} 条公共 Header`} />}
            <div className="api-field">
              <Text strong>Auth</Text>
              <Select
                value={authType}
                onChange={setAuthType}
                options={[
                  { value: "none", label: "无鉴权" },
                  { value: "bearer", label: "Bearer Token" },
                  { value: "basic", label: "Basic Auth" },
                ]}
              />
              {authType === "bearer" && (
                <Input.Password value={token} onChange={(event) => setToken(event.target.value)} placeholder="Token（不持久化）" />
              )}
              {authType === "basic" && (
                <Space.Compact block>
                  <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名" />
                  <Input.Password value={password} onChange={(event) => setPassword(event.target.value)} placeholder="密码" />
                </Space.Compact>
              )}
              <Text type="secondary" className="api-secret-note">Auth 仅用于本次运行，不写入数据库；公共 Header 从项目环境读取。</Text>
            </div>

            <Button
              block
              size="large"
              type="primary"
              icon={<PlayCircleOutlined />}
              disabled={!spec || mappedCount === 0}
              loading={running}
              onClick={() => void executeRun()}
            >
              运行 Schemathesis
            </Button>
            <Text type="secondary" className="api-run-note">4.29.3 · examples / coverage / fuzzing / stateful · deterministic · zero retry</Text>
          </Card>
        </Col>

        <Col xs={24} xl={15}>
          <Space direction="vertical" size={16} className="api-main-stack">
            {error && <Alert type="error" showIcon message="流程已停止" description={error} />}

            <Card title={<Space><LinkOutlined />Approved TestCase 与 API operation 映射</Space>}>
              {!spec ? (
                <Empty description="导入 OpenAPI 后显示 API 测试定义" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <>
                  <Flex justify="space-between" align="center" gap={12} wrap className="api-spec-heading">
                    <div>
                      <Title level={5}>{spec.name}</Title>
                      <Text type="secondary">{spec.filename} · {spec.version || "未声明版本"}</Text>
                    </div>
                    <Space>
                      <Tag color="blue">{spec.testCases.length} 个 operation</Tag>
                      <Tag color={mappedCount > 0 ? "green" : "default"}>{mappedCount} 个待执行</Tag>
                    </Space>
                  </Flex>
                  {!approvedVersion && (
                    <Alert
                      type="warning"
                      showIcon
                      message="Approved TestCase 版本不可用"
                      description="请返回智能测试设计，完成逐条评审并建立 Approved TestCase 版本。"
                      className="api-trace-warning"
                    />
                  )}
                  <Alert
                    type="info"
                    showIcon
                    message="只执行已映射 operation"
                    description="未映射接口会明确排除，不会让模型自动猜测业务关系。Schemathesis 根据 OpenAPI 生成请求；映射只负责结果回链。"
                    className="api-trace-warning"
                  />
                  <List
                    dataSource={spec.testCases}
                    renderItem={(testCase) => (
                      <List.Item>
                        <Card size="small" className="api-operation-card">
                          <Flex gap={9} align="center" wrap>
                            <Tag color={methodColor(testCase.method)}>{testCase.method}</Tag>
                            <Text code>{testCase.path}</Text>
                            <Text type="secondary">{testCase.summary || testCase.operationId}</Text>
                          </Flex>
                          <Row gutter={[10, 10]} className="api-link-row">
                            <Col xs={24}>
                              <Select
                                mode="multiple"
                                value={testCase.approvedTestCaseIds}
                                onChange={(ids) => void updateLinks(testCase, ids)}
                                placeholder="选择该接口支撑的 Approved TestCase；留空则不执行此接口"
                                options={(approvedVersion?.testCases ?? []).map((item) => ({
                                  value: item.id,
                                  label: `${item.id} · ${item.title}`,
                                }))}
                              />
                            </Col>
                          </Row>
                        </Card>
                      </List.Item>
                    )}
                  />
                </>
              )}
            </Card>

            {run && (
              <Card title={<Space><SafetyCertificateOutlined />最近一次 TestRun</Space>}>
                <Flex justify="space-between" align="center" gap={12} wrap>
                  <Space>
                    {run.status === "passed" ? <CheckCircleOutlined className="success-icon" /> : <WarningOutlined className="run-warning-icon" />}
                    <Text strong>{run.status === "passed" ? "测试通过" : run.status === "failed" ? "发现失败" : "Runner 错误"}</Text>
                  </Space>
                  <Text type="secondary">{run.targetBaseUrl}</Text>
                </Flex>
                <Row gutter={[12, 12]} className="metric-row">
                  <Col xs={8}><Statistic title="Generated examples" value={run.generatedExamples} /></Col>
                  <Col xs={8}><Statistic title="通过" value={run.passed} /></Col>
                  <Col xs={8}><Statistic title="失败" value={run.failed} /></Col>
                </Row>
                <FailureDetails run={run} />
              </Card>
            )}
          </Space>
        </Col>
      </Row>
    </div>
  );
}

export default function ApiTesting() {
  return (
    <Tabs
      defaultActiveKey="contract"
      items={[
        { key: "contract", label: "契约生成测试 · Schemathesis", children: <ContractApiTesting /> },
        { key: "scenario", label: "业务场景执行 · Hurl", children: <ApiScenarioTesting /> },
      ]}
    />
  );
}
