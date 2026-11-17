import { ApiOutlined, CheckCircleOutlined, ExperimentOutlined, LinkOutlined, PlayCircleOutlined, SettingOutlined, WarningOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Input, List, Progress, Select, Space, Tag, Typography, message } from "antd";
import { useEffect, useState } from "react";

const { Text } = Typography;

interface DatasetExport {
  id: string;
  datasetName: string;
  datasetVersionId: string;
  exampleCount: number;
  createdAt: string;
  dataClass: "test-plan-manifest" | "evaluation-dataset";
}

interface ExecutionAsset {
  id: string;
  name: string;
  approvedTestCaseIds: string[];
  valid: boolean;
  problem: string;
  targetId: string;
  targetVersion: string;
  interaction: string;
  evaluatorNames: string[];
}

interface Readiness {
  datasetExportId: string;
  datasetId: string;
  datasetVersionId: string;
  approvedTestCaseVersionId: string;
  totalAiTestCases: number;
  mappedAiTestCases: number;
  validExecutionAssets: number;
  missingTestCaseIds: string[];
  aiTestCases: Array<{
    id: string;
    title: string;
    objective: string;
    dimension: string;
    priority: string;
    evaluator: string;
    executionStatus: "missing" | "mapped" | "duplicate";
  }>;
  duplicateTestCaseIds: string[];
  invalidAssets: ExecutionAsset[];
  assets: ExecutionAsset[];
  ready: boolean;
  gateEligible: false;
  blockers: string[];
}

interface ExperimentRun {
  id: string;
  datasetExportId: string;
  experimentId: string;
  projectName: string;
  dataClass: "production-candidate";
  status: "execution-only";
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  evaluatorNames: string[];
  targetVersions: string[];
  gateEligible: false;
  requestedBy: string;
  createdAt: string;
}

async function readJson<T>(responseOrPromise: Response | Promise<Response>): Promise<T> {
  const response = await responseOrPromise;
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `请求失败（HTTP ${response.status}）`);
  return body;
}

