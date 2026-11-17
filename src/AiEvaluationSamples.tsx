import { CheckOutlined, DatabaseOutlined, EditOutlined, PlusOutlined, StopOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, List, Modal, Progress, Select, Space, Tag, Typography, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { ApprovedTestCaseVersionOption } from "./types";

const { Text } = Typography;

interface Sample {
  id: string;
  approvedTestCaseId: string;
  aiDimension: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
  metadata: Record<string, unknown>;
  status: "draft" | "approved" | "rejected";
  reviewNote: string;
  reviewedBy: string;
}

interface SampleSet {
  id: string;
  approvedTestCaseVersionId: string;
  name: string;
  status: "draft" | "frozen";
  version: number;
  contentSha256: string;
  samples: Sample[];
}

interface Readiness {
  ready: boolean;
  totalAiTestCases: number;
  coveredAiTestCases: number;
  approvedSamples: number;
  draftSamples: number;
  rejectedSamples: number;
  missingTestCaseIds: string[];
  blockers: string[];
}

interface DatasetSpecification {
  approvedTestCaseVersionId: string;
  cases: Array<{
    testCaseId: string; testConditionId: string; title: string; priority: string; dimension: string;
    evaluationSubjects: string[]; evaluationLayers: string[]; oracleType: string; evaluator: string;
    threshold: string; expectedBehavior: string; datasetRequirements: string[];
    evidenceRequirements: string[]; sourceRefs: string[]; riskRefs: string[];
  }>;
}

async function read<T>(responseOrPromise: Response | Promise<Response>): Promise<T> {
  const response = await responseOrPromise;
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `请求失败（HTTP ${response.status}）`);
  return body;
}

