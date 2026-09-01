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
  Tag,
  Typography,
  Upload,
  type UploadFile,
} from "antd";
import TextArea from "antd/es/input/TextArea";
import { useEffect, useMemo, useState } from "react";
import type {
  OpenApiSpecRecord,
  TestCaseRecord,
  TestRunRecord,
  TraceEvidence,
  TraceRequirement,
} from "./types";

const { Title, Text } = Typography;
const { Dragger } = Upload;

function methodColor(method: string): string {
  return ({ GET: "green", POST: "blue", PUT: "gold", PATCH: "purple", DELETE: "red" } as Record<string, string>)[
    method
  ] ?? "default";
}

function parseHeaders(value: string): Array<{ name: string; value: string }> {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator <= 0) throw new Error(`Header 格式错误：${line}`);
      return { name: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() };
    });
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

export default function ApiTesting() {
  const { message } = AntdApp.useApp();
  const [specFile, setSpecFile] = useState<UploadFile>();
  const [spec, setSpec] = useState<OpenApiSpecRecord>();
  const [requirements, setRequirements] = useState<TraceRequirement[]>([]);
  const [evidence, setEvidence] = useState<TraceEvidence[]>([]);
  const [targetBaseUrl, setTargetBaseUrl] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [authType, setAuthType] = useState<"none" | "bearer" | "basic">("none");
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [importing, setImporting] = useState(false);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<TestRunRecord>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void fetch("/api/p02/trace-sources")
      .then(async (response) => {
        if (!response.ok) throw new Error(`追溯数据加载失败（HTTP ${response.status}）`);
        return (await response.json()) as { requirements: TraceRequirement[]; evidence: TraceEvidence[] };
      })
      .then((body) => {
        setRequirements(body.requirements);
        setEvidence(body.evidence);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "追溯数据加载失败"));
  }, []);

  const allLinked = useMemo(
    () =>
      Boolean(spec?.testCases.length) &&
      spec?.testCases.every((testCase) => testCase.requirementIds.length > 0 && testCase.evidenceIds.length > 0),
    [spec],
  );

  async function importSpec() {
    const file = specFile?.originFileObj;
    if (!file) {
      message.warning("请选择 OpenAPI JSON/YAML 文件");
      return;
    }
    setImporting(true);
    setError(undefined);
    setRun(undefined);
    try {
      const form = new FormData();
      form.append("spec", file, specFile.name);
      const response = await fetch("/api/p02/openapi", { method: "POST", body: form });
      const body = (await response.json()) as OpenApiSpecRecord | { error?: string };
      if (!response.ok) throw new Error("error" in body && body.error ? body.error : "OpenAPI 导入失败");
      setSpec(body as OpenApiSpecRecord);
      message.success("OpenAPI 已导入并生成 TestCase 定义");
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
    kind: "requirementIds" | "evidenceIds",
    ids: string[],
  ) {
    if (!spec) return;
    const next = { ...testCase, [kind]: ids };
    setSpec({
      ...spec,
      testCases: spec.testCases.map((item) => (item.id === testCase.id ? next : item)),
    });
    try {
      const response = await fetch(`/api/p02/test-cases/${testCase.id}/links`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requirementIds: next.requirementIds, evidenceIds: next.evidenceIds }),
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
    if (!spec || !targetBaseUrl.trim()) {
      message.warning("请先导入 OpenAPI 并填写 Target Base URL");
      return;
    }
    if (!allLinked) {
      message.warning("每个 TestCase 必须关联至少一条需求和一条证据");
      return;
    }
    setRunning(true);
    setError(undefined);
    setRun(undefined);
    try {
      const response = await fetch("/api/p02/test-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          specId: spec.id,
          targetBaseUrl: targetBaseUrl.trim(),
          headers: parseHeaders(headersText),
          auth: { type: authType, token, username, password },
        }),
      });
      const body = (await response.json()) as TestRunRecord | { error?: string };
      if (!response.ok && !("items" in body)) {
        throw new Error("error" in body && body.error ? body.error : "Schemathesis 运行失败");
      }
      const completedRun = body as TestRunRecord;
      setRun(completedRun);
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
              <p className="ant-upload-hint">导入后每条 operation 生成一条 TestCase 定义</p>
            </Dragger>
            <Button block type="primary" onClick={() => void importSpec()} loading={importing} className="api-import-button">
              导入 OpenAPI
            </Button>

            <div className="api-field">
              <Text strong>Target Base URL</Text>
              <Input
                value={targetBaseUrl}
                onChange={(event) => setTargetBaseUrl(event.target.value)}
                placeholder="例如：http://127.0.0.1:8080"
              />
            </div>
            <div className="api-field">
              <Text strong>Header</Text>
              <TextArea
                value={headersText}
                onChange={(event) => setHeadersText(event.target.value)}
                rows={3}
                placeholder={"每行一条，例如：\nX-Tenant-ID: demo"}
              />
            </div>
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
              <Text type="secondary" className="api-secret-note">Header/Auth 仅用于本次运行，不写入数据库。</Text>
            </div>

            <Button
              block
              size="large"
              type="primary"
              icon={<PlayCircleOutlined />}
              disabled={!spec || !allLinked}
              loading={running}
              onClick={() => void executeRun()}
            >
              运行 Schemathesis
            </Button>
            <Text type="secondary" className="api-run-note">4.24.3 · 单 worker · deterministic · zero retry</Text>
          </Card>
        </Col>

        <Col xs={24} xl={15}>
          <Space direction="vertical" size={16} className="api-main-stack">
            {error && <Alert type="error" showIcon message="流程已停止" description={error} />}

            <Card title={<Space><LinkOutlined />TestCase 与追溯关系</Space>}>
              {!spec ? (
                <Empty description="导入 OpenAPI 后显示 API 测试定义" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <>
                  <Flex justify="space-between" align="center" gap={12} wrap className="api-spec-heading">
                    <div>
                      <Title level={5}>{spec.name}</Title>
                      <Text type="secondary">{spec.filename} · {spec.version || "未声明版本"}</Text>
                    </div>
                    <Tag color="blue">{spec.testCases.length} 个 TestCase</Tag>
                  </Flex>
                  {requirements.length === 0 && (
                    <Alert
                      type="warning"
                      showIcon
                      message="暂无可关联需求"
                      description="先在 AI 需求分析中完成一次分析，结果会写入 SQLite。"
                      className="api-trace-warning"
                    />
                  )}
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
                            <Col xs={24} md={12}>
                              <Select
                                mode="multiple"
                                value={testCase.requirementIds}
                                onChange={(ids) => void updateLinks(testCase, "requirementIds", ids)}
                                placeholder="关联需求"
                                options={requirements.map((item) => ({
                                  value: item.id,
                                  label: `${item.externalId} · ${item.title}`,
                                }))}
                              />
                            </Col>
                            <Col xs={24} md={12}>
                              <Select
                                mode="multiple"
                                value={testCase.evidenceIds}
                                onChange={(ids) => void updateLinks(testCase, "evidenceIds", ids)}
                                placeholder="关联证据"
                                options={evidence.map((item) => ({
                                  value: item.id,
                                  label: `${item.externalId} · ${item.sourceName} ${item.locator}`,
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
