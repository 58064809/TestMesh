import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  CodeOutlined,
  ExperimentOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Empty,
  Flex,
  Input,
  List,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Steps,
  Tag,
  Typography,
  Upload,
  type UploadFile,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import type {
  TestDesignAnalysis,
  TestDesignCaseRecord,
  TestDesignGenerationResponse,
  TestDesignProgress,
  TestDesignStreamEvent,
} from "./types";

const { Dragger } = Upload;
const { Paragraph, Text } = Typography;
const ACCEPT = ".pdf,.txt,.md,.json,.html,.xml,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.rtf,.odt,.ppt,.pptx";
const DOCUMENT_FORMATS = "PDF、TXT、MD、JSON、HTML、XML、DOC、DOCX、RTF、ODT、PPT、PPTX";
const IMAGE_FORMATS = "PNG、JPG/JPEG、WEBP、GIF";
const PRIORITY_META: Record<TestDesignCaseRecord["priority"], { label: string; color: string }> = {
  must: { label: "必须", color: "red" },
  should: { label: "应该", color: "gold" },
  could: { label: "可选", color: "blue" },
};

function revealExpandedCase(id: string, activeKeys: string | string[]) {
  const keys = Array.isArray(activeKeys) ? activeKeys : [activeKeys];
  if (!keys.includes("detail")) return;
  window.requestAnimationFrame(() => {
    document.getElementById(`test-case-${id}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
}

interface AutomationForm {
  repoPath: string;
  automationFile: string;
  writeAuthorized: boolean;
  runAuthorized: boolean;
}

function TraceEvidence({
  testCase,
  analysis,
}: {
  testCase: TestDesignCaseRecord;
  analysis: TestDesignAnalysis | undefined;
}) {
  const requirements = testCase.requirementIds.map((id) => analysis?.requirements.find((item) => item.id === id)).filter(Boolean);
  const risks = testCase.riskIds.map((id) => analysis?.risks.find((item) => item.id === id)).filter(Boolean);
  const evidence = testCase.evidenceIds.map((id) => analysis?.evidence.find((item) => item.id === id)).filter(Boolean);
  return (
    <div className="test-design-evidence-list">
      <Text strong>证据（{requirements.length + risks.length + evidence.length}）</Text>
      {requirements.map((item) => item && (
        <Card size="small" key={item.id} className="test-design-evidence-item">
          <Space size={[6, 6]} wrap>
            <Tag color="blue">需求分析 · 需求</Tag>
            <Text code>{item.externalId}</Text>
            <Text strong>{item.title}</Text>
          </Space>
          <Paragraph>{item.description}</Paragraph>
        </Card>
      ))}
      {risks.map((item) => item && (
        <Card size="small" key={item.id} className="test-design-evidence-item">
          <Space size={[6, 6]} wrap>
            <Tag color="orange">需求分析 · 风险</Tag>
            <Text code>{item.externalId}</Text>
            <Text strong>{item.title}</Text>
          </Space>
          <Paragraph>{item.description}</Paragraph>
        </Card>
      ))}
      {evidence.map((item) => item && (
        <Card size="small" key={item.id} className="test-design-evidence-item">
          <Space size={[6, 6]} wrap>
            <Tag color="geekblue">原始 PRD / 资料</Tag>
            <Text code>{item.externalId}</Text>
            <Text>{item.sourceName} · {item.locator || "定位受限"}</Text>
          </Space>
          <blockquote>{item.excerpt || "该证据来自图片或视觉内容，没有可摘录文字。"}</blockquote>
        </Card>
      ))}
    </div>
  );
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `请求失败（HTTP ${response.status}）`);
  return body;
}

async function readGenerationStream(
  response: Response,
  onEvent: (event: TestDesignStreamEvent) => void,
): Promise<void> {
  if (!response.ok) {
    await json<never>(response);
    return;
  }
  if (!response.body) throw new Error("浏览器没有收到生成进度流");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const consumeLine = (line: string) => {
    if (line.trim()) onEvent(JSON.parse(line) as TestDesignStreamEvent);
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consumeLine(line);
    if (done) break;
  }
  consumeLine(buffer);
}

export default function TestDesign() {
  const { message } = App.useApp();
  const [analyses, setAnalyses] = useState<TestDesignAnalysis[]>([]);
  const [analysisId, setAnalysisId] = useState<string>();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [cases, setCases] = useState<TestDesignCaseRecord[]>([]);
  const [forms, setForms] = useState<Record<string, AutomationForm>>({});
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string>();
  const [error, setError] = useState<string>();
  const [usage, setUsage] = useState<TestDesignGenerationResponse["usage"]>();
  const [generationReview, setGenerationReview] = useState<Pick<TestDesignGenerationResponse, "sourceReviews" | "coverageReview" | "qualityReview">>();
  const [generationProgress, setGenerationProgress] = useState<TestDesignProgress>();

  const selectedAnalysis = useMemo(
    () => analyses.find((item) => item.id === analysisId),
    [analyses, analysisId],
  );

  useEffect(() => {
    void Promise.all([
      fetch("/api/p05/analyses").then((response) => json<TestDesignAnalysis[]>(response)),
      fetch("/api/p05/test-cases").then((response) => json<TestDesignCaseRecord[]>(response)),
    ]).then(([analysisRows, caseRows]) => {
      setAnalyses(analysisRows);
      setCases(caseRows);
      setAnalysisId(analysisRows.find((item) => item.analysisFormat === "legacy")?.id ?? analysisRows[0]?.id);
    }).catch((caught) => setError(caught instanceof Error ? caught.message : "数据加载失败"));
  }, []);

  useEffect(() => {
    if (!cases.some((item) => item.engineeringTaskStatus === "queued" || item.engineeringTaskStatus === "starting" || item.engineeringTaskStatus === "running")) return;
    const timer = window.setInterval(() => {
      void fetch("/api/p05/test-cases")
        .then((response) => json<TestDesignCaseRecord[]>(response))
        .then(setCases)
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [cases]);

  function updateForm(id: string, patch: Partial<AutomationForm>) {
    setForms((current) => ({
      ...current,
      [id]: {
        repoPath: current[id]?.repoPath ?? "",
        automationFile: current[id]?.automationFile ?? `tests/generated/testmesh-${id.slice(0, 8)}.spec.ts`,
        writeAuthorized: current[id]?.writeAuthorized ?? false,
        runAuthorized: current[id]?.runAuthorized ?? false,
        ...patch,
      },
    }));
  }

  async function generate() {
    if (!analysisId) return message.warning("请选择真实分析结果");
    if (selectedAnalysis?.analysisFormat === "requirement-analysis") {
      return message.warning("新需求分析协议尚未进入 P05 测试设计；请先选择旧真实分析结果");
    }
    if (files.length === 0) return message.warning("请重新上传该分析对应的原始 PRD");
    const formData = new FormData();
    formData.append("analysisId", analysisId);
    for (const file of files) {
      if (file.originFileObj) formData.append("prd", file.originFileObj, file.name);
    }
    setLoading(true);
    setError(undefined);
    setGenerationReview(undefined);
    setGenerationProgress(undefined);
    try {
      let completed = false;
      await fetch("/api/p05/test-cases/generate", { method: "POST", body: formData })
        .then((response) => readGenerationStream(response, (event) => {
          if (event.type === "progress") {
            setGenerationProgress(event.progress);
            return;
          }
          if (event.type === "batch_saved") {
            setCases((current) => {
              const incoming = new Set(event.testCases.map((item) => item.id));
              return [...event.testCases, ...current.filter((item) => !incoming.has(item.id))];
            });
            return;
          }
          if (event.type === "error") {
            const saved = event.savedCaseCount > 0 && !event.error.includes("已保留")
              ? `；已保留 ${event.savedCaseCount} 条通过审查的草稿`
              : "";
            throw new Error(`${event.error}${saved}`);
          }
          completed = true;
          setUsage(event.usage);
          setGenerationReview({
            sourceReviews: event.sourceReviews,
            coverageReview: event.coverageReview,
            qualityReview: event.qualityReview,
          });
          message.success(`已生成并保存 ${event.savedCaseCount} 条测试用例草稿`);
        }));
      if (!completed) throw new Error("生成进度流提前结束");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "测试用例生成失败");
    } finally {
      setLoading(false);
    }
  }

  async function approve(id: string) {
    setActionId(id);
    setError(undefined);
    try {
      const updated = await fetch(`/api/p05/test-cases/${id}/approve`, { method: "POST" })
        .then((response) => json<TestDesignCaseRecord>(response));
      setCases((current) => current.map((item) => item.id === id ? updated : item));
      message.success("测试用例已人工批准");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "批准失败");
    } finally {
      setActionId(undefined);
    }
  }

  async function automate(testCase: TestDesignCaseRecord) {
    const form = forms[testCase.id];
    if (!form?.writeAuthorized) return message.warning("请先勾选 OpenHands 写入授权");
    setActionId(testCase.id);
    setError(undefined);
    try {
      const updated = await fetch(`/api/p05/test-cases/${testCase.id}/automation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath: form.repoPath, automationFile: form.automationFile, authorized: true }),
      }).then((response) => json<TestDesignCaseRecord>(response));
      setCases((current) => current.map((item) => item.id === testCase.id ? updated : item));
      message.success("OpenHands 代码生成任务已启动");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "代码生成未启动");
    } finally {
      setActionId(undefined);
    }
  }

  async function run(testCase: TestDesignCaseRecord) {
    const form = forms[testCase.id];
    if (!form?.runAuthorized) return message.warning("请先勾选 Playwright 执行授权");
    setActionId(testCase.id);
    setError(undefined);
    try {
      const updated = await fetch(`/api/p05/test-cases/${testCase.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorized: true }),
      }).then((response) => json<TestDesignCaseRecord>(response));
      setCases((current) => current.map((item) => item.id === testCase.id ? updated : item));
      message.success("Playwright TestRun 已保存并完成追溯");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "测试未启动");
    } finally {
      setActionId(undefined);
    }
  }

  return (
    <div className="test-design-page">
      <Alert
        type="info"
        showIcon
        message="唯一生成路径：原始 PRD + 已保存的真实分析结果"
        description="P01 不保存原始附件，请重新选择同一份 PRD。生成不设固定条数，每条用例至少包含 1 条真实需求分析或 PRD 证据；当前未接入 RAG，不会虚构 RAG 证据。PDF 正文和页面图片都会进入审阅。用例先作为草稿保存，人工批准后才能授权 OpenHands 写代码。"
      />
      {error && <Alert type="error" showIcon message="流程已停止" description={error} closable onClose={() => setError(undefined)} />}

      <Card title={<Space><ExperimentOutlined />生成测试用例草稿</Space>}>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Text strong>1. 选择真实分析结果</Text>
            <Select
              value={analysisId}
              onChange={setAnalysisId}
              style={{ width: "100%", marginTop: 8 }}
              placeholder="暂无已保存的分析结果"
              options={analyses.map((item) => ({
                value: item.id,
                label: `${item.summary || "无概述"} · ${new Date(item.createdAt).toLocaleString()}${item.analysisFormat === "requirement-analysis" ? " · 新协议待适配" : ""}`,
              }))}
            />
            {selectedAnalysis && (
              <Space size={[6, 6]} wrap style={{ marginTop: 10 }}>
                <Tag>需求 {selectedAnalysis.requirements.length}</Tag>
                <Tag color="orange">风险 {selectedAnalysis.risks.length}</Tag>
                <Tag color="geekblue">证据 {selectedAnalysis.evidence.length}</Tag>
              </Space>
            )}
            {selectedAnalysis?.analysisFormat === "requirement-analysis" && (
              <Alert style={{ marginTop: 10 }} type="warning" showIcon message="这份分析使用新的固定协议" description="当前 P05 测试设计仍依赖旧 Risk 输入，尚未适配。这里会在请求前停止，不会用空 Risk 假装完成风险分析。" />
            )}
          </Col>
          <Col xs={24} lg={12}>
            <Text strong>2. 重新上传对应原始 PRD</Text>
            <Dragger
              accept={ACCEPT}
              multiple
              fileList={files}
              beforeUpload={() => false}
              onChange={({ fileList }) => setFiles(fileList.slice(0, 6))}
              style={{ marginTop: 8 }}
            >
              <p className="ant-upload-drag-icon"><CloudUploadOutlined /></p>
              <p className="ant-upload-text">选择 PRD、截图或配套资料</p>
              <div className="test-design-upload-formats">
                <div><Text type="secondary">PRD / 配套资料</Text><span>{DOCUMENT_FORMATS}</span></div>
                <div><Text type="secondary">截图</Text><span>{IMAGE_FORMATS}</span></div>
                <div className="test-design-upload-limit">最多 6 个文件，单个不超过 8 MB；Office 文件只抽取文本，建议优先使用 PDF。</div>
              </div>
            </Dragger>
          </Col>
        </Row>
        <Flex justify="flex-end" align="center" gap={12} style={{ marginTop: 16 }}>
          {usage && <Text type="secondary">上次生成共 {usage.totalTokens.toLocaleString()} tokens</Text>}
          <Button type="primary" icon={<ExperimentOutlined />} loading={loading} disabled={selectedAnalysis?.analysisFormat === "requirement-analysis"} onClick={() => void generate()}>
            结合 PRD 与分析结果生成草稿
          </Button>
        </Flex>
        {generationReview && (
          <Alert
            style={{ marginTop: 16 }}
            type="success"
            showIcon
            message="本次生成已通过来源、覆盖与独立质量审查"
            description={`已审阅 ${generationReview.sourceReviews.length} 个来源，记录 ${generationReview.sourceReviews.reduce((count, item) => count + item.visualFindings.length, 0)} 条视觉发现；已逐项核对 ${generationReview.coverageReview.requirements.length} 条需求、${generationReview.coverageReview.acceptanceCriteria.length} 条验收标准和 ${generationReview.coverageReview.risks.length} 条风险。质量结论：${generationReview.qualityReview.summary}`}
          />
        )}
        {loading && generationProgress && (
          <Alert
            style={{ marginTop: 16 }}
            type="info"
            showIcon
            message={generationProgress.message}
            description={(
              <Space direction="vertical" style={{ width: "100%" }}>
                <Progress
                  percent={generationProgress.totalPartitions > 0
                    ? Math.round((generationProgress.completedPartitions / generationProgress.totalPartitions) * 100)
                    : 5}
                  status="active"
                  size="small"
                />
                <Text type="secondary">
                  已完成分区 {generationProgress.completedPartitions} / {generationProgress.totalPartitions || "待规划"}，已审核草稿 {generationProgress.acceptedCaseCount} 条
                </Text>
              </Space>
            )}
          />
        )}
      </Card>

      <Card title={`测试用例（${cases.length}）`}>
        {loading && cases.length === 0 ? <Spin /> : cases.length === 0 ? <Empty description="尚未生成测试用例草稿" /> : (
          <List
            dataSource={cases}
            renderItem={(item, index) => {
              const analysis = analyses.find((row) => row.id === item.analysisId);
              const priority = PRIORITY_META[item.priority];
              const form = forms[item.id] ?? {
                repoPath: item.automationRepoPath,
                automationFile: item.automationFile || `tests/generated/testmesh-${item.id.slice(0, 8)}.spec.ts`,
                writeAuthorized: false,
                runAuthorized: false,
              };
              const latestRun = item.uiRuns[0];
              const taskDone = item.engineeringTaskStatus === "completed";
              return (
                <List.Item>
                  <Card id={`test-case-${item.id}`} className="test-design-case" size="small" style={{ width: "100%" }}>
                    <Flex justify="space-between" gap={12} wrap>
                      <Space><Tag>{index + 1}</Tag><Text strong>{item.title}</Text></Space>
                      <Space>
                        <Tag color={priority.color}>{priority.label}</Tag>
                        <Tag color={item.reviewStatus === "approved" ? "green" : "default"}>{item.reviewStatus === "approved" ? "已批准" : "草稿"}</Tag>
                      </Space>
                    </Flex>
                    <Paragraph style={{ marginTop: 12 }}>{item.objective}</Paragraph>
                    <Collapse
                      size="small"
                      onChange={(activeKeys) => revealExpandedCase(item.id, activeKeys)}
                      items={[{
                        key: "detail",
                        label: "查看步骤、预期结果与真实追溯",
                        children: (
                          <Space direction="vertical" style={{ width: "100%" }}>
                            <Text strong>前置条件</Text><ul>{item.preconditions.map((value) => <li key={value}>{value}</li>)}</ul>
                            <Text strong>步骤</Text><ol>{item.steps.map((value) => <li key={value}>{value}</li>)}</ol>
                            <Text strong>预期结果</Text><ul>{item.expectedResults.map((value) => <li key={value}>{value}</li>)}</ul>
                            <TraceEvidence testCase={item} analysis={analysis} />
                          </Space>
                        ),
                      }]}
                    />

                    {item.reviewStatus === "draft" ? (
                      <Button type="primary" icon={<CheckCircleOutlined />} loading={actionId === item.id} onClick={() => void approve(item.id)} style={{ marginTop: 12 }}>
                        人工评审并批准
                      </Button>
                    ) : (
                      <div style={{ marginTop: 16 }}>
                        <Steps
                          size="small"
                          current={latestRun ? 3 : taskDone ? 2 : item.engineeringTaskId ? 1 : 0}
                          items={[{ title: "已批准" }, { title: "生成代码" }, { title: "代码完成" }, { title: "TestRun" }]}
                        />
                        <Row gutter={[12, 12]} style={{ marginTop: 14 }}>
                          <Col xs={24} md={12}><Input value={form.repoPath} disabled={Boolean(item.engineeringTaskId)} placeholder="目标 Git 仓库绝对路径" onChange={(event) => updateForm(item.id, { repoPath: event.target.value })} /></Col>
                          <Col xs={24} md={12}><Input value={form.automationFile} disabled={Boolean(item.engineeringTaskId)} placeholder="tests/generated/example.spec.ts" onChange={(event) => updateForm(item.id, { automationFile: event.target.value })} /></Col>
                        </Row>
                        {!item.engineeringTaskId && (
                          <Flex justify="space-between" align="center" gap={12} wrap style={{ marginTop: 10 }}>
                            <Checkbox checked={form.writeAuthorized} onChange={(event) => updateForm(item.id, { writeAuthorized: event.target.checked })}>授权 OpenHands 只写入上述单个测试文件</Checkbox>
                            <Button icon={<CodeOutlined />} loading={actionId === item.id} onClick={() => void automate(item)}>生成 Playwright 代码</Button>
                          </Flex>
                        )}
                        {item.engineeringTaskId && !taskDone && <Alert style={{ marginTop: 10 }} type={item.engineeringTaskStatus === "failed" || item.engineeringTaskStatus === "stopped" ? "error" : "info"} showIcon message={`OpenHands 状态：${item.engineeringTaskStatus}`} />}
                        {taskDone && !latestRun && (
                          <Flex justify="space-between" align="center" gap={12} wrap style={{ marginTop: 10 }}>
                            <Checkbox checked={form.runAuthorized} onChange={(event) => updateForm(item.id, { runAuthorized: event.target.checked })}>授权一次性 Playwright 容器执行该测试</Checkbox>
                            <Button type="primary" icon={<PlayCircleOutlined />} loading={actionId === item.id} onClick={() => void run(item)}>运行并建立追溯</Button>
                          </Flex>
                        )}
                        {latestRun && <Alert style={{ marginTop: 10 }} type={latestRun.status === "passed" ? "success" : "error"} showIcon message={`TestRun ${latestRun.status} · 通过 ${latestRun.passed} / 失败 ${latestRun.failed}`} description={`${item.automationRepoPath} · ${item.automationFile}`} />}
                      </div>
                    )}
                  </Card>
                </List.Item>
              );
            }}
          />
        )}
      </Card>
    </div>
  );
}
