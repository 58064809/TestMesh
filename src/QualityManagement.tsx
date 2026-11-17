import {
  EditOutlined,
  PlusOutlined,
  ProjectOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import ProjectConfig from "./ProjectConfig";
import type {
  ApprovedTestCaseVersionOption,
  ApprovedTestModelVersion,
  ProjectRecord,
  QualityCharacteristic,
  QualityImprovementRecord,
  QualityPlanRecord,
  QualitySnapshot,
  ReleaseGateRecord,
  RequirementBaselineRecord,
} from "./types";

const { Text, Title } = Typography;

const characteristicOptions: Array<{
  value: QualityCharacteristic;
  label: string;
}> = [
  { value: "functional_suitability", label: "功能适合性" },
  { value: "performance_efficiency", label: "性能效率" },
  { value: "compatibility", label: "兼容性" },
  { value: "interaction_capability", label: "交互能力/易用性" },
  { value: "reliability", label: "可靠性" },
  { value: "security", label: "安全性" },
  { value: "maintainability", label: "可维护性" },
  { value: "flexibility", label: "灵活性/可扩展性" },
  { value: "safety", label: "安全保障 Safety" },
  { value: "ai_validity_reliability", label: "AI 有效性与可靠性" },
  { value: "ai_transparency_traceability", label: "AI 透明度与可追溯性" },
  { value: "ai_intent_recognition", label: "意图识别" },
  { value: "ai_multi_turn_context", label: "多轮上下文" },
  { value: "ai_constraint_adherence", label: "约束保持" },
  { value: "ai_response_correctness", label: "回复准确性" },
  { value: "ai_groundedness_hallucination", label: "Groundedness / 幻觉" },
  { value: "ai_safety_refusal", label: "安全拒答" },
  { value: "ai_parameter_extraction", label: "参数提取 / Slot Filling" },
  { value: "ai_tool_use_correctness", label: "工具使用正确性" },
  { value: "ai_robustness_consistency", label: "鲁棒性与一致性" },
];

type ProfileOption = {
  id: string;
  name: string;
  version: string;
  status: string;
};
type PlanForm = Omit<
  QualityPlanRecord,
  | "id"
  | "version"
  | "status"
  | "approvedBy"
  | "approvalNote"
  | "approvedAt"
  | "createdAt"
  | "updatedAt"
  | "objectives"
  | "exclusions"
  | "strategies"
  | "entryCriteria"
  | "exitCriteria"
  | "requiredEvidence"
  | "approvers"
  | "risks"
> & {
  objectivesText: string;
  exclusionsText: string;
  strategiesText: string;
  entryCriteriaText: string;
  exitCriteriaText: string;
  requiredEvidenceText: string;
  approversText: string;
  risks: QualityPlanRecord["risks"];
};

function lines(value = ""): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(body.error ?? `请求失败（HTTP ${response.status}）`);
  return body;
}

