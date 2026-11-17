import {
  ApiOutlined,
  CheckCircleOutlined,
  ExperimentOutlined,
  FileDoneOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { Alert, Button, Card, Collapse, Descriptions, Flex, Select, Space, Spin, Steps, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApprovedTestModelVersion, ProjectRecord, RequirementBaselineRecord, TestDesignRecord } from "./types";
import TestDesign from "./TestDesign";
import TestModeling from "./TestModeling";
import TestConditions from "./TestConditions";
import AiEvaluationSamples from "./AiEvaluationSamples";
import AiExperimentReadiness from "./AiExperimentReadiness";
import EvaluatorCalibration from "./EvaluatorCalibration";

const { Title, Paragraph, Text } = Typography;

type FlowStep = "model" | "conditions" | "cases" | "dataset" | "run" | "result";

interface SampleSetSummary {
  id: string;
  approvedTestCaseVersionId: string;
  name: string;
  status: "draft" | "frozen";
  samples: Array<{ status: "draft" | "approved" | "rejected" }>;
}

interface DatasetExportSummary {
  id: string;
  approvedTestCaseVersionId: string;
  dataClass: "test-plan-manifest" | "evaluation-dataset";
  exampleCount: number;
  datasetVersionId: string;
}

interface ExperimentSummary {
  id: string;
  datasetExportId: string;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  createdAt: string;
}

interface ContractReadiness {
  projectId: string;
  ready: boolean;
  openApiContracts: Array<{ filename: string; valid: boolean; operationCount: number; error: string }>;
  agentContracts: Array<{ filename: string; valid: boolean; error: string }>;
  blockers: string[];
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `请求失败（HTTP ${response.status}）`);
  return payload;
}

const stepOrder: FlowStep[] = ["model", "conditions", "cases", "dataset", "run", "result"];

