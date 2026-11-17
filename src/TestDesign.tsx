import { CheckCircleOutlined, DatabaseOutlined, ExperimentOutlined, LinkOutlined, SafetyCertificateOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, App as AntdApp, Button, Card, Col, Collapse, Descriptions, Empty, Flex, Input, Modal, Popconfirm, Row, Segmented, Select, Space, Spin, Statistic, Tag, Typography, Upload } from "antd";
import type { UploadFile } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DesignedTestCase, KnowledgeDocumentRecord, RequirementBaselineRecord, TestCaseReviewRecord, TestDesignRecord, TestTechnique } from "./types";
import TestModeling from "./TestModeling";

const { Title, Text, Paragraph } = Typography;

const techniqueLabels: Record<TestTechnique, string> = {
  scenario: "场景分析",
  equivalence_partition: "等价类",
  boundary_value: "边界值",
  decision_table: "判定表",
  state_transition: "状态迁移",
  combinatorial: "组合覆盖",
  property_based: "Property-based",
  ai_evaluation: "AI 行为评测",
};

const toolLabels = {
  cucumber_gherkin: "Cucumber / Gherkin",
  fast_check: "fast-check",
  nist_acts: "NIST ACTS",
  graphwalker: "GraphWalker",
  phoenix_evals: "Phoenix Dataset / Experiment / Evaluator",
};

const scenarioTypeLabels = {
  normal: "正常流程",
  exception: "异常分支",
  boundary: "边界条件",
  rule_combination: "规则组合",
  state_transition: "状态迁移",
  cross_business: "跨业务交互",
  ai_behavior: "Testing for AI",
};

const aiDimensionLabels = {
  intent_recognition: "意图识别",
  multi_turn_context: "多轮上下文",
  constraint_adherence: "约束保持",
  response_correctness: "回复准确性",
  groundedness_hallucination: "Groundedness / 幻觉",
  safety_refusal: "安全拒答",
  parameter_extraction: "参数提取 / Slot Filling",
  tool_selection: "工具选择",
  tool_invocation: "工具调用",
  robustness_consistency: "鲁棒性与一致性",
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `请求失败（HTTP ${response.status}）`);
  return payload;
}

