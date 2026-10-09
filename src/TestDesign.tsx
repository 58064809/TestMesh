import { CheckCircleOutlined, ExperimentOutlined, LinkOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { Alert, App as AntdApp, Button, Card, Collapse, Descriptions, Empty, Flex, Input, Modal, Segmented, Select, Space, Spin, Statistic, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DesignedTestCase, RequirementBaselineRecord, TestCaseReviewRecord, TestDesignRecord, TestTechnique } from "./types";

const { Title, Text, Paragraph } = Typography;

const techniqueLabels: Record<TestTechnique, string> = {
  scenario: "场景分析",
  equivalence_partition: "等价类",
  boundary_value: "边界值",
  decision_table: "判定表",
  state_transition: "状态迁移",
  combinatorial: "组合覆盖",
  property_based: "Property-based",
};

const toolLabels = {
  cucumber_gherkin: "Cucumber / Gherkin",
  fast_check: "fast-check",
  nist_acts: "NIST ACTS",
  graphwalker: "GraphWalker",
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `请求失败（HTTP ${response.status}）`);
  return payload;
}

export default function TestDesign() {
  const { message } = AntdApp.useApp();
  const [baselines, setBaselines] = useState<RequirementBaselineRecord[]>([]);
  const [designs, setDesigns] = useState<TestDesignRecord[]>([]);
  const [baselineId, setBaselineId] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [current, setCurrent] = useState<TestDesignRecord>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [view, setView] = useState<"cases" | "points" | "risks" | "tools">("cases");
  const [reviewing, setReviewing] = useState<DesignedTestCase>();
  const [reviewStatus, setReviewStatus] = useState<"accepted" | "rejected">("accepted");
  const [reviewer, setReviewer] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approvedBy, setApprovedBy] = useState("");

  const refresh = useCallback(async () => {
    const [baselineRows, designRows] = await Promise.all([
      readJson<RequirementBaselineRecord[]>(await fetch("/api/requirement-baselines", { cache: "no-store" })),
      readJson<TestDesignRecord[]>(await fetch("/api/test-designs", { cache: "no-store" })),
    ]);
    setBaselines(baselineRows);
    setDesigns(designRows);
    setBaselineId((value) => value ?? baselineRows[0]?.id);
    return designRows;
  }, []);

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
    ]).then(([baselineRows, designRows]) => {
      setBaselines(baselineRows);
      setDesigns(designRows);
      setBaselineId(baselineRows[0]?.id);
      if (designRows[0]) void openDesign(designRows[0].id);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "无法读取测试设计"));
  }, [openDesign]);

  const reviews = useMemo(() => new Map((current?.reviews ?? []).map((item) => [item.testCaseId, item])), [current]);
  const reviewSummary = current ? {
    total: current.document.test_cases.length,
    pending: current.document.test_cases.filter((item) => !reviews.has(item.id)).length,
    accepted: current.document.test_cases.filter((item) => reviews.get(item.id)?.status === "accepted").length,
    rejected: current.document.test_cases.filter((item) => reviews.get(item.id)?.status === "rejected").length,
  } : undefined;

  async function generate() {
    if (!baselineId) return;
    setLoading(true);
    setError(undefined);
    try {
      const result = await readJson<{ record: TestDesignRecord; reused: boolean }>(await fetch("/api/test-designs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baselineId }),
      }));
      await refresh();
      await openDesign(result.record.id);
      message.success(result.reused ? "已打开该基线现有的测试设计" : "测试设计已生成并通过 Gherkin 与追溯校验");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "测试设计生成失败");
    } finally {
      setLoading(false);
    }
  }

  function startReview(testCase: DesignedTestCase) {
    const existing = reviews.get(testCase.id);
    setReviewing(testCase);
    setReviewStatus(existing?.status ?? "accepted");
    setReviewer(existing?.reviewer ?? "");
    setReviewReason(existing?.reason ?? "");
  }

  async function saveReview() {
    if (!current || !reviewing) return;
    if (!reviewer.trim()) {
      message.error("请填写评审人");
      return;
    }
    setSavingReview(true);
    try {
      await readJson<TestCaseReviewRecord>(await fetch(`/api/test-designs/${encodeURIComponent(current.id)}/reviews/${encodeURIComponent(reviewing.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: reviewStatus, reviewer, reason: reviewReason }),
      }));
      setReviewing(undefined);
      await openDesign(current.id);
      await refresh();
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
      message.success("Approved TestCase v1 已建立");
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "批准失败");
    } finally {
      setApproving(false);
    }
  }

  return <div style={{ maxWidth: 1220, margin: "0 auto", paddingBottom: 32 }}>
    <Flex justify="space-between" align="flex-start" gap={16} wrap>
      <div>
        <Title level={3} style={{ marginBottom: 6 }}>智能化测试用例设计</Title>
        <Paragraph type="secondary">只读取已批准需求基线。Deep Agents 负责受控生成，Cucumber 官方解析器验证中文 Gherkin；专业工具仅在输入条件完整时启用。</Paragraph>
      </div>
      <Space wrap>
        <Select
          style={{ minWidth: 320 }}
          placeholder="选择需求基线"
          value={baselineId}
          onChange={setBaselineId}
          options={baselines.map((item) => ({ value: item.id, label: `Baseline v${item.version} · ${item.prdRevision} · ${item.prdFilename}` }))}
        />
        <Button type="primary" icon={<ExperimentOutlined />} loading={loading} disabled={!baselineId} onClick={() => void generate()}>生成测试设计</Button>
      </Space>
    </Flex>

    {error && <Alert type="error" showIcon message="测试设计流程已停止" description={error} style={{ marginBottom: 16 }} />}
    {loading && <Card><Space><Spin /><Text>正在从 Baseline 生成风险、测试点和 Gherkin 用例；失败不会切换模型或生成器。</Text></Space></Card>}

    {designs.length > 0 && <Card size="small" title="已保存的测试设计" style={{ marginBottom: 16 }}>
      <Space wrap>{designs.map((item) => <Button key={item.id} type={selectedId === item.id ? "primary" : "default"} onClick={() => void openDesign(item.id)}>
        <Space size={6}>Baseline {baselines.find((baseline) => baseline.id === item.baselineId)?.version ?? "-"}<Tag color={item.status === "approved" ? "green" : "blue"}>{item.status === "approved" ? "已批准" : "待评审"}</Tag>{item.reviewSummary && <Tag>待评审 {item.reviewSummary.pending}</Tag>}</Space>
      </Button>)}</Space>
    </Card>}

    {!loading && !current && <Empty description="选择已建立的需求基线，生成第一份测试设计" />}
    {current && <>
      <Card style={{ marginBottom: 16 }}>
        <Flex justify="space-between" gap={16} wrap>
          <Space size={28} wrap>
            <Statistic title="风险" value={current.document.risks.length} />
            <Statistic title="测试点" value={current.document.test_points.length} />
            <Statistic title="TestCase" value={current.document.test_cases.length} />
            <Statistic title="待评审" value={reviewSummary?.pending ?? 0} />
            <Statistic title="已接受" value={reviewSummary?.accepted ?? 0} />
          </Space>
          <Space direction="vertical" align="end">
            <Tag color={current.status === "approved" ? "green" : "blue"}>{current.status === "approved" ? "Approved TestCase v1" : "Draft TestCase"}</Tag>
            {current.traceId && <a href={current.traceUrl || `http://127.0.0.1:6006`} target="_blank" rel="noreferrer"><LinkOutlined /> 查看 Phoenix Trace</a>}
          </Space>
        </Flex>
        <Paragraph style={{ marginTop: 14, marginBottom: 0 }}>{current.document.objective}</Paragraph>
      </Card>

      <Flex justify="space-between" align="center" gap={12} wrap style={{ marginBottom: 12 }}>
        <Segmented value={view} onChange={(value) => setView(value as typeof view)} options={[
          { label: `测试用例 ${current.document.test_cases.length}`, value: "cases" },
          { label: `测试点 ${current.document.test_points.length}`, value: "points" },
          { label: `风险 ${current.document.risks.length}`, value: "risks" },
          { label: "成熟工具", value: "tools" },
        ]} />
        {current.status === "draft" && <Space><Input placeholder="批准人（全部评审后必填）" value={approvedBy} onChange={(event) => setApprovedBy(event.target.value)} /><Button type="primary" icon={<CheckCircleOutlined />} loading={approving} disabled={!approvedBy.trim() || (reviewSummary?.pending ?? 1) > 0} onClick={() => void approve()}>批准 TestCase 版本</Button></Space>}
      </Flex>

      {view === "cases" && <Collapse items={current.document.test_cases.map((testCase) => {
        const review = reviews.get(testCase.id);
        return { key: testCase.id, label: <Flex justify="space-between" gap={8}><Space wrap><Text strong>{testCase.id} · {testCase.title}</Text><Tag color={testCase.priority === "P0" ? "red" : testCase.priority === "P1" ? "orange" : "blue"}>{testCase.priority}</Tag><Tag color={review?.status === "accepted" ? "green" : review?.status === "rejected" ? "red" : "gold"}>{review?.status === "accepted" ? "已接受" : review?.status === "rejected" ? "已驳回" : "待评审"}</Tag></Space>{current.status === "draft" && <Button size="small" onClick={(event) => { event.stopPropagation(); startReview(testCase); }}>评审</Button>}</Flex>, children: <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <Text>{testCase.objective}</Text>
          <Descriptions size="small" column={1} items={[
            { key: "pre", label: "前置条件", children: testCase.preconditions.join("；") || "无" },
            { key: "trace", label: "基线追溯", children: <Space wrap>{testCase.trace_refs.map((id) => <Tag key={id}>{id}</Tag>)}</Space> },
            { key: "point", label: "测试点", children: testCase.test_point_refs.join("、") },
            { key: "risk", label: "风险", children: testCase.risk_refs.join("、") || "无" },
            { key: "source", label: "原文", children: testCase.source_refs.join("、") },
          ]} />
          <pre style={{ margin: 0, padding: 14, overflow: "auto", background: "#0f172a", color: "#e2e8f0", borderRadius: 8, whiteSpace: "pre-wrap" }}>{testCase.gherkin}</pre>
        </Space> };
      })} />}

      {view === "points" && <Collapse items={current.document.test_points.map((point) => ({ key: point.id, label: <Space wrap><Text strong>{point.id} · {point.title}</Text><Tag color="blue">{techniqueLabels[point.technique]}</Tag></Space>, children: <Space direction="vertical"><Text>{point.objective}</Text><Text type="secondary">适用理由：{point.technique_rationale}</Text><Space wrap>{point.trace_refs.map((id) => <Tag key={id}>{id}</Tag>)}</Space></Space> }))} />}

      {view === "risks" && <Space direction="vertical" size={12} style={{ width: "100%" }}>{current.document.risks.map((risk) => <Card key={risk.id} size="small" title={`${risk.id} · ${risk.title}`} extra={<Space><Tag>概率 {risk.likelihood}</Tag><Tag color="orange">影响 {risk.impact}</Tag></Space>}><Paragraph>{risk.description}</Paragraph><Text type="secondary">判断依据：{risk.rationale}</Text><div style={{ marginTop: 8 }}><Space wrap>{risk.trace_refs.map((id) => <Tag key={id}>{id}</Tag>)}</Space></div></Card>)}</Space>}

      {view === "tools" && <Space direction="vertical" size={12} style={{ width: "100%" }}>{current.document.tool_applications.map((tool) => <Alert key={tool.tool} type={tool.status === "applied" ? "success" : "info"} showIcon icon={tool.status === "applied" ? <CheckCircleOutlined /> : <SafetyCertificateOutlined />} message={<Space><Text strong>{toolLabels[tool.tool]}</Text><Tag color={tool.status === "applied" ? "green" : "default"}>{tool.status === "applied" ? "已应用" : "本次不适用"}</Tag></Space>} description={tool.reason} />)}</Space>}
    </>}

    <Modal title={`TestCase 评审 · ${reviewing?.id ?? ""}`} open={Boolean(reviewing)} onCancel={() => setReviewing(undefined)} onOk={() => void saveReview()} okText="保存评审" confirmLoading={savingReview}>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Text strong>{reviewing?.title}</Text>
        <Text><Text type="danger">* </Text>处理结果</Text>
        <Segmented block value={reviewStatus} onChange={(value) => setReviewStatus(value as typeof reviewStatus)} options={[{ label: "接受", value: "accepted" }, { label: "驳回", value: "rejected" }]} />
        <Text><Text type="danger">* </Text>评审人</Text>
        <Input value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="填写评审人" />
        <Text>理由或补充说明（选填）</Text>
        <Input.TextArea value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} rows={3} />
      </Space>
    </Modal>
  </div>;
}