export default function AiAcceptance() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [step, setStep] = useState<FlowStep>("model");
  const [baselines, setBaselines] = useState<RequirementBaselineRecord[]>([]);
  const [baselineId, setBaselineId] = useState("");
  const [approvedTestModelVersionId, setApprovedTestModelVersionId] = useState<string>();
  const [approvedTestConditionVersionId, setApprovedTestConditionVersionId] = useState<string>();
  const [designs, setDesigns] = useState<TestDesignRecord[]>([]);
  const [sampleSets, setSampleSets] = useState<SampleSetSummary[]>([]);
  const [exports, setExports] = useState<DatasetExportSummary[]>([]);
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectId, setProjectId] = useState("");
  const [contract, setContract] = useState<ContractReadiness>();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [baselineRows, designRows, sampleRows, exportRows, experimentRows, projectRows] = await Promise.all([
        readJson<RequirementBaselineRecord[]>(await fetch("/api/requirement-baselines", { cache: "no-store" })),
        readJson<TestDesignRecord[]>(await fetch("/api/test-designs", { cache: "no-store" })),
        readJson<SampleSetSummary[]>(await fetch("/api/ai-quality/evaluation-sample-sets", { cache: "no-store" })),
        readJson<DatasetExportSummary[]>(await fetch("/api/ai-quality/dataset-exports", { cache: "no-store" })),
        readJson<ExperimentSummary[]>(await fetch("/api/ai-quality/experiments", { cache: "no-store" })),
        readJson<ProjectRecord[]>(await fetch("/api/projects", { cache: "no-store" })),
      ]);
      const sortedBaselines = [...baselineRows].sort((left, right) => Date.parse(right.approvedAt) - Date.parse(left.approvedAt));
      setBaselines(sortedBaselines);
      setDesigns(designRows);
      setSampleSets(sampleRows);
      setExports(exportRows);
      setExperiments(experimentRows);
      setProjects(projectRows);
      setBaselineId((current) => sortedBaselines.some((item) => item.id === current) ? current : sortedBaselines[0]?.id ?? "");
      setProjectId((current) => projectRows.some((item) => item.id === current)
        ? current
        : projectRows.find((item) => item.name.includes("智能导购"))?.id ?? projectRows[0]?.id ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI 应用验收状态读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);

  useEffect(() => {
    if (!baselineId) return;
    void fetch(`/api/test-models/approved-versions?baselineId=${encodeURIComponent(baselineId)}`, { cache: "no-store" })
      .then((response) => readJson<ApprovedTestModelVersion[]>(response))
      .then((rows) => {
        setApprovedTestModelVersionId((current) => rows.some((item) => item.record.id === current) ? current : rows[0]?.record.id);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "验收方案状态读取失败"));
  }, [baselineId, step]);

  useEffect(() => {
    if (!projectId) return;
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/ai-contract-readiness`, { cache: "no-store" })
      .then((response) => readJson<ContractReadiness>(response))
      .then(setContract)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "被测应用连接状态读取失败"));
  }, [projectId, step]);

  const baseline = baselines.find((item) => item.id === baselineId);
  const isSimulation = baseline?.prdFilename === "approved-prd-smart-shopping-v1.0.md";
  const baselineDesigns = designs.filter((item) => item.baselineId === baselineId);
  const approvedDesign = baselineDesigns.find((item) => item.status === "approved" && item.approvedVersion);
  const approvedVersionId = approvedDesign?.approvedVersion?.id ?? "";
  const relatedSampleSets = sampleSets.filter((item) => item.approvedTestCaseVersionId === approvedVersionId);
  const frozenSampleSet = relatedSampleSets.find((item) => item.status === "frozen");
  const evaluationExport = exports.find((item) => item.approvedTestCaseVersionId === approvedVersionId && item.dataClass === "evaluation-dataset");
  const relatedExperiments = evaluationExport ? experiments.filter((item) => item.datasetExportId === evaluationExport.id) : [];
  const latestExperiment = relatedExperiments[0];

  const completion = useMemo(() => ({
    model: Boolean(approvedTestModelVersionId),
    conditions: Boolean(approvedTestConditionVersionId),
    cases: Boolean(approvedDesign),
    dataset: Boolean(frozenSampleSet && evaluationExport),
    run: Boolean(latestExperiment),
    result: Boolean(latestExperiment),
  }), [approvedDesign, approvedTestConditionVersionId, approvedTestModelVersionId, evaluationExport, frozenSampleSet, latestExperiment]);

  function navigate(page: string) {
    window.dispatchEvent(new CustomEvent("testmesh:navigate", { detail: page }));
  }

  function next() {
    const index = stepOrder.indexOf(step);
    if (index < stepOrder.length - 1) setStep(stepOrder[index + 1]);
  }

  if (loading) return <div className="centered-state"><Spin tip="正在准备 AI 应用验收" /></div>;

  return <div className="ai-acceptance-page">
    <Flex justify="space-between" align="flex-start" gap={16} wrap className="ai-acceptance-heading">
      <div>
        <Title level={3}>AI 应用验收</Title>
        <Paragraph type="secondary">从冻结需求出发，按固定 Schema 依次形成测试模型、测试条件、测试用例和 Dataset，再连接被测应用执行验收。</Paragraph>
      </div>
      <Space wrap>
        <Text strong>当前需求</Text>
        <Select
          value={baselineId || undefined}
          onChange={(value) => { setBaselineId(value); setStep("model"); setApprovedTestModelVersionId(undefined); setApprovedTestConditionVersionId(undefined); }}
          placeholder="选择冻结需求"
          style={{ minWidth: 360, maxWidth: "100%" }}
          options={baselines.map((item) => ({ value: item.id, label: `${item.prdRevision} · ${item.prdFilename}` }))}
        />
      </Space>
    </Flex>

    {error && <Alert type="error" showIcon closable onClose={() => setError("")} message="当前步骤暂不可用" description={error} style={{ marginBottom: 16 }} />}
    {!baseline && <Alert type="warning" showIcon message="还没有冻结需求" description="请先在 AI 需求分析中完成人工评审并冻结一份需求基线。" />}
    {baseline && isSimulation && <Alert
      type="warning"
      showIcon
      message="当前是模拟工程演练"
      description="智能导购基线、模型、样本和运行结果仅用于验证 TestMesh 流程与接口设计，统一视为 simulated；不能作为真实业务验收或生产发布证据。接入真实项目时替换基线、契约、Fixture、Dataset 和门禁配置。"
      style={{ marginBottom: 16 }}
    />}

    {baseline && <>
      <Card className="ai-acceptance-progress" size="small">
        <Steps
          current={stepOrder.indexOf(step)}
          onChange={(index) => setStep(stepOrder[index])}
          responsive
          items={[
            { title: "测试模型", description: completion.model ? "已批准" : "建立业务与质量模型", status: completion.model ? "finish" : step === "model" ? "process" : "wait" },
            { title: "测试条件", description: completion.conditions ? "已批准" : "拆分可判定条件", status: completion.conditions ? "finish" : step === "conditions" ? "process" : "wait" },
            { title: "测试用例", description: completion.cases ? "已批准" : "逐条件生成用例", status: completion.cases ? "finish" : step === "cases" ? "process" : "wait" },
            { title: "Dataset", description: completion.dataset ? "已冻结" : "确认输入与期望", status: completion.dataset ? "finish" : step === "dataset" ? "process" : "wait" },
            { title: "执行验收", description: completion.run ? "已执行" : "运行全部样本", status: completion.run ? "finish" : step === "run" ? "process" : "wait" },
            { title: "验收结论", description: completion.result ? "可查看" : "等待执行", status: completion.result ? "finish" : step === "result" ? "process" : "wait" },
          ]}
        />
      </Card>

      {step === "model" && <section>
        <Alert type="info" showIcon message="先把需求基线转换为测试模型" description="这里分别建立 M-01～M-04 四个行为模型，并补充风险、AI 评测对象和覆盖目标。模型生成使用独立版本化 Prompt；批准动作本身不调用模型。" style={{ marginBottom: 16 }} />
        <TestModeling baselineId={baselineId} projectId={projectId} value={approvedTestModelVersionId} onChange={setApprovedTestModelVersionId} simplified simulationReference={isSimulation} />
        <Flex justify="flex-end"><Button type="primary" disabled={!approvedTestModelVersionId} onClick={next}>下一步：建立测试条件</Button></Flex>
      </section>}

      {step === "conditions" && <section>
        <TestConditions baselineId={baselineId} approvedTestModelVersionId={approvedTestModelVersionId} value={approvedTestConditionVersionId} onChange={setApprovedTestConditionVersionId} />
        <Flex justify="flex-end" style={{ marginTop: 16 }}><Button type="primary" disabled={!approvedTestConditionVersionId} onClick={next}>下一步：生成测试用例</Button></Flex>
      </section>}

      {step === "cases" && <section>
        {!approvedTestConditionVersionId ? <Alert type="warning" showIcon message="先批准测试条件" action={<Button onClick={() => setStep("conditions")}>返回测试条件</Button>} /> : <>
          <TestDesign fixedBaselineId={baselineId} fixedApprovedTestModelVersionId={approvedTestModelVersionId} fixedApprovedTestConditionVersionId={approvedTestConditionVersionId} simplified showModeling={false} onChanged={() => void refresh()} />
          <Flex justify="flex-end"><Button type="primary" disabled={!approvedDesign} onClick={next}>下一步：建立 Dataset</Button></Flex>
        </>}
      </section>}

      {step === "dataset" && <section>
        {!approvedDesign ? <Alert type="warning" showIcon message="先批准测试用例" description="测试用例冻结后，才能建立与其一一追溯的真实输入和预期结果。" action={<Button onClick={() => setStep("cases")}>返回测试用例</Button>} /> : <>
          <Alert type="info" showIcon message="一条样本就是一次真实验收" description="只需要确认输入对话、初始上下文、预期参数、预期工具调用和预期结果。内部 Dataset 版本与追溯信息由系统维护。" style={{ marginBottom: 16 }} />
          <AiEvaluationSamples />
          <Flex justify="flex-end" style={{ marginTop: 16 }}><Button type="primary" disabled={!completion.dataset} onClick={next}>下一步：执行验收</Button></Flex>
        </>}
      </section>}

      {step === "run" && <section>
        {!evaluationExport ? <Alert type="warning" showIcon message="Dataset 尚未冻结" description="请先完成样本审核和冻结，系统才会创建可执行的评测数据版本。" action={<Button onClick={() => setStep("dataset")}>返回 Dataset</Button>} /> : !contract?.ready ? <Card title={<Space><ApiOutlined />执行门禁：连接被测应用</Space>}><Space direction="vertical" size={12} style={{ width: "100%" }}><Alert type="warning" showIcon message="真实调用与 Trace 契约未就绪" description={contract?.blockers.join("；") || "请先配置被测应用连接信息。"} /><Select value={projectId || undefined} onChange={setProjectId} style={{ minWidth: 320 }} placeholder="选择被测项目" options={projects.map((item) => ({ value: item.id, label: item.name }))} /><Button icon={<LinkOutlined />} onClick={() => navigate("project-config")}>补充连接信息</Button></Space></Card> : <>
          <Alert type="info" showIcon icon={<PlayCircleOutlined />} message="执行全部验收样本" description="系统会逐条调用被测应用，检查参数、上下文、工具调用、业务结果和最终回复，并保存失败证据。" style={{ marginBottom: 16 }} />
          <AiExperimentReadiness />
          <Collapse style={{ marginTop: 16 }} items={[{ key: "advanced", label: "高级评测设置", children: <EvaluatorCalibration /> }]} />
          <Flex justify="flex-end" style={{ marginTop: 16 }}><Button type="primary" disabled={!latestExperiment} onClick={next}>查看验收结论</Button></Flex>
        </>}
      </section>}

      {step === "result" && <section>
        <Card title={<Space><SafetyCertificateOutlined />验收结论</Space>}>
          {!latestExperiment ? <Alert type="warning" showIcon message="尚未形成验收结论" description="完成一次正式执行后，这里会展示通过情况、失败规则和逐条证据。" action={<Button onClick={() => setStep("run")}>前往执行验收</Button>} /> : <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Alert
              type={latestExperiment.failedRuns === 0 ? "success" : "error"}
              showIcon
              icon={<CheckCircleOutlined />}
              message={latestExperiment.failedRuns === 0 ? "本次执行没有失败样本" : `本次执行有 ${latestExperiment.failedRuns} 条失败样本`}
              description={`通过 ${latestExperiment.successfulRuns}/${latestExperiment.totalRuns}；该结果还需结合必需评分项和发布准入规则形成最终结论。`}
            />
            <Descriptions bordered size="small" column={{ xs: 1, md: 3 }}>
              <Descriptions.Item label="执行样本">{latestExperiment.totalRuns}</Descriptions.Item>
              <Descriptions.Item label="通过">{latestExperiment.successfulRuns}</Descriptions.Item>
              <Descriptions.Item label="失败">{latestExperiment.failedRuns}</Descriptions.Item>
            </Descriptions>
            <Flex justify="space-between" gap={8} wrap>
              <Button icon={<ExperimentOutlined />} href="http://127.0.0.1:6006/experiments" target="_blank">查看逐样本证据</Button>
              <Button type="primary" icon={<FileDoneOutlined />} onClick={() => navigate("overview")}>查看质量报告与准入结论</Button>
            </Flex>
          </Space>}
        </Card>
      </section>}
    </>}
  </div>;
}