function parseObject(text: string, label: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error(`${label} 必须是合法 JSON`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是 JSON 对象`);
  return value as Record<string, unknown>;
}

export default function AiEvaluationSamples() {
  const [versions, setVersions] = useState<ApprovedTestCaseVersionOption[]>([]);
  const [sets, setSets] = useState<SampleSet[]>([]);
  const [versionId, setVersionId] = useState("");
  const [setId, setSetId] = useState("");
  const [operator, setOperator] = useState("");
  const [readiness, setReadiness] = useState<Readiness>();
  const [specification, setSpecification] = useState<DatasetSpecification>();
  const [editing, setEditing] = useState<Sample | null | undefined>(undefined);
  const [creatingSet, setCreatingSet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sampleForm] = Form.useForm();
  const [setForm] = Form.useForm();
  const currentSet = sets.find((item) => item.id === setId);
  const currentVersion = versions.find((item) => item.id === currentSet?.approvedTestCaseVersionId || item.id === versionId);
  const aiCases = useMemo(() => currentVersion?.testCases.filter((item) => item.ai_evaluation) ?? [], [currentVersion]);

  useEffect(() => {
    const id = currentVersion?.id;
    if (!id) return;
    let active = true;
    void read<DatasetSpecification>(fetch(`/api/ai-quality/dataset-specifications/${encodeURIComponent(id)}`, { cache: "no-store" }))
      .then((value) => { if (active) setSpecification(value); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Dataset 设计加载失败"); });
    return () => { active = false; };
  }, [currentVersion?.id]);

  async function refresh(preferredSetId = setId) {
    const rows = await read<SampleSet[]>(await fetch("/api/ai-quality/evaluation-sample-sets", { cache: "no-store" }));
    setSets(rows);
    const selected = rows.find((item) => item.id === preferredSetId) ?? rows[0];
    setSetId(selected?.id ?? "");
    if (selected) {
      setReadiness(await read<Readiness>(await fetch(`/api/ai-quality/evaluation-sample-sets/${selected.id}/readiness`, { cache: "no-store" })));
    } else setReadiness(undefined);
  }

  useEffect(() => {
    void Promise.all([
      read<ApprovedTestCaseVersionOption[]>(fetch("/api/api-automation/approved-versions", { cache: "no-store" })),
      read<SampleSet[]>(fetch("/api/ai-quality/evaluation-sample-sets", { cache: "no-store" })),
    ]).then(([approvedVersions, sampleSets]) => {
      setVersions(approvedVersions);
      setVersionId(approvedVersions.find((item) => item.testCases.some((testCase) => testCase.ai_evaluation))?.id ?? "");
      setSets(sampleSets); setSetId(sampleSets[0]?.id ?? "");
      if (sampleSets[0]) return read<Readiness>(fetch(`/api/ai-quality/evaluation-sample-sets/${sampleSets[0].id}/readiness`)).then(setReadiness);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "评测样本加载失败"));
  }, []);

  async function chooseSet(id: string) {
    setSetId(id); setReadiness(undefined); setError("");
    try { setReadiness(await read<Readiness>(await fetch(`/api/ai-quality/evaluation-sample-sets/${id}/readiness`, { cache: "no-store" }))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "准备度检查失败"); }
  }

  async function createSet(values: { name: string }) {
    if (!versionId || !operator.trim()) { message.warning("请选择 Approved 版本并填写操作人"); return; }
    setBusy(true);
    try {
      const saved = await read<SampleSet>(await fetch("/api/ai-quality/evaluation-sample-sets", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvedTestCaseVersionId: versionId, name: values.name, createdBy: operator.trim() }),
      }));
      setCreatingSet(false); setForm.resetFields(); await refresh(saved.id); message.success("评测样本集已创建");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "样本集创建失败"); }
    finally { setBusy(false); }
  }

  function openSample(sample?: Sample) {
    setEditing(sample ?? null);
    sampleForm.setFieldsValue({
      approvedTestCaseId: sample?.approvedTestCaseId,
      input: JSON.stringify(sample?.input ?? { message: "" }, null, 2),
      expected: JSON.stringify(sample?.expected ?? { expected_behavior: "" }, null, 2),
      expectedTools: ((sample?.metadata.expectedTools as string[] | undefined) ?? []).join(","),
      forbiddenTools: ((sample?.metadata.forbiddenTools as string[] | undefined) ?? []).join(","),
      sourceRefs: ((sample?.metadata.sourceRefs as string[] | undefined) ?? []).join(","),
      variantGroupId: sample?.metadata.variantGroupId,
      baselineSampleId: sample?.metadata.baselineSampleId,
      perturbationFamily: sample?.metadata.perturbationFamily,
      expectedRelation: sample?.metadata.expectedRelation,
      evaluationSlice: sample?.metadata.evaluationSlice,
      sourceKind: sample?.metadata.sourceKind ?? "human_curated",
      evaluationSubject: sample?.metadata.evaluationSubject ?? "target_application",
      evaluationLayer: sample?.metadata.evaluationLayer,
    });
  }

  async function saveSample(values: { approvedTestCaseId: string; input: string; expected: string; expectedTools?: string; forbiddenTools?: string; sourceRefs?: string; variantGroupId?: string; baselineSampleId?: string; perturbationFamily?: string; expectedRelation?: string; evaluationSlice?: string; sourceKind?: string; evaluationSubject: string; evaluationLayer: string }) {
    if (!currentSet || !operator.trim()) { message.warning("请先选择样本集并填写操作人"); return; }
    setBusy(true);
    try {
      const split = (value?: string) => value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
      const url = editing?.id
        ? `/api/ai-quality/evaluation-sample-sets/${currentSet.id}/samples/${editing.id}`
        : `/api/ai-quality/evaluation-sample-sets/${currentSet.id}/samples`;
      await read(await fetch(url, {
        method: editing?.id ? "PUT" : "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvedTestCaseId: values.approvedTestCaseId,
          input: parseObject(values.input, "Input"), expected: parseObject(values.expected, "Expected"),
          metadata: {
            fixtureRefs: [], sourceRefs: split(values.sourceRefs), expectedTools: split(values.expectedTools), forbiddenTools: split(values.forbiddenTools), tags: [],
            variantGroupId: values.variantGroupId || undefined, baselineSampleId: values.baselineSampleId || undefined,
            perturbationFamily: values.perturbationFamily || undefined, expectedRelation: values.expectedRelation || undefined,
            evaluationSlice: values.evaluationSlice || undefined, heldOut: false, sourceKind: values.sourceKind || "human_curated",
            evaluationSubject: values.evaluationSubject, evaluationLayer: values.evaluationLayer,
          },
          operator: operator.trim() }),
      }));
      setEditing(undefined); sampleForm.resetFields(); await refresh(currentSet.id); message.success("样本已保存，需重新人工评审");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "样本保存失败"); }
    finally { setBusy(false); }
  }

  async function review(sample: Sample, status: "approved" | "rejected") {
    if (!currentSet || !operator.trim()) { message.warning("请填写评审人"); return; }
    let reviewNote = "";
    if (status === "rejected") reviewNote = window.prompt("请输入拒绝原因（必填）")?.trim() ?? "";
    if (status === "rejected" && !reviewNote) return;
    try {
      await read(await fetch(`/api/ai-quality/evaluation-sample-sets/${currentSet.id}/samples/${sample.id}/review`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, reviewedBy: operator.trim(), reviewNote }),
      }));
      await refresh(currentSet.id); message.success(status === "approved" ? "样本已接受" : "样本已拒绝");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "样本评审失败"); }
  }

  async function freezeOrExport(action: "freeze" | "export") {
    if (!currentSet || !operator.trim()) { message.warning("请填写操作人"); return; }
    setBusy(true);
    try {
      await read(await fetch(`/api/ai-quality/evaluation-sample-sets/${currentSet.id}/${action}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "freeze" ? { frozenBy: operator.trim() } : { exportedBy: operator.trim() }),
      }));
      await refresh(currentSet.id);
      message.success(action === "freeze" ? "评测样本集已冻结" : "可执行评测数据集已同步 Phoenix");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败"); }
    finally { setBusy(false); }
  }

  const coverage = readiness?.totalAiTestCases ? Math.round(readiness.coveredAiTestCases / readiness.totalAiTestCases * 100) : 0;
  return <Card title={<Space><DatabaseOutlined />真实 AI 评测样本集</Space>}>
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      <Alert showIcon type="info" message="这里管理可实际发送给目标 AI 的输入和可判定期望" description="Agent 可以提出候选样本，但人工可修正并逐条接受或拒绝。只有覆盖全部 Approved AI TestCase 且无未评审项，才能冻结并同步 Phoenix；当前没有真实资料时保持为空，不生成伪证据。" />
      {error && <Alert showIcon type="error" message="评测样本操作未完成" description={error} closable onClose={() => setError("")} />}
      <Card size="small" title="Dataset 设计 · 来自已批准 AI 用例">
        <Text type="secondary">每个用例的测试条件、Oracle、样本要求和证据要求在此确定；一条用例可关联多条不同输入样本。这里只展示设计，不把描述当作可执行数据。</Text>
        <List size="small" dataSource={specification && specification.approvedTestCaseVersionId === currentVersion?.id ? specification.cases : []} locale={{ emptyText: "暂无 Approved AI TestCase，先完成测试建模和用例批准" }} renderItem={(item) => {
          const count = currentSet?.samples.filter((sample) => sample.approvedTestCaseId === item.testCaseId && sample.status === "approved").length ?? 0;
          return <List.Item><List.Item.Meta title={<Space wrap><Text code>{item.testCaseId}</Text><Text>{item.title}</Text><Tag>{item.dimension}</Tag><Tag color={count ? "green" : "gold"}>已接受样本 {count}</Tag></Space>} description={<Space direction="vertical" size={2}>
            <Text type="secondary">测试条件 {item.testConditionId || "未关联"} · {item.priority} · {item.evaluationSubjects.join("、") || "未指定对象"} · {item.evaluationLayers.join("、") || "未指定证据层"}</Text>
            <Text>Oracle：{item.oracleType} · Evaluator：{item.evaluator} · 阈值：{item.threshold}</Text>
            <Text>样本要求：{item.datasetRequirements.join("；")}</Text>
            <Text type="secondary">执行证据：{item.evidenceRequirements.join("；")}</Text>
          </Space>} /></List.Item>;
        }} />
      </Card>
      <Space wrap>
        <Input value={operator} onChange={(event) => setOperator(event.target.value)} placeholder="操作人 / 评审人 *" style={{ width: 190 }} />
        <Select value={setId || undefined} onChange={(id) => void chooseSet(id)} placeholder="选择评测样本集" style={{ minWidth: 300 }} options={sets.map((item) => ({ value: item.id, label: `${item.name} · v${item.version} · ${item.status === "frozen" ? "已冻结" : "草稿"}` }))} />
        <Button icon={<PlusOutlined />} onClick={() => setCreatingSet(true)}>新建样本集</Button>
        <Button type="primary" disabled={!currentSet || currentSet.status === "frozen"} onClick={() => openSample()}>添加真实样本</Button>
        <Button loading={busy} disabled={!readiness?.ready || currentSet?.status !== "draft"} onClick={() => void freezeOrExport("freeze")}>冻结版本</Button>
        <Button loading={busy} disabled={currentSet?.status !== "frozen"} onClick={() => void freezeOrExport("export")}>同步 Phoenix</Button>
      </Space>
      {currentSet && readiness && <>
        <Progress percent={coverage} status={readiness.ready ? "success" : "active"} format={() => `AI 用例样本覆盖 ${readiness.coveredAiTestCases}/${readiness.totalAiTestCases}`} />
        <Space wrap><Tag color="green">已接受 {readiness.approvedSamples}</Tag><Tag color="gold">待评审 {readiness.draftSamples}</Tag><Tag color="red">已拒绝 {readiness.rejectedSamples}</Tag>{currentSet.status === "frozen" && <Tag color="blue">不可变版本</Tag>}</Space>
        {readiness.blockers.length > 0 && <Alert type="warning" showIcon message="尚不能冻结" description={readiness.blockers.join("；")} />}
      </>}
      <List size="small" dataSource={currentSet?.samples ?? []} locale={{ emptyText: "尚无真实评测样本；不要用测试计划描述冒充输入语料" }} renderItem={(item) => <List.Item actions={currentSet?.status === "draft" ? [
        <Button key="edit" type="link" icon={<EditOutlined />} onClick={() => openSample(item)}>修正</Button>,
        <Button key="approve" type="link" icon={<CheckOutlined />} onClick={() => void review(item, "approved")}>接受</Button>,
        <Button key="reject" danger type="link" icon={<StopOutlined />} onClick={() => void review(item, "rejected")}>拒绝</Button>,
      ] : undefined}><List.Item.Meta title={<Space><Text code>{item.approvedTestCaseId}</Text><Tag>{item.aiDimension}</Tag><Tag color={item.status === "approved" ? "green" : item.status === "rejected" ? "red" : "gold"}>{item.status}</Tag></Space>} description={<Text ellipsis>{JSON.stringify(item.input)}</Text>} /></List.Item>} />
    </Space>

    <Modal open={creatingSet} title="新建真实评测样本集" onCancel={() => setCreatingSet(false)} onOk={() => setForm.submit()} confirmLoading={busy} destroyOnHidden>
      <Form form={setForm} layout="vertical" onFinish={(values) => void createSet(values)}>
        <Form.Item label="Approved TestCase 版本" required><Select value={versionId || undefined} onChange={setVersionId} options={versions.filter((item) => item.testCases.some((testCase) => testCase.ai_evaluation)).map((item) => ({ value: item.id, label: `Approved v${item.version} · ${item.testCases.filter((testCase) => testCase.ai_evaluation).length} 条 AI 用例` }))} /></Form.Item>
        <Form.Item name="name" label="样本集名称" rules={[{ required: true, message: "请填写样本集名称" }]}><Input placeholder="例如：售后 Agent 核心回归集" /></Form.Item>
      </Form>
    </Modal>

    <Modal open={editing !== undefined} title={editing ? "人工修正评测样本" : "添加真实评测样本"} width={760} onCancel={() => setEditing(undefined)} onOk={() => sampleForm.submit()} confirmLoading={busy} destroyOnHidden>
      <Form form={sampleForm} layout="vertical" onFinish={(values) => void saveSample(values)}>
        <Form.Item name="approvedTestCaseId" label="关联 Approved AI TestCase" rules={[{ required: true, message: "请选择关联用例" }]}><Select showSearch options={aiCases.map((item) => ({ value: item.id, label: `${item.id} · ${item.title} · ${item.ai_evaluation?.dimension}` }))} /></Form.Item>
        <Form.Item name="input" label="实际输入 JSON" extra='单轮示例：{"message":"我要退款"}；多轮使用 conversation 数组。' rules={[{ required: true, message: "请填写实际输入" }]}><Input.TextArea rows={6} /></Form.Item>
        <Form.Item name="expected" label="期望 / 标签 JSON" extra="必须是 Evaluator 或确定性断言能够判定的期望。" rules={[{ required: true, message: "请填写期望" }]}><Input.TextArea rows={6} /></Form.Item>
        <Space wrap align="start">
          <Form.Item name="evaluationSubject" label="评测对象" rules={[{ required: true, message: "请选择评测对象" }]}><Select style={{ width: 220 }} options={[{ value: "testmesh", label: "TestMesh 自身 Agent" }, { value: "target_application", label: "被测 AI 应用" }]} /></Form.Item>
          <Form.Item name="evaluationLayer" label="证据层" rules={[{ required: true, message: "请选择证据层" }]}><Select style={{ width: 220 }} options={[{ value: "agent_decision", label: "Agent 决策层" }, { value: "tool_execution", label: "工具执行层" }, { value: "business_outcome", label: "业务结果层" }, { value: "final_response", label: "最终回复层" }]} /></Form.Item>
        </Space>
        <Form.Item name="expectedTools" label="预期工具（逗号分隔）"><Input /></Form.Item>
        <Form.Item name="forbiddenTools" label="禁止工具（逗号分隔）"><Input /></Form.Item>
        <Form.Item name="sourceRefs" label="来源证据 ID（逗号分隔）"><Input /></Form.Item>
        <Card size="small" title="泛化与鲁棒性变体协议（robustness_consistency 用例必填）">
          <Space direction="vertical" style={{ width: "100%" }}>
            <Space wrap>
              <Form.Item name="variantGroupId" label="变体组 ID"><Input placeholder="例如 refund-intent-v1" /></Form.Item>
              <Form.Item name="baselineSampleId" label="基准样本 ID"><Input placeholder="对应未扰动样本" /></Form.Item>
              <Form.Item name="evaluationSlice" label="评测切片"><Input placeholder="例如 paraphrase / noisy-input" /></Form.Item>
            </Space>
            <Space wrap align="start">
              <Form.Item name="perturbationFamily" label="扰动族"><Select allowClear style={{ width: 220 }} options={["paraphrase", "typo_noise", "format_structure", "irrelevant_context", "length_boundary", "tone_persona", "entity_value_shift", "language_locale", "order_reordering", "negation_conflict", "multi_turn_drift", "out_of_distribution", "prompt_injection", "tool_dependency_failure", "repeatability"].map((value) => ({ value, label: value }))} /></Form.Item>
              <Form.Item name="expectedRelation" label="期望关系"><Select allowClear style={{ width: 190 }} options={[{ value: "invariant", label: "关键结论保持" }, { value: "controlled_change", label: "按变更受控变化" }, { value: "fail_safe", label: "超出能力时安全失败" }]} /></Form.Item>
              <Form.Item name="sourceKind" label="样本来源"><Select style={{ width: 190 }} options={[{ value: "human_curated", label: "人工构造" }, { value: "production_replay", label: "生产回流" }, { value: "synthetic_reviewed", label: "合成后人工确认" }]} /></Form.Item>
            </Space>
          </Space>
        </Card>
      </Form>
    </Modal>
  </Card>;
}