export default function QualityManagement() {
  const { message } = AntdApp.useApp();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectId, setProjectId] = useState("");
  const [plans, setPlans] = useState<QualityPlanRecord[]>([]);
  const [planId, setPlanId] = useState("");
  const [baselines, setBaselines] = useState<RequirementBaselineRecord[]>([]);
  const [versions, setVersions] = useState<ApprovedTestCaseVersionOption[]>([]);
  const [modelVersions, setModelVersions] = useState<ApprovedTestModelVersion[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [snapshot, setSnapshot] = useState<QualitySnapshot>();
  const [gates, setGates] = useState<ReleaseGateRecord[]>([]);
  const [improvements, setImprovements] = useState<QualityImprovementRecord[]>(
    [],
  );
  const [planModal, setPlanModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<QualityPlanRecord>();
  const [approvePlan, setApprovePlan] = useState<QualityPlanRecord>();
  const [improvementModal, setImprovementModal] = useState(false);
  const [riskGate, setRiskGate] = useState<ReleaseGateRecord>();
  const [improvementUpdate, setImprovementUpdate] = useState<{
    item: QualityImprovementRecord;
    status: QualityImprovementRecord["status"];
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [planForm] = Form.useForm<PlanForm>();
  const [approvalForm] = Form.useForm<{ approvedBy: string; note: string }>();
  const [improvementForm] = Form.useForm();
  const [riskForm] = Form.useForm();
  const [improvementUpdateForm] = Form.useForm<{
    updatedBy: string;
    verificationEvidence: string;
  }>();

  const currentPlan = useMemo(
    () => plans.find((item) => item.id === planId),
    [plans, planId],
  );
  const currentSnapshot = snapshot?.plan.id === planId ? snapshot : undefined;

  const refreshBase = useCallback(async () => {
    const [projectRows, baselineRows, modelVersionRows, versionRows, profileRows] =
      await Promise.all([
        json<ProjectRecord[]>(
          await fetch("/api/projects", { cache: "no-store" }),
        ),
        json<RequirementBaselineRecord[]>(
          await fetch("/api/requirement-baselines", { cache: "no-store" }),
        ),
        json<ApprovedTestModelVersion[]>(
          await fetch("/api/test-models/approved-versions", { cache: "no-store" }),
        ),
        json<ApprovedTestCaseVersionOption[]>(
          await fetch("/api/api-automation/approved-versions", {
            cache: "no-store",
          }),
        ),
        json<ProfileOption[]>(
          await fetch("/api/ai-quality/profiles", { cache: "no-store" }),
        ),
      ]);
    setProjects(projectRows);
    setBaselines(baselineRows);
    setModelVersions(modelVersionRows);
    setVersions(versionRows);
    setProfiles(profileRows);
    setProjectId((value) =>
      projectRows.some((item) => item.id === value)
        ? value
        : (projectRows[0]?.id ?? ""),
    );
  }, []);

  const refreshProject = useCallback(
    async (selectedProjectId: string, preferredPlanId?: string) => {
      if (!selectedProjectId) {
        setPlans([]);
        setPlanId("");
        return;
      }
      const [planRows, gateRows, improvementRows] = await Promise.all([
        json<QualityPlanRecord[]>(
          await fetch(
            `/api/quality-management/plans?projectId=${encodeURIComponent(selectedProjectId)}`,
            { cache: "no-store" },
          ),
        ),
        json<ReleaseGateRecord[]>(
          await fetch(
            `/api/quality-management/release-gates?projectId=${encodeURIComponent(selectedProjectId)}`,
            { cache: "no-store" },
          ),
        ),
        json<QualityImprovementRecord[]>(
          await fetch(
            `/api/quality-management/improvements?projectId=${encodeURIComponent(selectedProjectId)}`,
            { cache: "no-store" },
          ),
        ),
      ]);
      setPlans(planRows);
      setGates(gateRows);
      setImprovements(improvementRows);
      setPlanId((value) => {
        const preferred = preferredPlanId || value;
        return planRows.some((item) => item.id === preferred)
          ? preferred
          : (planRows[0]?.id ?? "");
      });
    },
    [],
  );

  // Data is loaded from the server as the selected project changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshBase().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "项目质量数据加载失败"),
    );
  }, [refreshBase]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshProject(projectId).catch((cause) =>
      setError(cause instanceof Error ? cause.message : "质量计划加载失败"),
    );
  }, [projectId, refreshProject]);
  useEffect(() => {
    if (!planId) return;
    void fetch(
      `/api/quality-management/plans/${encodeURIComponent(planId)}/snapshot`,
      { cache: "no-store" },
    )
      .then((response) => json<QualitySnapshot>(response))
      .then(setSnapshot)
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "质量快照加载失败"),
      );
  }, [planId, gates, improvements]);

  function openPlan(plan?: QualityPlanRecord) {
    setEditingPlan(plan);
    planForm.setFieldsValue(
      plan
        ? {
            ...plan,
            objectivesText: plan.objectives.join("\n"),
            exclusionsText: plan.exclusions.join("\n"),
            strategiesText: plan.strategies.join("\n"),
            entryCriteriaText: plan.entryCriteria.join("\n"),
            exitCriteriaText: plan.exitCriteria.join("\n"),
            requiredEvidenceText: plan.requiredEvidence.join("\n"),
            approversText: plan.approvers.join("\n"),
          }
        : {
            projectId,
            name: "",
            release: "",
            owner: "",
            objectivesText: "",
            qualityCharacteristics: ["functional_suitability"],
            risks: [],
            scope: "",
            exclusionsText: "",
            strategiesText:
              "需求评审与基线\n风险驱动测试设计\n自动化执行与证据留存",
            entryCriteriaText: "需求基线已批准",
            exitCriteriaText: "关键风险具有通过证据",
            requiredEvidenceText:
              "Requirement Baseline\nApproved TestCase\nTestRun",
            approversText: "",
            baselineId: "",
            approvedTestModelVersionId: "",
            approvedTestCaseVersionId: "",
            aiQualityProfileId: "",
            gateRules: {
              requireApprovedBaseline: true,
              requireApprovedTestModel: true,
              requireApprovedTestCases: true,
              minimumRequirementCoveragePct: 100,
              minimumTraceabilityCompletenessPct: 100,
              minimumTestDataSpecificationCoveragePct: 100,
              minimumAssertionDesignCoveragePct: 100,
              minimumExecutionCompletenessPct: 100,
              minimumExecutionPassRatePct: 100,
              minimumFailureTriageCoveragePct: 100,
              maximumFailedTests: 0,
              requireApiExecution: false,
              requireUiExecution: false,
              requireApprovedAiQualityProfile: false,
              maximumOpenImprovementActions: 0,
            },
          },
    );
    setPlanModal(true);
  }

  async function savePlan(values: PlanForm) {
    setBusy(true);
    try {
      const payload = {
        ...values,
        projectId,
        objectives: lines(values.objectivesText),
        exclusions: lines(values.exclusionsText),
        strategies: lines(values.strategiesText),
        entryCriteria: lines(values.entryCriteriaText),
        exitCriteria: lines(values.exitCriteriaText),
        requiredEvidence: lines(values.requiredEvidenceText),
        approvers: lines(values.approversText),
      } as Record<string, unknown>;
      for (const key of [
        "objectivesText",
        "exclusionsText",
        "strategiesText",
        "entryCriteriaText",
        "exitCriteriaText",
        "requiredEvidenceText",
        "approversText",
      ])
        delete payload[key];
      const saved = await json<QualityPlanRecord>(
        await fetch(
          editingPlan
            ? `/api/quality-management/plans/${editingPlan.id}`
            : "/api/quality-management/plans",
          {
            method: editingPlan ? "PUT" : "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          },
        ),
      );
      setPlanModal(false);
      await refreshProject(projectId, saved.id);
      message.success(editingPlan ? "质量计划已更新" : "质量计划草稿已创建");
    } catch (cause) {
      message.error(
        cause instanceof Error ? cause.message : "质量计划保存失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function approve(values: { approvedBy: string; note: string }) {
    if (!approvePlan) return;
    setBusy(true);
    try {
      await json(
        await fetch(`/api/quality-management/plans/${approvePlan.id}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(values),
        }),
      );
      setApprovePlan(undefined);
      await refreshProject(projectId, approvePlan.id);
      message.success("质量计划已批准并冻结");
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "批准失败");
    } finally {
      setBusy(false);
    }
  }

  async function evaluate() {
    if (!currentPlan) return;
    setBusy(true);
    try {
      const gate = await json<ReleaseGateRecord>(
        await fetch(
          `/api/quality-management/plans/${currentPlan.id}/release-gates`,
          { method: "POST" },
        ),
      );
      await refreshProject(projectId, currentPlan.id);
      message.success(`OPA 准入结果：${gate.status}`);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "准入评估失败");
    } finally {
      setBusy(false);
    }
  }

  async function createImprovement(values: Record<string, string>) {
    if (!currentPlan) return;
    setBusy(true);
    try {
      await json(
        await fetch(
          `/api/quality-management/plans/${currentPlan.id}/improvements`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(values),
          },
        ),
      );
      setImprovementModal(false);
      await refreshProject(projectId, currentPlan.id);
      message.success("改进项已创建");
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "改进项创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function updateImprovement(values: {
    updatedBy: string;
    verificationEvidence: string;
  }) {
    if (!improvementUpdate) return;
    const { item, status } = improvementUpdate;
    try {
      await json(
        await fetch(`/api/quality-management/improvements/${item.id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status,
            verificationEvidence:
              values.verificationEvidence || item.verificationEvidence,
            updatedBy: values.updatedBy,
          }),
        }),
      );
      setImprovementUpdate(undefined);
      await refreshProject(projectId, planId);
      message.success("改进项状态已更新");
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "改进项更新失败");
    }
  }

  const selector = (
    <Space wrap>
      <Text strong>当前项目</Text>
      <Select
        style={{ minWidth: 260 }}
        value={projectId || undefined}
        onChange={setProjectId}
        placeholder="请选择项目"
        options={projects.map((item) => ({
          value: item.id,
          label: `${item.name} · ${item.code}`,
        }))}
      />
      <Text strong>质量计划</Text>
      <Select
        style={{ minWidth: 300 }}
        value={planId || undefined}
        onChange={setPlanId}
        placeholder="请选择质量计划"
        options={plans.map((item) => ({
          value: item.id,
          label: `${item.name} · ${item.release} · v${item.version} · ${item.status}`,
        }))}
      />
    </Space>
  );

  const planTab = (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {selector}
      <Flex justify="space-between">
        <Title level={4}>质量计划</Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!projectId}
          onClick={() => openPlan()}
        >
          新建计划版本
        </Button>
      </Flex>
      {plans.length ? (
        <List
          dataSource={plans}
          renderItem={(plan) => (
            <List.Item
              actions={
                plan.status === "draft"
                  ? [
                      <Button
                        key="edit"
                        icon={<EditOutlined />}
                        onClick={() => openPlan(plan)}
                      >
                        编辑
                      </Button>,
                      <Button
                        key="approve"
                        type="primary"
                        onClick={() => {
                          setApprovePlan(plan);
                          approvalForm.resetFields();
                        }}
                      >
                        批准并冻结
                      </Button>,
                    ]
                  : []
              }
            >
              <List.Item.Meta
                title={
                  <Space>
                    <Text strong>
                      {plan.name} · {plan.release}
                    </Text>
                    <Tag>v{plan.version}</Tag>
                    <Tag color={plan.status === "approved" ? "green" : "blue"}>
                      {plan.status}
                    </Tag>
                  </Space>
                }
                description={`${plan.owner} · ${plan.objectives.length} 项目标 · ${plan.qualityCharacteristics.length} 个质量属性 · ${plan.risks.length} 个风险`}
              />
            </List.Item>
          )}
        />
      ) : (
        <Empty description="当前项目还没有质量计划" />
      )}
    </Space>
  );

  const metricTab = (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {selector}
      {currentSnapshot ? (
        <>
          <Alert
            type="info"
            showIcon
            message="分层质量指标"
            description="治理层确认计划与基线，覆盖层衡量需求和用例，执行层汇总真实 TestRun，AI质量层统计 Testing for AI 用例与评测配置，改进层跟踪闭环。"
          />
          {currentSnapshot.metrics.missingAiDimensions.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message="Testing for AI 覆盖尚不完整"
              description={`质量计划要求但 Approved TestCase 尚未覆盖：${currentSnapshot.metrics.missingAiDimensions.join("、")}`}
            />
          )}
          <Row gutter={[12, 12]}>
            <Col xs={12} lg={4}>
              <Card>
                <Statistic
                  title="需求覆盖率"
                  value={currentSnapshot.metrics.requirementCoveragePct}
                  suffix="%"
                />
              </Card>
            </Col>
            <Col xs={12} lg={4}>
              <Card>
                <Statistic
                  title="执行完整率"
                  value={currentSnapshot.metrics.executionCompletenessPct}
                  suffix="%"
                />
              </Card>
            </Col>
            <Col xs={12} lg={4}>
              <Card>
                <Statistic
                  title="执行通过率"
                  value={currentSnapshot.metrics.executionPassRatePct}
                  suffix="%"
                />
              </Card>
            </Col>
            <Col xs={12} lg={4}>
              <Card>
                <Statistic
                  title="AI 评测完整率"
                  value={currentSnapshot.metrics.aiEvaluationCoveragePct}
                  suffix="%"
                />
              </Card>
            </Col>
            <Col xs={12} lg={4}>
              <Card>
                <Statistic
                  title="Approved TestCase"
                  value={currentSnapshot.metrics.approvedTestCases}
                />
              </Card>
            </Col>
            <Col xs={12} lg={4}>
              <Card>
                <Statistic
                  title="未关闭改进项"
                  value={currentSnapshot.metrics.openImprovementActions}
                />
              </Card>
            </Col>
          </Row>
          <Card
            title="质量度量目录"
            extra={<Text type="secondary">暂无数据 ≠ 0%，也不代表达标</Text>}
          >
            <Table
              rowKey="id"
              pagination={false}
              scroll={{ x: 980 }}
              dataSource={currentSnapshot.metricCatalog}
              columns={[
                { title: "分类", dataIndex: "category", width: 90 },
                { title: "指标", dataIndex: "name", width: 160 },
                {
                  title: "当前值",
                  width: 120,
                  render: (_, item) =>
                    item.status === "available" ? (
                      `${item.value}${item.unit}`
                    ) : (
                      <Tag>暂无数据</Tag>
                    ),
                },
                {
                  title: "分子 / 分母",
                  width: 120,
                  render: (_, item) =>
                    item.status === "available"
                      ? `${item.numerator} / ${item.denominator}`
                      : "- / -",
                },
                {
                  title: "口径或缺失原因",
                  render: (_, item) => item.formula || item.note,
                },
                {
                  title: "证据来源",
                  dataIndex: "evidence",
                  width: 210,
                  render: (value: string) => value || "待接入",
                },
              ]}
            />
          </Card>
          <Card title="统一质量资产链">
            <List
              dataSource={currentSnapshot.assets.nodes}
              renderItem={(node) => (
                <List.Item>
                  <Space>
                    <Tag
                      color={
                        node.type === "quality_plan"
                          ? "blue"
                          : node.status === "approved" ||
                              node.status === "passed"
                            ? "green"
                            : "default"
                      }
                    >
                      {node.type}
                    </Tag>
                    <Text>{node.label}</Text>
                    <Text type="secondary">{node.status}</Text>
                  </Space>
                </List.Item>
              )}
            />
            <Collapse
              size="small"
              items={[
                {
                  key: "links",
                  label: `追溯关系 ${currentSnapshot.assets.links.length} 条`,
                  children: (
                    <List
                      size="small"
                      dataSource={currentSnapshot.assets.links}
                      renderItem={(link) => (
                        <List.Item>
                          <Text code>{link.from}</Text>
                          <Tag>{link.relation}</Tag>
                          <Text code>{link.to}</Text>
                        </List.Item>
                      )}
                    />
                  ),
                },
              ]}
            />
          </Card>
        </>
      ) : (
        <Empty description="请选择质量计划" />
      )}
    </Space>
  );

  const gateTab = (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {selector}
      <Alert
        type="info"
        showIcon
        message="发布准入由 OPA/Rego 决策"
        description="TestMesh只提供质量事实、执行策略并保存决策证据；deny不能人工覆盖，review可以记录有期限的风险接受。"
      />
      <Button
        type="primary"
        icon={<SafetyCertificateOutlined />}
        disabled={!currentPlan || currentPlan.status !== "approved"}
        loading={busy}
        onClick={() => void evaluate()}
      >
        执行发布准入评估
      </Button>
      {gates.length ? (
        <List
          dataSource={gates}
          renderItem={(gate) => (
            <List.Item
              actions={
                gate.status === "review" && !gate.riskAcceptance
                  ? [
                      <Button
                        key="accept"
                        onClick={() => {
                          setRiskGate(gate);
                          riskForm.resetFields();
                        }}
                      >
                        风险接受
                      </Button>,
                    ]
                  : []
              }
            >
              <List.Item.Meta
                title={
                  <Space>
                    <Tag
                      color={
                        gate.status === "allow"
                          ? "green"
                          : gate.status === "review"
                            ? "orange"
                            : "red"
                      }
                    >
                      {gate.status}
                    </Tag>
                    <Text>
                      {new Date(gate.evaluatedAt).toLocaleString("zh-CN")}
                    </Text>
                    <Tag>OPA {gate.opaVersion}</Tag>
                    <Tag>{gate.policyVersion}</Tag>
                  </Space>
                }
                description={
                  <Space direction="vertical">
                    <Text>
                      {gate.result.reasons.join("；") || "全部策略通过"}
                    </Text>
                    {gate.riskAcceptance && (
                      <Text type="warning">
                        已由 {gate.riskAcceptance.acceptedBy} 接受风险：
                        {gate.riskAcceptance.reason}
                      </Text>
                    )}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      ) : (
        <Empty description="还没有发布准入评估" />
      )}
    </Space>
  );

  const improvementTab = (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {selector}
      <Flex justify="space-between">
        <Alert
          style={{ flex: 1 }}
          type="info"
          showIcon
          message="失败、准入问题和复盘结论必须形成可验证改进项"
          description="改进项只有填写验证证据后才能标记为已验证或关闭；关闭结果会重新进入下一次发布准入。"
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={!currentPlan}
          onClick={() => {
            improvementForm.setFieldsValue({
              sourceType: "manual",
              sourceId: "",
              rootCauseCategory: "unknown",
              dueDate: "",
            });
            setImprovementModal(true);
          }}
        >
          新增改进项
        </Button>
      </Flex>
      {improvements.length ? (
        <List
          dataSource={improvements}
          renderItem={(item) => (
            <List.Item
              actions={
                item.status !== "closed"
                  ? [
                      <Select
                        key="status"
                        value={item.status}
                        onChange={(value) => {
                          setImprovementUpdate({ item, status: value });
                          improvementUpdateForm.setFieldsValue({
                            updatedBy: "",
                            verificationEvidence: item.verificationEvidence,
                          });
                        }}
                        options={[
                          "open",
                          "in_progress",
                          "verified",
                          "closed",
                        ].map((value) => ({ value, label: value }))}
                      />,
                    ]
                  : []
              }
            >
              <List.Item.Meta
                title={
                  <Space>
                    <Tag color={item.status === "closed" ? "green" : "orange"}>
                      {item.status}
                    </Tag>
                    <Text strong>{item.title}</Text>
                    <Tag>{item.rootCauseCategory}</Tag>
                  </Space>
                }
                description={
                  <Space direction="vertical">
                    <Text>{item.action}</Text>
                    <Text type="secondary">
                      负责人：{item.owner} · 来源：{item.sourceType}{" "}
                      {item.sourceId}
                    </Text>
                    {item.verificationEvidence && (
                      <Text>验证证据：{item.verificationEvidence}</Text>
                    )}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      ) : (
        <Empty description="当前项目没有改进项" />
      )}
    </Space>
  );

  return (
    <div className="quality-management-page">
      <Alert
        type="success"
        showIcon
        icon={<ProjectOutlined />}
        message="项目质量管理"
        description="以质量计划为中心，统一质量目标、风险、需求基线、Approved TestCase、执行证据、发布准入和持续改进；Testing for AI 同样进入该体系。"
      />
      {error && (
        <Alert
          closable
          type="error"
          message="操作未完成"
          description={error}
          onClose={() => setError(undefined)}
        />
      )}
      <Tabs
        items={[
          { key: "config", label: "项目与环境", children: <ProjectConfig /> },
          { key: "plan", label: "质量计划", children: planTab },
          { key: "metrics", label: "资产与指标", children: metricTab },
          { key: "gate", label: "发布准入", children: gateTab },
          { key: "improvement", label: "持续改进", children: improvementTab },
        ]}
      />

      <Modal
        width={900}
        title={editingPlan ? "编辑质量计划草稿" : "新建质量计划"}
        open={planModal}
        onCancel={() => setPlanModal(false)}
        onOk={() => planForm.submit()}
        confirmLoading={busy}
        okText="保存草稿"
      >
        <Form
          form={planForm}
          layout="vertical"
          onFinish={(values) => void savePlan(values)}
        >
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="name"
                label="计划名称"
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="release"
                label="发布版本/批次"
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="owner"
                label="质量负责人"
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="objectivesText"
            label="质量目标（每行一项）"
            rules={[{ required: true }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item
            name="qualityCharacteristics"
            label="适用质量属性"
            rules={[{ required: true }]}
          >
            <Select mode="multiple" options={characteristicOptions} />
          </Form.Item>
          <Form.Item name="scope" label="测试范围" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="exclusionsText" label="排除范围（每行一项）">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item
            name="strategiesText"
            label="测试策略（每行一项）"
            rules={[{ required: true }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="entryCriteriaText"
                label="准入条件（每行一项）"
                rules={[{ required: true }]}
              >
                <Input.TextArea rows={3} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="exitCriteriaText"
                label="准出条件（每行一项）"
                rules={[{ required: true }]}
              >
                <Input.TextArea rows={3} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="requiredEvidenceText"
            label="必需证据（每行一项）"
            rules={[{ required: true }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item
            name="approversText"
            label="批准人（每行一名）"
            rules={[{ required: true }]}
          >
            <Input.TextArea rows={2} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={6}>
              <Form.Item name="baselineId" label="Requirement Baseline">
                <Select
                  allowClear
                  options={baselines.map((item) => ({
                    value: item.id,
                    label: `v${item.version} · ${item.prdRevision}`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="approvedTestModelVersionId" label="Approved Test Model">
                <Select
                  allowClear
                  options={modelVersions.map((item) => ({
                    value: item.record.id,
                    label: `v${item.record.version} · ${item.snapshot.test_analysis.test_conditions.length} 个测试条件`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="approvedTestCaseVersionId"
                label="Approved TestCase"
              >
                <Select
                  allowClear
                  options={versions.map((item) => ({
                    value: item.id,
                    label: `v${item.version} · ${item.testCases.length} 条`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="aiQualityProfileId" label="AI质量配置">
                <Select
                  allowClear
                  options={profiles.map((item) => ({
                    value: item.id,
                    label: `${item.name} · ${item.version} · ${item.status}`,
                  }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Card size="small" title="结构化风险">
            <Form.List name="risks">
              {(fields, { add, remove }) => (
                <Space direction="vertical" style={{ width: "100%" }}>
                  {fields.map(({ key, name, ...rest }) => (
                    <Row key={key} gutter={8}>
                      <Col span={4}>
                        <Form.Item
                          {...rest}
                          name={[name, "id"]}
                          rules={[{ required: true }]}
                        >
                          <Input placeholder="R-001" />
                        </Form.Item>
                      </Col>
                      <Col span={5}>
                        <Form.Item
                          {...rest}
                          name={[name, "title"]}
                          rules={[{ required: true }]}
                        >
                          <Input placeholder="风险" />
                        </Form.Item>
                      </Col>
                      <Col span={3}>
                        <Form.Item
                          {...rest}
                          name={[name, "probability"]}
                          initialValue="medium"
                        >
                          <Select
                            options={["low", "medium", "high"].map((v) => ({
                              value: v,
                              label: `概率 ${v}`,
                            }))}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={3}>
                        <Form.Item
                          {...rest}
                          name={[name, "impact"]}
                          initialValue="medium"
                        >
                          <Select
                            options={["low", "medium", "high"].map((v) => ({
                              value: v,
                              label: `影响 ${v}`,
                            }))}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={5}>
                        <Form.Item
                          {...rest}
                          name={[name, "treatment"]}
                          rules={[{ required: true }]}
                        >
                          <Input placeholder="应对措施" />
                        </Form.Item>
                      </Col>
                      <Col span={3}>
                        <Form.Item
                          {...rest}
                          name={[name, "owner"]}
                          rules={[{ required: true }]}
                        >
                          <Input placeholder="责任人" />
                        </Form.Item>
                      </Col>
                      <Col span={1}>
                        <Button danger onClick={() => remove(name)}>
                          ×
                        </Button>
                      </Col>
                    </Row>
                  ))}
                  <Button
                    onClick={() =>
                      add({
                        id: `R-${String(fields.length + 1).padStart(3, "0")}`,
                        probability: "medium",
                        impact: "medium",
                      })
                    }
                  >
                    增加风险
                  </Button>
                </Space>
              )}
            </Form.List>
          </Card>
          <Card size="small" title="OPA发布准入门槛">
            <Alert
              style={{ marginBottom: 12 }}
              type="info"
              showIcon
              message="覆盖、设计、执行和定位证据分别设门槛；不能用局部执行通过率替代整体质量。"
            />
            <Row gutter={12}>
              <Col span={6}>
                <Form.Item
                  name={["gateRules", "minimumRequirementCoveragePct"]}
                  label="最低需求覆盖率"
                >
                  <InputNumber min={0} max={100} addonAfter="%" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item
                  name={["gateRules", "minimumTraceabilityCompletenessPct"]}
                  label="最低追溯完整率"
                >
                  <InputNumber min={0} max={100} addonAfter="%" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item
                  name={[
                    "gateRules",
                    "minimumTestDataSpecificationCoveragePct",
                  ]}
                  label="最低测试数据设计率"
                >
                  <InputNumber min={0} max={100} addonAfter="%" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item
                  name={["gateRules", "minimumAssertionDesignCoveragePct"]}
                  label="最低断言设计率"
                >
                  <InputNumber min={0} max={100} addonAfter="%" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item
                  name={["gateRules", "minimumExecutionCompletenessPct"]}
                  label="最低执行完整率"
                >
                  <InputNumber min={0} max={100} addonAfter="%" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item
                  name={["gateRules", "minimumExecutionPassRatePct"]}
                  label="最低执行通过率"
                >
                  <InputNumber min={0} max={100} addonAfter="%" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item
                  name={["gateRules", "minimumFailureTriageCoveragePct"]}
                  label="最低失败定位覆盖率"
                >
                  <InputNumber min={0} max={100} addonAfter="%" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item
                  name={["gateRules", "maximumFailedTests"]}
                  label="最多失败测试"
                >
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item
                  name={["gateRules", "maximumOpenImprovementActions"]}
                  label="最多未关闭改进项"
                >
                  <InputNumber min={0} />
                </Form.Item>
              </Col>
            </Row>
            <Space wrap>
              <Form.Item
                name={["gateRules", "requireApprovedBaseline"]}
                valuePropName="checked"
                label="需要需求基线"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                name={["gateRules", "requireApprovedTestCases"]}
                valuePropName="checked"
                label="需要 Approved TestCase"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                name={["gateRules", "requireApprovedTestModel"]}
                valuePropName="checked"
                label="需要 Approved Test Model"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                name={["gateRules", "requireApiExecution"]}
                valuePropName="checked"
                label="需要 API 执行"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                name={["gateRules", "requireUiExecution"]}
                valuePropName="checked"
                label="需要 UI 执行"
              >
                <Switch />
              </Form.Item>
              <Form.Item
                name={["gateRules", "requireApprovedAiQualityProfile"]}
                valuePropName="checked"
                label="需要 AI 质量配置"
              >
                <Switch />
              </Form.Item>
            </Space>
          </Card>
        </Form>
      </Modal>

      <Modal
        title="批准并冻结质量计划"
        open={Boolean(approvePlan)}
        onCancel={() => setApprovePlan(undefined)}
        onOk={() => approvalForm.submit()}
        confirmLoading={busy}
      >
        <Alert
          type="warning"
          showIcon
          message="批准后不可覆盖，变化必须创建新版本"
        />
        <Form
          form={approvalForm}
          layout="vertical"
          onFinish={(values) => void approve(values)}
        >
          <Form.Item
            name="approvedBy"
            label="批准人"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="note" label="批准说明">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="新增持续改进项"
        open={improvementModal}
        onCancel={() => setImprovementModal(false)}
        onOk={() => improvementForm.submit()}
        confirmLoading={busy}
      >
        <Form
          form={improvementForm}
          layout="vertical"
          onFinish={(values) => void createImprovement(values)}
        >
          <Form.Item
            name="sourceType"
            label="来源"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                "release_gate",
                "failure_triage",
                "retrospective",
                "manual",
              ].map((v) => ({ value: v, label: v }))}
            />
          </Form.Item>
          <Form.Item name="sourceId" label="来源记录ID">
            <Input />
          </Form.Item>
          <Form.Item name="title" label="改进项" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="rootCauseCategory"
            label="根因分类"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                "requirement",
                "design",
                "code",
                "test",
                "environment",
                "data",
                "process",
                "ai_quality",
                "unknown",
              ].map((v) => ({ value: v, label: v }))}
            />
          </Form.Item>
          <Form.Item
            name="action"
            label="改进措施"
            rules={[{ required: true }]}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="owner" label="责任人" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="dueDate" label="计划完成日期">
            <Input type="date" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="更新改进项状态"
        open={Boolean(improvementUpdate)}
        onCancel={() => setImprovementUpdate(undefined)}
        onOk={() => improvementUpdateForm.submit()}
      >
        <Alert
          type="info"
          showIcon
          message={`目标状态：${improvementUpdate?.status ?? ""}`}
          description="操作人必须记录；已验证或关闭状态必须提供可复核的验证证据。"
        />
        <Form
          form={improvementUpdateForm}
          layout="vertical"
          onFinish={(values) => void updateImprovement(values)}
        >
          <Form.Item
            name="updatedBy"
            label="操作人"
            rules={[{ required: true, message: "请填写操作人" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="verificationEvidence"
            label="验证证据"
            rules={[
              {
                required:
                  improvementUpdate?.status === "verified" ||
                  improvementUpdate?.status === "closed",
                message: "已验证或关闭时必须填写验证证据",
              },
            ]}
          >
            <Input.TextArea
              rows={4}
              placeholder="填写 TestRun、评测实验、缺陷复测或评审记录等证据"
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="人工风险接受"
        open={Boolean(riskGate)}
        onCancel={() => setRiskGate(undefined)}
        onOk={() => riskForm.submit()}
      >
        <Alert
          type="warning"
          showIcon
          message="只允许接受 review 风险；deny必须修复后重新评估"
        />
        <Form
          form={riskForm}
          layout="vertical"
          onFinish={async (values) => {
            if (!riskGate) return;
            try {
              await json(
                await fetch(
                  `/api/quality-management/release-gates/${riskGate.id}/risk-acceptance`,
                  {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      ...values,
                      expiresAt: values.expiresAt
                        ? new Date(values.expiresAt).toISOString()
                        : null,
                    }),
                  },
                ),
              );
              setRiskGate(undefined);
              await refreshProject(projectId, planId);
              message.success("风险接受记录已保存");
            } catch (cause) {
              message.error(
                cause instanceof Error ? cause.message : "保存失败",
              );
            }
          }}
        >
          <Form.Item
            name="acceptedBy"
            label="批准人"
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="reason"
            label="接受理由"
            rules={[{ required: true }]}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="expiresAt" label="失效时间">
            <Input type="datetime-local" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