export default function TestDesign({ fixedBaselineId, fixedApprovedTestModelVersionId, fixedApprovedTestConditionVersionId, simplified = false, showModeling = true, onChanged }: {
  fixedBaselineId?: string;
  fixedApprovedTestModelVersionId?: string;
  fixedApprovedTestConditionVersionId?: string;
  simplified?: boolean;
  showModeling?: boolean;
  onChanged?: () => void;
} = {}) {
  const { message } = AntdApp.useApp();
  const [baselines, setBaselines] = useState<RequirementBaselineRecord[]>([]);
  const [designs, setDesigns] = useState<TestDesignRecord[]>([]);
  const [baselineId, setBaselineId] = useState<string>();
  const [selectedTestModelVersionId, setSelectedTestModelVersionId] = useState<string>();
  const approvedTestModelVersionId = fixedApprovedTestModelVersionId ?? selectedTestModelVersionId;
  const approvedTestConditionVersionId = fixedApprovedTestConditionVersionId;
  const [selectedId, setSelectedId] = useState<string>();
  const [current, setCurrent] = useState<TestDesignRecord>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [view, setView] = useState<"cases" | "conditions" | "points" | "risks" | "tools">("cases");
  const [reviewing, setReviewing] = useState<DesignedTestCase>();
  const [editedCase, setEditedCase] = useState<DesignedTestCase>();
  const [editedSteps, setEditedSteps] = useState("");
  const [reviewStatus, setReviewStatus] = useState<"accepted" | "rejected">("accepted");
  const [reviewer, setReviewer] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approvedBy, setApprovedBy] = useState("");
  const [knowledge, setKnowledge] = useState<KnowledgeDocumentRecord[]>([]);
  const [knowledgeFile, setKnowledgeFile] = useState<UploadFile[]>([]);
  const [indexingKnowledge, setIndexingKnowledge] = useState(false);

  const refresh = useCallback(async () => {
    const [baselineRows, designRows, knowledgeRows] = await Promise.all([
      readJson<RequirementBaselineRecord[]>(await fetch("/api/requirement-baselines", { cache: "no-store" })),
      readJson<TestDesignRecord[]>(await fetch("/api/test-designs", { cache: "no-store" })),
      readJson<KnowledgeDocumentRecord[]>(await fetch("/api/knowledge-documents", { cache: "no-store" })),
    ]);
    setBaselines(baselineRows);
    setDesigns(designRows);
    setKnowledge(knowledgeRows);
    setBaselineId((value) => fixedBaselineId ?? value ?? baselineRows[0]?.id);
    return designRows;
  }, [fixedBaselineId]);

  const openDesign = useCallback(async (id: string) => {
    setSelectedId(id);
    setError(undefined);
    try {
      const detail = await readJson<TestDesignRecord>(await fetch(`/api/test-designs/${encodeURIComponent(id)}`, { cache: "no-store" }));
      setCurrent(detail);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取测试设计");
    }
  }, []);

  useEffect(() => {
    void Promise.all([
      fetch("/api/requirement-baselines", { cache: "no-store" }).then((response) => readJson<RequirementBaselineRecord[]>(response)),
      fetch("/api/test-designs", { cache: "no-store" }).then((response) => readJson<TestDesignRecord[]>(response)),
      fetch("/api/knowledge-documents", { cache: "no-store" }).then((response) => readJson<KnowledgeDocumentRecord[]>(response)),
    ]).then(([baselineRows, designRows, knowledgeRows]) => {
      setBaselines(baselineRows);
      setDesigns(designRows);
      setKnowledge(knowledgeRows);
      setBaselineId(fixedBaselineId ?? baselineRows[0]?.id);
      if (designRows[0]) void openDesign(designRows[0].id);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "无法读取测试设计"));
  }, [fixedBaselineId, openDesign]);

  async function uploadKnowledge() {
    const nativeFile = knowledgeFile[0]?.originFileObj;
    if (!nativeFile) {
      message.error("请先选择项目知识文件");
      return;
    }
    setIndexingKnowledge(true);
    setError(undefined);
    try {
      const body = new FormData();
      body.append("file", nativeFile, nativeFile.name);
      const result = await readJson<{ record: KnowledgeDocumentRecord; reused: boolean }>(await fetch("/api/knowledge-documents", { method: "POST", body }));
      setKnowledgeFile([]);
      await refresh();
      message.success(result.reused ? "该文件已存在，已复用现有知识索引" : `项目知识已完成解析并建立 ${result.record.chunkCount} 个可追溯片段`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "项目知识入库失败");
    } finally {
      setIndexingKnowledge(false);
    }
  }

  async function removeKnowledge(id: string) {
    try {
      const response = await fetch(`/api/knowledge-documents/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) await readJson(response);
      await refresh();
      message.success("项目知识及其向量索引已删除");
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "项目知识删除失败");
    }
  }

  const reviews = useMemo(() => new Map((current?.reviews ?? []).map((item) => [item.testCaseId, item])), [current]);
  const amendments = useMemo(() => new Map([...(current?.amendments ?? [])].reverse().map((item) => [item.testCaseId, item])), [current]);
  const reviewSummary = current ? {
    total: current.document.test_cases.length,
    pending: current.document.test_cases.filter((item) => !reviews.has(item.id)).length,
    accepted: current.document.test_cases.filter((item) => reviews.get(item.id)?.status === "accepted").length,
    rejected: current.document.test_cases.filter((item) => reviews.get(item.id)?.status === "rejected").length,
  } : undefined;
  const baselineSources = useMemo(() => new Map((current?.baselineSources ?? []).map((item) => [item.id, item])), [current]);
  const knowledgeEvidence = useMemo(() => new Map((current?.document.knowledge_evidence ?? []).map((item) => [item.chunk_id, item])), [current]);

  async function generate(regenerate = false) {
    if (!baselineId || !approvedTestModelVersionId || !approvedTestConditionVersionId) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await readJson<{ record: TestDesignRecord; reused: boolean }>(await fetch("/api/test-designs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baselineId, approvedTestModelVersionId, approvedTestConditionVersionId, regenerate }),
      }));
      await refresh();
      await openDesign(result.record.id);
      onChanged?.();
      message.success(result.reused ? "已打开该基线最新的测试设计" : regenerate && result.record.version > 1 ? `测试设计候选 v${result.record.version} 已生成，原批准版本保持不变` : regenerate ? "测试设计草稿已重新生成并通过原子用例门禁" : "测试设计已生成并通过 Gherkin 与追溯校验");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "测试设计生成失败");
    } finally {
      setLoading(false);
    }
  }

  function requestGeneration() {
    const existing = designs.find((item) => item.baselineId === baselineId);
    if (!existing) {
      void generate(false);
      return;
    }
    if (existing.status === "approved") {
      Modal.confirm({
        title: `生成测试设计候选 v${existing.version + 1}？`,
        content: "现有 Approved TestCase 不会被覆盖。新版本将重新读取同一获批基线，按当前 Testing for AI 协议生成独立候选，并重新经过人工修正、评审和批准。该过程会调用模型。",
        okText: "生成新候选",
        cancelText: "取消",
        onOk: () => generate(true),
      });
      return;
    }
    Modal.confirm({
      title: "重新生成当前草稿？",
      content: "新候选通过全部质量门禁后才会原子替换当前未评审草稿；生成失败不会删除现有数据。已有人工评审的草稿不可替换。",
      okText: "重新生成",
      cancelText: "取消",
      onOk: () => generate(true),
    });
  }

  function startReview(testCase: DesignedTestCase) {
    const existing = reviews.get(testCase.id);
    setReviewing(testCase);
    setEditedCase(structuredClone(testCase));
    setEditedSteps((testCase.steps ?? []).map((step) => `${step.action} => ${step.expected}`).join("\n"));
    setReviewStatus(existing?.status ?? "accepted");
    setReviewer(existing?.reviewer ?? "");
    setReviewReason(existing?.reason ?? "");
  }

  async function saveReview() {
    if (!current || !reviewing || !editedCase) return;
    if (!reviewer.trim()) {
      message.error("请填写评审人");
      return;
    }
    setSavingReview(true);
    try {
      await readJson<TestCaseReviewRecord>(await fetch(`/api/test-designs/${encodeURIComponent(current.id)}/reviews/${encodeURIComponent(reviewing.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: reviewStatus,
          reviewer,
          reason: reviewReason,
          amendedTestCase: {
            ...editedCase,
            steps: editedSteps.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
              const separator = line.indexOf("=>");
              return { order: index + 1, action: separator >= 0 ? line.slice(0, separator).trim() : line, expected: separator >= 0 ? line.slice(separator + 2).trim() : "" };
            }),
          },
        }),
      }));
      setReviewing(undefined);
      setEditedCase(undefined);
      await openDesign(current.id);
      await refresh();
      onChanged?.();
      message.success(`${reviewing.id} 评审已保存，列表和状态已刷新`);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "评审保存失败");
    } finally {
      setSavingReview(false);
    }
  }

  async function approve() {
    if (!current || !approvedBy.trim()) return;
    setApproving(true);
    try {
      await readJson(await fetch(`/api/test-designs/${encodeURIComponent(current.id)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedBy }),
      }));
      await openDesign(current.id);
      await refresh();
      message.success(`Approved TestCase v${current.version} 已建立`);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "批准失败");
    } finally {
      setApproving(false);
    }
  }

  return <div style={{ maxWidth: 1220, margin: "0 auto", paddingBottom: 32 }}>
    {!simplified && <Flex justify="space-between" align="flex-start" gap={16} wrap>
      <div>
        <Title level={3} style={{ marginBottom: 6 }}>智能化测试用例设计</Title>
        <Paragraph type="secondary">先从获批需求基线建立并冻结 Test Model，再由 Deep Agents 按模型生成 TestCase；Cucumber 官方解析器验证中文 Gherkin。</Paragraph>
      </div>
      <Space wrap>
        <Select
          style={{ minWidth: 320 }}
          placeholder="选择需求基线"
          value={baselineId}
          onChange={setBaselineId}
          options={baselines.map((item) => ({ value: item.id, label: `Baseline v${item.version} · ${item.prdRevision} · ${item.prdFilename}` }))}
        />
        <Button type="primary" icon={<ExperimentOutlined />} loading={loading} disabled={!baselineId || !approvedTestModelVersionId || !approvedTestConditionVersionId} onClick={requestGeneration}>{designs.some((item) => item.baselineId === baselineId && item.status === "draft") ? "重新生成草稿" : designs.some((item) => item.baselineId === baselineId && item.status === "approved") ? "生成新候选版本" : "按条件生成测试用例"}</Button>
      </Space>
    </Flex>}

    {simplified && baselineId && <Alert
      type="success"
      showIcon
      style={{ marginBottom: 16 }}
      message="已自动使用当前冻结需求"
      description={(() => { const item = baselines.find((baseline) => baseline.id === baselineId); return item ? `${item.prdRevision} · ${item.prdFilename}` : "正在读取需求基线"; })()}
    />}

    {showModeling && <div style={{ marginBottom: 16 }}>
      <TestModeling baselineId={baselineId} value={approvedTestModelVersionId} onChange={setSelectedTestModelVersionId} simplified={simplified} />
    </div>}

    {simplified && <Card size="small" title="生成具体验收用例" style={{ marginBottom: 16 }}>
      <Flex justify="space-between" align="center" gap={12} wrap>
        <Text type="secondary">验收方案确认后，系统会展开为可审核的正常、边界、冲突和异常用例。</Text>
        <Button type="primary" icon={<ExperimentOutlined />} loading={loading} disabled={!baselineId || !approvedTestModelVersionId || !approvedTestConditionVersionId} onClick={requestGeneration}>
          {designs.some((item) => item.baselineId === baselineId && item.status === "draft") ? "重新生成验收用例" : designs.some((item) => item.baselineId === baselineId && item.status === "approved") ? "生成新版验收用例" : "生成验收用例"}
        </Button>
      </Flex>
    </Card>}

    {!simplified && <Card size="small" title={<Space><DatabaseOutlined />项目知识（RAG 补充证据）</Space>} style={{ marginBottom: 16 }} extra={<Tag color="blue">Docling HybridChunker · Qdrant</Tag>}>
      <Paragraph type="secondary">上传架构说明、接口契约、数据字典、企业规则或历史缺陷。生成测试设计时 Agent 可按需检索，但完整 PRD 与已批准基线始终是主输入。</Paragraph>
      <Space wrap align="start">
        <Upload beforeUpload={() => false} maxCount={1} fileList={knowledgeFile} onChange={({ fileList }) => setKnowledgeFile(fileList.slice(-1))}>
          <Button icon={<UploadOutlined />}>选择知识文件</Button>
        </Upload>
        <Button type="primary" loading={indexingKnowledge} disabled={!knowledgeFile.length} onClick={() => void uploadKnowledge()}>解析并建立索引</Button>
      </Space>
      <div style={{ marginTop: 12 }}><Space wrap>{knowledge.length ? knowledge.map((item) => <Space key={item.id} size={2}><Tag color={item.status === "indexed" ? "green" : item.status === "failed" ? "red" : "gold"}>{item.filename} · {item.status === "indexed" ? `${item.chunkCount} 片段` : item.status === "failed" ? `失败：${item.error}` : "处理中"}</Tag><Popconfirm title="删除该知识文档及其索引？" onConfirm={() => void removeKnowledge(item.id)}><Button size="small" danger>删除</Button></Popconfirm></Space>) : <Text type="secondary">尚未上传项目知识；当前会明确以“无知识命中”运行，不会伪造引用。</Text>}</Space></div>
    </Card>}

    {error && <Alert type="error" showIcon message="测试设计流程已停止" description={error} style={{ marginBottom: 16 }} />}
    {loading && <Card><Space><Spin /><Text>正在从 Baseline 生成风险、测试点和 Gherkin 用例；失败不会切换模型或生成器。</Text></Space></Card>}

    {designs.length > 0 && <Card size="small" title="已保存的测试设计" style={{ marginBottom: 16 }}>
      <Space wrap>{designs.map((item) => <Button key={item.id} type={selectedId === item.id ? "primary" : "default"} onClick={() => void openDesign(item.id)}>
        <Space size={6}>Baseline {baselines.find((baseline) => baseline.id === item.baselineId)?.version ?? "-"} · 设计 v{item.version}<Tag color={item.status === "approved" ? "green" : "blue"}>{item.status === "approved" ? "已批准" : "待评审"}</Tag>{item.reviewSummary && <Tag>待评审 {item.reviewSummary.pending}</Tag>}</Space>
      </Button>)}</Space>
    </Card>}

    {!loading && !current && <Empty description={simplified ? (approvedTestConditionVersionId ? "测试条件已批准，可以生成验收用例" : "请先建立并批准测试条件") : (approvedTestConditionVersionId ? "Approved TestCondition 已就绪，可以生成测试用例" : "请先批准 Test Model 与 TestCondition")} />}
    {current && <>
      <Card style={{ marginBottom: 16 }}>
        <Flex justify="space-between" gap={16} wrap>
          <Space size={28} wrap>
            <Statistic title="风险" value={current.document.risks.length} />
            <Statistic title="测试点" value={current.document.test_points.length} />
            <Statistic title={simplified ? "验收用例" : "TestCase"} value={current.document.test_cases.length} />
            <Statistic title="待评审" value={reviewSummary?.pending ?? 0} />
            <Statistic title="已接受" value={reviewSummary?.accepted ?? 0} />
            <Statistic title="已驳回" value={reviewSummary?.rejected ?? 0} />
          </Space>
          <Space direction="vertical" align="end">
            <Tag color={current.status === "approved" ? "green" : "blue"}>{current.status === "approved" ? (simplified ? `验收用例 v${current.approvedVersion?.version ?? current.version} 已确认` : `Approved TestCase v${current.approvedVersion?.version ?? current.version}`) : (simplified ? `验收用例草稿 v${current.version}` : `Draft TestCase v${current.version}`)}</Tag>
            {current.traceId && <a href={current.traceUrl || `http://127.0.0.1:6006`} target="_blank" rel="noreferrer"><LinkOutlined /> 查看 Phoenix Trace</a>}
          </Space>
        </Flex>
        <Paragraph style={{ marginTop: 14, marginBottom: 0 }}>{current.document.objective}</Paragraph>
      </Card>

      {current.document.parameter_extraction_assessment && <Alert
        style={{ marginBottom: 12 }}
        type={current.document.parameter_extraction_assessment.status === "applicable" ? "success" : current.document.parameter_extraction_assessment.status === "blocked" ? "warning" : "info"}
        showIcon
        message={`参数提取能力：${current.document.parameter_extraction_assessment.status}`}
        description={`${current.document.parameter_extraction_assessment.reason} · 实现方式 ${current.document.parameter_extraction_assessment.implementation_pattern} · Schema ${current.document.parameter_extraction_assessment.schema_version} · 已规划 ${current.document.parameter_extraction_assessment.aspects.filter((item) => item.status === "planned").length}/18`}
      />}

      <Flex justify="space-between" align="center" gap={12} wrap style={{ marginBottom: 12 }}>
        <Segmented value={view} onChange={(value) => setView(value as typeof view)} options={[
          { label: `${simplified ? "验收用例" : "测试用例"} ${current.document.test_cases.length}`, value: "cases" },
          { label: `${simplified ? "验收场景" : "测试条件"} ${current.document.test_conditions?.length ?? 0}`, value: "conditions" },
          { label: `${simplified ? "验收重点" : "测试点"} ${current.document.test_points.length}`, value: "points" },
          { label: `风险 ${current.document.risks.length}`, value: "risks" },
          { label: "成熟工具", value: "tools" },
        ]} />
        {current.status === "draft" && <Space><Input placeholder="确认人（全部审核后必填）" value={approvedBy} onChange={(event) => setApprovedBy(event.target.value)} /><Button type="primary" icon={<CheckCircleOutlined />} loading={approving} disabled={!approvedBy.trim() || (reviewSummary?.pending ?? 1) > 0} onClick={() => void approve()}>{simplified ? "确认验收用例" : "批准 TestCase 版本"}</Button></Space>}
      </Flex>

      {view === "cases" && <Collapse items={current.document.test_cases.map((testCase) => {
        const review = reviews.get(testCase.id);
        return { key: testCase.id, label: <Flex justify="space-between" gap={8}><Space wrap><Text strong>{testCase.id} · {testCase.title}</Text><Tag color={testCase.priority === "P0" ? "red" : testCase.priority === "P1" ? "orange" : "blue"}>{testCase.priority}</Tag><Tag color={review?.status === "accepted" ? "green" : review?.status === "rejected" ? "red" : "gold"}>{review?.status === "accepted" ? "已接受" : review?.status === "rejected" ? "已驳回" : "待评审"}</Tag></Space>{current.status === "draft" && <Button size="small" onClick={(event) => { event.stopPropagation(); startReview(testCase); }}>评审</Button>}</Flex>, children: <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <Text>{testCase.objective}</Text>
          <Descriptions size="small" column={1} items={[
            { key: "module", label: "业务模块", children: testCase.module ?? "旧草稿未提供" },
            { key: "scenario", label: "场景类型 / 技法", children: testCase.scenario_type && testCase.technique ? `${scenarioTypeLabels[testCase.scenario_type]} / ${techniqueLabels[testCase.technique]}` : "旧草稿未提供" },
            { key: "pre", label: "前置条件", children: testCase.preconditions.join("；") || "无" },
            { key: "primary", label: "主要验证对象", children: testCase.primary_trace_ref ?? "旧草稿未提供" },
            { key: "condition", label: "主要测试条件", children: testCase.primary_test_condition_ref ?? "旧草稿未提供" },
            { key: "data", label: "测试数据", children: testCase.test_data?.join("；") || "无" },
            { key: "steps", label: "步骤与预期", children: testCase.steps?.length ? <ol style={{ margin: 0, paddingLeft: 20 }}>{testCase.steps.map((step) => <li key={step.order}><Text>{step.action}</Text><br /><Text type="secondary">预期：{step.expected}</Text></li>)}</ol> : "旧草稿未提供" },
            ...(testCase.ai_evaluation ? [{ key: "ai-eval", label: "Testing for AI", children: <Space direction="vertical" size={3}><Space wrap><Tag color="purple">{aiDimensionLabels[testCase.ai_evaluation.dimension]}</Tag>{(testCase.ai_evaluation.evaluation_subjects ?? []).map((item) => <Tag color="geekblue" key={item}>{item}</Tag>)}{(testCase.ai_evaluation.evaluation_layers ?? []).map((item) => <Tag key={item}>{item}</Tag>)}</Space><Text>Oracle：{testCase.ai_evaluation.oracle_type} · Evaluator：{testCase.ai_evaluation.evaluator}</Text><Text>期望：{testCase.ai_evaluation.expected_behavior}</Text><Text>门槛：{testCase.ai_evaluation.threshold}</Text>{testCase.ai_evaluation.parameter_extraction && <Card size="small" title={`参数提取 · ${testCase.ai_evaluation.parameter_extraction.aspect}`}><Text>层级：{testCase.ai_evaluation.parameter_extraction.layer} · Slot：{testCase.ai_evaluation.parameter_extraction.slot_name} · 匹配：{testCase.ai_evaluation.parameter_extraction.match_type}</Text><br /><Text>期望：{testCase.ai_evaluation.parameter_extraction.expected_value_json}（{testCase.ai_evaluation.parameter_extraction.expected_type}）· 动作：{testCase.ai_evaluation.parameter_extraction.expected_action}</Text><br /><Text type="secondary">状态：{testCase.ai_evaluation.parameter_extraction.state_target} · {testCase.ai_evaluation.parameter_extraction.reference_datetime} · {testCase.ai_evaluation.parameter_extraction.timezone} · {testCase.ai_evaluation.parameter_extraction.locale} · Schema {testCase.ai_evaluation.parameter_extraction.schema_version}</Text></Card>}<Text type="secondary">Dataset：{testCase.ai_evaluation.dataset_requirements.join("；")}</Text><Text type="secondary">证据：{testCase.ai_evaluation.evidence_requirements.join("；")}</Text></Space> }] : []),
            { key: "trace", label: "基线追溯", children: <Space wrap>{testCase.trace_refs.map((id) => <Tag key={id}>{id}</Tag>)}</Space> },
            { key: "point", label: "测试点", children: testCase.test_point_refs.join("、") },
            { key: "risk", label: "风险", children: testCase.risk_refs.join("、") || "无" },
            { key: "source", label: "PRD 原文证据", children: <Space direction="vertical" size={6}>{testCase.source_refs.map((id) => { const source = baselineSources.get(id); return <Card key={id} size="small"><Text strong>{id} · {source?.source_file_name ?? "来源文件"}</Text><br /><Text type="secondary">{source ? `${source.locator_type} · ${source.locator}` : "定位信息不可用"}</Text><Paragraph style={{ margin: "6px 0 0" }}>{source?.excerpt ?? "该来源不在当前基线快照中"}</Paragraph></Card>; })}</Space> },
            { key: "knowledge", label: "项目知识证据", children: testCase.knowledge_refs?.length ? <Space direction="vertical" size={6}>{testCase.knowledge_refs.map((id) => { const evidence = knowledgeEvidence.get(id); return <Card key={id} size="small"><Text strong>{evidence?.filename ?? id}</Text><br /><Text type="secondary">{[...(evidence?.headings ?? []), ...(evidence?.page_numbers ?? []).map((page) => `第 ${page} 页`), ...(evidence?.doc_items ?? [])].join(" · ") || id}</Text><Paragraph style={{ margin: "6px 0 0" }}>{evidence?.text ?? "冻结的知识证据不可用"}</Paragraph></Card>; })}</Space> : "无知识引用" },
          ]} />
          <pre style={{ margin: 0, padding: 14, overflow: "auto", background: "#0f172a", color: "#e2e8f0", borderRadius: 8, whiteSpace: "pre-wrap" }}>{testCase.gherkin}</pre>
          {amendments.get(testCase.id) && <Collapse size="small" items={[{ key: "amendment", label: `人工修正 · ${amendments.get(testCase.id)?.editor} · ${new Date(amendments.get(testCase.id)?.createdAt ?? "").toLocaleString("zh-CN")}`, children: <><Paragraph>修改理由：{amendments.get(testCase.id)?.reason}</Paragraph><Row gutter={[12, 12]}><Col xs={24} md={12}><Text strong>修改前</Text><pre className="triage-evidence-content">{JSON.stringify(amendments.get(testCase.id)?.before, null, 2)}</pre></Col><Col xs={24} md={12}><Text strong>修改后</Text><pre className="triage-evidence-content">{JSON.stringify(amendments.get(testCase.id)?.after, null, 2)}</pre></Col></Row></> }]} />}
        </Space> };
      })} />}

      {view === "points" && <Collapse items={current.document.test_points.map((point) => ({ key: point.id, label: <Space wrap><Text strong>{point.id} · {point.title}</Text><Tag color="blue">{techniqueLabels[point.technique]}</Tag></Space>, children: <Space direction="vertical"><Text>{point.objective}</Text><Text type="secondary">适用理由：{point.technique_rationale}</Text><Space wrap>{point.trace_refs.map((id) => <Tag key={id}>{id}</Tag>)}</Space></Space> }))} />}

      {view === "conditions" && <Collapse items={(current.document.test_conditions ?? []).map((condition) => ({ key: condition.id, label: <Space wrap><Text strong>{condition.id} · {condition.title}</Text><Tag color="purple">{condition.category}</Tag><Tag>{techniqueLabels[condition.technique]}</Tag>{condition.ai_dimension && <Tag color="magenta">{aiDimensionLabels[condition.ai_dimension]}</Tag>}</Space>, children: <Space direction="vertical"><Text>{condition.objective}</Text><Text type="secondary">设计依据：{condition.rationale}</Text><Space wrap><Tag>{condition.primary_trace_ref}</Tag>{condition.source_refs.map((id) => <Tag key={id}>{id}</Tag>)}</Space></Space> }))} />}

      {view === "risks" && <Space direction="vertical" size={12} style={{ width: "100%" }}>{current.document.risks.map((risk) => <Card key={risk.id} size="small" title={`${risk.id} · ${risk.title}`} extra={<Space><Tag>概率 {risk.likelihood}</Tag><Tag color="orange">影响 {risk.impact}</Tag></Space>}><Paragraph>{risk.description}</Paragraph><Text type="secondary">判断依据：{risk.rationale}</Text><div style={{ marginTop: 8 }}><Space wrap>{risk.trace_refs.map((id) => <Tag key={id}>{id}</Tag>)}</Space></div></Card>)}</Space>}

      {view === "tools" && <Space direction="vertical" size={12} style={{ width: "100%" }}>{current.document.tool_applications.map((tool) => <Alert key={tool.tool} type={tool.status === "applied" ? "success" : "info"} showIcon icon={tool.status === "applied" ? <CheckCircleOutlined /> : <SafetyCertificateOutlined />} message={<Space><Text strong>{toolLabels[tool.tool]}</Text><Tag color={tool.status === "applied" ? "green" : "default"}>{tool.status === "applied" ? "已应用" : "本次不适用"}</Tag></Space>} description={tool.reason} />)}</Space>}
    </>}

    <Modal title={`TestCase 修正与评审 · ${reviewing?.id ?? ""}`} open={Boolean(reviewing)} onCancel={() => { setReviewing(undefined); setEditedCase(undefined); }} onOk={() => void saveReview()} okText="校验并保存评审" confirmLoading={savingReview} width={860}>
      {editedCase && <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Alert type="info" showIcon message="可直接修正 AI 候选稿" description="保存时会重新执行 TestCase Schema、Cucumber/Gherkin、追溯、测试条件和覆盖率 Gate；修正与评审作为同一次事务留痕。" />
        <Text>标题 *</Text><Input value={editedCase.title} onChange={(event) => setEditedCase({ ...editedCase, title: event.target.value })} />
        <Text>业务模块 *</Text><Input value={editedCase.module ?? ""} onChange={(event) => setEditedCase({ ...editedCase, module: event.target.value })} />
        <Text>测试目标 *</Text><Input.TextArea rows={2} value={editedCase.objective} onChange={(event) => setEditedCase({ ...editedCase, objective: event.target.value })} />
        <Text>优先级 *</Text><Select value={editedCase.priority} onChange={(priority) => setEditedCase({ ...editedCase, priority })} options={["P0", "P1", "P2", "P3"].map((value) => ({ value, label: value }))} />
        <Text>前置条件（每行一项）</Text><Input.TextArea rows={3} value={editedCase.preconditions.join("\n")} onChange={(event) => setEditedCase({ ...editedCase, preconditions: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) })} />
        <Text>测试数据（每行一项）</Text><Input.TextArea rows={3} value={(editedCase.test_data ?? []).join("\n")} onChange={(event) => setEditedCase({ ...editedCase, test_data: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) })} />
        <Text>步骤与预期（每行“动作 =&gt; 预期”）*</Text><Input.TextArea rows={5} value={editedSteps} onChange={(event) => setEditedSteps(event.target.value)} />
        {editedCase.ai_evaluation && <Card size="small" title="Testing for AI 评测定义">
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Text>评测维度</Text><Select value={editedCase.ai_evaluation.dimension} onChange={(dimension) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, dimension } })} options={Object.entries(aiDimensionLabels).map(([value, label]) => ({ value, label }))} />
            <Text>评测对象 *</Text><Select mode="multiple" value={editedCase.ai_evaluation.evaluation_subjects ?? []} onChange={(evaluation_subjects) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, evaluation_subjects } })} options={[{ value: "testmesh", label: "TestMesh 自身 Agent" }, { value: "target_application", label: "被测 AI 应用" }]} />
            <Text>证据层 *</Text><Select mode="multiple" value={editedCase.ai_evaluation.evaluation_layers ?? []} onChange={(evaluation_layers) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, evaluation_layers } })} options={[{ value: "agent_decision", label: "Agent 决策层" }, { value: "tool_execution", label: "工具执行层" }, { value: "business_outcome", label: "业务结果层" }, { value: "final_response", label: "最终回复层" }]} />
            <Text>Oracle 类型</Text><Select value={editedCase.ai_evaluation.oracle_type} onChange={(oracle_type) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, oracle_type } })} options={["exact_match", "contains", "regex", "reference_answer", "code_evaluator", "llm_judge", "human_review"].map((value) => ({ value, label: value }))} />
            <Text>期望行为 *</Text><Input.TextArea rows={2} value={editedCase.ai_evaluation.expected_behavior} onChange={(event) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, expected_behavior: event.target.value } })} />
            <Text>Evaluator *</Text><Input value={editedCase.ai_evaluation.evaluator} onChange={(event) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, evaluator: event.target.value } })} />
            <Text>通过门槛 *</Text><Input value={editedCase.ai_evaluation.threshold} onChange={(event) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, threshold: event.target.value } })} />
            <Text>Dataset 样本要求（每行一项）*</Text><Input.TextArea rows={3} value={editedCase.ai_evaluation.dataset_requirements.join("\n")} onChange={(event) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, dataset_requirements: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) } })} />
            <Text>执行证据要求（每行一项）*</Text><Input.TextArea rows={3} value={editedCase.ai_evaluation.evidence_requirements.join("\n")} onChange={(event) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, evidence_requirements: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) } })} />
            {editedCase.ai_evaluation.parameter_extraction && <Card size="small" title="参数提取字段级判定协议">
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Row gutter={8}><Col span={8}><Text>层级</Text><Select style={{ width: "100%" }} value={editedCase.ai_evaluation.parameter_extraction.layer} onChange={(layer) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, parameter_extraction: { ...editedCase.ai_evaluation!.parameter_extraction!, layer } } })} options={["semantic_extraction", "structure_business_validation", "tool_parameter_mapping"].map((value) => ({ value, label: value }))} /></Col><Col span={8}><Text>专项维度</Text><Select style={{ width: "100%" }} value={editedCase.ai_evaluation.parameter_extraction.aspect} onChange={(aspect) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, parameter_extraction: { ...editedCase.ai_evaluation!.parameter_extraction!, aspect } } })} options={["parameter_identification", "value_accuracy", "completeness", "no_redundancy", "type_conformance", "semantic_normalization", "ambiguity_handling", "negation_exclusion", "multi_value", "conflict_resolution", "context_inheritance", "context_override", "required_missing_clarification", "business_constraint", "noise_robustness", "tool_parameter_mapping", "repeatability", "prompt_injection_resistance"].map((value) => ({ value, label: value }))} /></Col><Col span={8}><Text>风险等级</Text><Select style={{ width: "100%" }} value={editedCase.ai_evaluation.parameter_extraction.risk_level} onChange={(risk_level) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, parameter_extraction: { ...editedCase.ai_evaluation!.parameter_extraction!, risk_level } } })} options={["P0", "P1", "P2", "P3"].map((value) => ({ value, label: value }))} /></Col></Row>
                <Row gutter={8}><Col span={8}><Text>Slot 名称</Text><Input value={editedCase.ai_evaluation.parameter_extraction.slot_name} onChange={(event) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, parameter_extraction: { ...editedCase.ai_evaluation!.parameter_extraction!, slot_name: event.target.value } } })} /></Col><Col span={8}><Text>期望类型</Text><Select style={{ width: "100%" }} value={editedCase.ai_evaluation.parameter_extraction.expected_type} onChange={(expected_type) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, parameter_extraction: { ...editedCase.ai_evaluation!.parameter_extraction!, expected_type } } })} options={["string", "integer", "number", "boolean", "date", "time", "datetime", "currency", "array", "object", "missing", "null"].map((value) => ({ value, label: value }))} /></Col><Col span={8}><Text>匹配方式</Text><Select style={{ width: "100%" }} value={editedCase.ai_evaluation.parameter_extraction.match_type} onChange={(match_type) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, parameter_extraction: { ...editedCase.ai_evaluation!.parameter_extraction!, match_type } } })} options={["exact", "normalized", "range", "set", "semantic", "schema", "context_state", "tool_mapping", "absence", "human_review"].map((value) => ({ value, label: value }))} /></Col></Row>
                <Text>期望值（JSON）</Text><Input.TextArea rows={2} value={editedCase.ai_evaluation.parameter_extraction.expected_value_json} onChange={(event) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, parameter_extraction: { ...editedCase.ai_evaluation!.parameter_extraction!, expected_value_json: event.target.value } } })} />
                <Text>归一化规则</Text><Input value={editedCase.ai_evaluation.parameter_extraction.normalization_rule} onChange={(event) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, parameter_extraction: { ...editedCase.ai_evaluation!.parameter_extraction!, normalization_rule: event.target.value } } })} />
                <Row gutter={8}><Col span={8}><Text>状态目标</Text><Select style={{ width: "100%" }} value={editedCase.ai_evaluation.parameter_extraction.state_target} onChange={(state_target) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, parameter_extraction: { ...editedCase.ai_evaluation!.parameter_extraction!, state_target } } })} options={["slot_delta", "merged_slots", "tool_arguments", "not_applicable"].map((value) => ({ value, label: value }))} /></Col><Col span={8}><Text>期望动作</Text><Select style={{ width: "100%" }} value={editedCase.ai_evaluation.parameter_extraction.expected_action} onChange={(expected_action) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, parameter_extraction: { ...editedCase.ai_evaluation!.parameter_extraction!, expected_action } } })} options={["extract", "clarify", "reject", "execute"].map((value) => ({ value, label: value }))} /></Col><Col span={8}><Text>容差</Text><Input value={editedCase.ai_evaluation.parameter_extraction.tolerance} onChange={(event) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, parameter_extraction: { ...editedCase.ai_evaluation!.parameter_extraction!, tolerance: event.target.value } } })} /></Col></Row>
                <Text>参考时间</Text><Input value={editedCase.ai_evaluation.parameter_extraction.reference_datetime} onChange={(event) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, parameter_extraction: { ...editedCase.ai_evaluation!.parameter_extraction!, reference_datetime: event.target.value } } })} />
                <Row gutter={8}><Col span={6}><Text>应出现</Text><Select style={{ width: "100%" }} value={editedCase.ai_evaluation.parameter_extraction.expected_presence} onChange={(expected_presence) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, parameter_extraction: { ...editedCase.ai_evaluation!.parameter_extraction!, expected_presence } } })} options={[{ value: true, label: "是" }, { value: false, label: "否" }]} /></Col><Col span={6}><Text>时区</Text><Input value={editedCase.ai_evaluation.parameter_extraction.timezone} onChange={(event) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, parameter_extraction: { ...editedCase.ai_evaluation!.parameter_extraction!, timezone: event.target.value } } })} /></Col><Col span={6}><Text>Locale</Text><Input value={editedCase.ai_evaluation.parameter_extraction.locale} onChange={(event) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, parameter_extraction: { ...editedCase.ai_evaluation!.parameter_extraction!, locale: event.target.value } } })} /></Col><Col span={6}><Text>Schema 版本</Text><Input value={editedCase.ai_evaluation.parameter_extraction.schema_version} onChange={(event) => setEditedCase({ ...editedCase, ai_evaluation: { ...editedCase.ai_evaluation!, parameter_extraction: { ...editedCase.ai_evaluation!.parameter_extraction!, schema_version: event.target.value } } })} /></Col></Row>
              </Space>
            </Card>}
          </Space>
        </Card>}
        <Text>中文 Gherkin *</Text><Input.TextArea rows={10} value={editedCase.gherkin} onChange={(event) => setEditedCase({ ...editedCase, gherkin: event.target.value })} className="testcase-gherkin-editor" />
        <Text type="secondary">用例 ID、基线追溯、测试条件和证据引用保持受控，不能在此随意改写。</Text>
        <Text><Text type="danger">* </Text>处理结果</Text>
        <Segmented block value={reviewStatus} onChange={(value) => setReviewStatus(value as typeof reviewStatus)} options={[{ label: "接受", value: "accepted" }, { label: "驳回", value: "rejected" }]} />
        <Text><Text type="danger">* </Text>评审人</Text>
        <Input value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="填写评审人" />
        <Text>理由或补充说明（选填）</Text>
        <Input.TextArea value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} rows={3} />
      </Space>}
    </Modal>
  </div>;
}