export default function AiExperimentReadiness() {
  const [exports, setExports] = useState<DatasetExport[]>([]);
  const [exportId, setExportId] = useState("");
  const [readiness, setReadiness] = useState<Readiness>();
  const [experiments, setExperiments] = useState<ExperimentRun[]>([]);
  const [operator, setOperator] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void Promise.all([
      readJson<DatasetExport[]>(fetch("/api/ai-quality/dataset-exports", { cache: "no-store" })),
      readJson<ExperimentRun[]>(fetch("/api/ai-quality/experiments", { cache: "no-store" })),
    ])
      .then(([rows, runs]) => { setExports(rows); setExperiments(runs); setExportId(rows[0]?.id ?? ""); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "读取 Dataset 映射失败"));
  }, []);

  useEffect(() => {
    if (!exportId) return;
    void readJson<Readiness>(fetch(`/api/ai-quality/experiments/readiness/${encodeURIComponent(exportId)}`, { cache: "no-store" }))
      .then(setReadiness)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "执行准备度检查失败"));
  }, [exportId]);

  const coverage = readiness?.totalAiTestCases
    ? Math.round(readiness.mappedAiTestCases / readiness.totalAiTestCases * 100)
    : 0;
  const missingCases = readiness?.aiTestCases.filter((item) => item.executionStatus === "missing") ?? [];

  function navigate(page: "project-config" | "api") {
    window.dispatchEvent(new CustomEvent("testmesh:navigate", { detail: page }));
  }

  async function runExperiment() {
    if (!readiness?.ready || !operator.trim()) { message.warning("执行资产就绪后还需填写操作人"); return; }
    setRunning(true); setError("");
    try {
      const saved = await readJson<ExperimentRun>(fetch("/api/ai-quality/experiments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ datasetExportId: readiness.datasetExportId, requestedBy: operator.trim(), concurrency: 1 }),
      }));
      setExperiments((current) => [saved, ...current]);
      message.success("Phoenix Experiment 已完成执行层验证；语义质量评测仍需 AIAT04 Evaluator");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Phoenix Experiment 执行失败");
    } finally { setRunning(false); }
  }

  return <Card className="ai-experiment-readiness-card" title={<Space><ExperimentOutlined />Phoenix Experiment 执行准备度</Space>}>
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message="AIAT03 复用已批准 FastAPI YAML，不新增第二套 Harness"
        description="每条冻结 AI TestCase 必须唯一关联一个含 ai_application 契约的已批准 YAML 场景。Phoenix 负责 Dataset、Experiment 和 Evaluator；准备度通过仍不等于评测通过。"
      />
      {error && <Alert type="error" showIcon message="准备度检查未完成" description={error} />}
      <Select
        value={exportId || undefined}
        onChange={(value) => { setReadiness(undefined); setError(""); setExportId(value); }}
        placeholder="选择 Phoenix Dataset Version"
        style={{ minWidth: 360, maxWidth: "100%" }}
        options={exports.map((item) => ({ value: item.id, label: `${item.datasetName} · ${item.exampleCount} 条 · ${item.datasetVersionId}` }))}
      />
      <Space wrap>
        <Input value={operator} onChange={(event) => setOperator(event.target.value)} placeholder="操作人 *" style={{ width: 180 }} />
        <Button type="primary" icon={<PlayCircleOutlined />} loading={running} disabled={!readiness?.ready || !operator.trim()} onClick={() => void runExperiment()}>
          启动正式 Experiment
        </Button>
        {!readiness?.ready && <Text type="secondary">补齐并人工批准执行脚本后才会启用，不提供绕过入口。</Text>}
      </Space>
      {readiness && <>
        <Alert
          type={readiness.ready ? "success" : "warning"}
          showIcon
          icon={readiness.ready ? <CheckCircleOutlined /> : <WarningOutlined />}
          message={readiness.ready ? "执行资产已就绪，可以进入 Phoenix Experiment" : "尚不能启动正式 Phoenix Experiment"}
          description={readiness.blockers.join("；")}
        />
        <Progress percent={coverage} status={readiness.ready ? "success" : "active"} format={() => `${readiness.mappedAiTestCases}/${readiness.totalAiTestCases}`} />
        <Descriptions bordered size="small" column={{ xs: 1, lg: 3 }}>
          <Descriptions.Item label="冻结 AI 用例">{readiness.totalAiTestCases}</Descriptions.Item>
          <Descriptions.Item label="已映射用例">{readiness.mappedAiTestCases}</Descriptions.Item>
          <Descriptions.Item label="有效执行资产">{readiness.validExecutionAssets}</Descriptions.Item>
          <Descriptions.Item label="Dataset Version" span={2}><Text code copyable>{readiness.datasetVersionId}</Text></Descriptions.Item>
          <Descriptions.Item label="发布准入"><Tag color="red">否</Tag></Descriptions.Item>
        </Descriptions>
        {readiness.missingTestCaseIds.length > 0 && <List
          size="small"
          header={<Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
            <Text strong>待生成、人工修正并批准的 AI 执行脚本（{readiness.missingTestCaseIds.length}）</Text>
            <Space wrap>
              <Button size="small" icon={<SettingOutlined />} onClick={() => navigate("project-config")}>先检查项目契约</Button>
              <Button size="small" type="primary" icon={<ApiOutlined />} onClick={() => navigate("api")}>前往 API 自动化</Button>
            </Space>
          </Space>}
          dataSource={missingCases}
          pagination={missingCases.length > 8 ? { pageSize: 8, size: "small", showSizeChanger: false } : false}
          locale={{ emptyText: "没有缺失的 AI 执行脚本" }}
          renderItem={(item) => <List.Item>
            <List.Item.Meta
              avatar={<ApiOutlined style={{ fontSize: 18, color: "#1677ff", marginTop: 5 }} />}
              title={<Space wrap>
                <Text code copyable>{item.id}</Text>
                <Text strong>{item.title}</Text>
                <Tag color={item.priority === "P0" ? "red" : item.priority === "P1" ? "orange" : "blue"}>{item.priority}</Tag>
                <Tag>{item.dimension || "AI 行为"}</Tag>
              </Space>}
              description={<Space direction="vertical" size={2}>
                <Text type="secondary">{item.objective || "该用例尚未提供测试目标摘要"}</Text>
                <Text type="secondary">Evaluator：{item.evaluator || "待从 Approved TestCase 读取"} · 状态：尚未关联已批准 YAML 执行资产</Text>
              </Space>}
            />
          </List.Item>}
        />}
        {readiness.assets.length > 0 && <List
          size="small"
          header="已批准执行资产检查"
          dataSource={readiness.assets}
          renderItem={(item) => <List.Item>
            <List.Item.Meta
              title={<Space><Text strong>{item.name}</Text><Tag color={item.valid ? "green" : "red"}>{item.valid ? "契约有效" : "不可用于 AI Experiment"}</Tag></Space>}
              description={item.valid ? `${item.targetId}@${item.targetVersion} · ${item.interaction} · 关联 ${item.approvedTestCaseIds.length} 条用例` : item.problem}
            />
          </List.Item>}
        />}
        <List
          size="small"
          header="Phoenix Experiment 业务回链"
          dataSource={experiments.filter((item) => item.datasetExportId === readiness.datasetExportId)}
          locale={{ emptyText: "尚无 Experiment；Dataset 同步不等于执行完成" }}
          renderItem={(item) => <List.Item actions={[<Button key="phoenix" type="link" icon={<LinkOutlined />} href="http://127.0.0.1:6006/experiments" target="_blank">Phoenix</Button>]}>
            <List.Item.Meta
              title={<Space><Text code>{item.experimentId}</Text><Tag color="orange">执行层证据，非发布通过</Tag></Space>}
              description={`${item.successfulRuns}/${item.totalRuns} 运行成功，失败 ${item.failedRuns}；${item.requestedBy} · ${new Date(item.createdAt).toLocaleString("zh-CN")}`}
            />
          </List.Item>}
        />
      </>}
    </Space>
  </Card>;
}
