import { ApartmentOutlined, CheckCircleOutlined, EditOutlined, ExperimentOutlined } from "@ant-design/icons";
import { Alert, App as AntdApp, Button, Card, Col, Collapse, Descriptions, Flex, Input, Modal, Row, Select, Space, Statistic, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApprovedTestModelVersion, TestModelDocument, TestModelRecord } from "./types";

const { Text, Paragraph } = Typography;

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `请求失败（HTTP ${response.status}）`);
  return payload;
}

export default function TestModeling({ baselineId, projectId, value, onChange, simplified = false, simulationReference = false }: {
  baselineId?: string;
  projectId?: string;
  value?: string;
  onChange: (approvedVersionId?: string) => void;
  simplified?: boolean;
  simulationReference?: boolean;
}) {
  const { message } = AntdApp.useApp();
  const [models, setModels] = useState<TestModelRecord[]>([]);
  const [approved, setApproved] = useState<ApprovedTestModelVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [building, setBuilding] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approvedBy, setApprovedBy] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editor, setEditor] = useState("");
  const [reason, setReason] = useState("");
  const [json, setJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [simulationReadiness, setSimulationReadiness] = useState<{ ready: boolean; blockers: string[] }>();

  const refresh = useCallback(async () => {
    if (!baselineId) {
      setModels([]); setApproved([]); setSelectedId(undefined); onChange(undefined); return;
    }
    const query = encodeURIComponent(baselineId);
    const [modelRows, approvedRows] = await Promise.all([
      readJson<TestModelRecord[]>(await fetch(`/api/test-models?baselineId=${query}`, { cache: "no-store" })),
      readJson<ApprovedTestModelVersion[]>(await fetch(`/api/test-models/approved-versions?baselineId=${query}`, { cache: "no-store" })),
    ]);
    setModels(modelRows);
    setApproved(approvedRows);
    setSelectedId((current) => modelRows.some((item) => item.id === current) ? current : modelRows[0]?.id);
    const next = approvedRows.some((item) => item.record.id === value) ? value : approvedRows[0]?.record.id;
    if (next !== value) onChange(next);
  }, [baselineId, onChange, value]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh().catch((error) => message.error(error instanceof Error ? error.message : "测试模型加载失败"));
  }, [refresh, message]);
  useEffect(() => {
    if (!simulationReference || !baselineId) { void Promise.resolve().then(() => setSimulationReadiness(undefined)); return; }
    void fetch(`/api/test-models/simulation-reference-readiness?baselineId=${encodeURIComponent(baselineId)}`, { cache: "no-store" })
      .then((response) => readJson<{ ready: boolean; blockers: string[] }>(response))
      .then(setSimulationReadiness)
      .catch((error) => message.error(error instanceof Error ? error.message : "模拟基线状态检查失败"));
  }, [baselineId, message, simulationReference]);
  const current = useMemo(() => models.find((item) => item.id === selectedId) ?? models[0], [models, selectedId]);

  async function build() {
    if (!baselineId) return;
    setBuilding(true);
    try {
      const result = await readJson<{ record: TestModelRecord }>(await fetch("/api/test-models", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baselineId, ...(projectId ? { projectId } : {}) }),
      }));
      message.success(simplified ? "测试模型已生成，请核对后批准" : "测试模型候选已建立，请先人工修正并批准，再生成 TestCase");
      await refresh();
      setSelectedId(result.record.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "测试建模失败");
    } finally { setBuilding(false); }
  }

  async function loadSimulationReference() {
    if (!baselineId) return;
    setBuilding(true);
    try {
      const result = await readJson<{ record: TestModelRecord }>(await fetch("/api/test-models/simulation-reference", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baselineId }),
      }));
      message.success("模拟参考模型已加载，请核对后人工批准；它不代表 Prompt 生成质量或真实业务结论");
      await refresh();
      setSelectedId(result.record.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "模拟参考模型加载失败");
    } finally { setBuilding(false); }
  }

  async function approve() {
    if (!current) return;
    setApproving(true);
    try {
      await readJson(await fetch(`/api/test-models/${encodeURIComponent(current.id)}/approve`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approvedBy }),
      }));
      message.success(simplified ? "测试模型已批准，现在可以建立测试条件" : "Approved Test Model 已冻结，现在可以生成测试用例");
      setApprovedBy("");
      await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "测试模型批准失败");
    } finally { setApproving(false); }
  }

  function openEditor() {
    if (!current) return;
    setJson(JSON.stringify(current.document, null, 2)); setEditor(""); setReason(""); setEditOpen(true);
  }

  async function saveModel() {
    if (!current) return;
    let document: TestModelDocument;
    try { document = JSON.parse(json) as TestModelDocument; } catch { message.error("模型 JSON 格式无效"); return; }
    setSaving(true);
    try {
      await readJson(await fetch(`/api/test-models/${encodeURIComponent(current.id)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document, editor, reason }),
      }));
      message.success("测试模型修正已保存并通过确定性校验"); setEditOpen(false); await refresh();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "模型修正失败");
    } finally { setSaving(false); }
  }

  const groups = current ? Object.entries(current.document.business_model) : [];
  const behaviorModels = current?.document.behavior_models;
  return <Card title={<Space><ApartmentOutlined />{simplified ? "建立测试模型" : "先建模：Test Model"}</Space>}>
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        message={simplified ? "先确认要验收什么，再生成具体样本" : "TestCase 生成前置门禁"}
        description={simplified
          ? "系统会从冻结需求中分别建立 M-01 语义与参数、M-02 业务决策、M-03 会话状态、M-04 Agent 交互模型，并补充风险和覆盖目标。这里批准的是测试模型，不代表应用已经通过。"
          : "需求基线先转换为四个行为模型及风险、覆盖与 AI 分层模型。模型可人工修正并冻结；没有 Approved Test Model 时禁止生成测试条件。"}
      />
      <Flex gap={8} wrap align="center">
        {(!simplified || models.length > 1) && <Select style={{ minWidth: 300 }} placeholder={simplified ? "选择历史方案" : "选择测试模型"} value={current?.id} onChange={setSelectedId}
          options={models.map((item) => ({ value: item.id, label: simplified ? `测试模型 v${item.version} · ${item.status === "approved" ? "已批准" : "待批准"}` : `Test Model v${item.version} · ${item.status === "approved" ? "已批准" : "待评审"}` }))} />}
        <Button icon={<ExperimentOutlined />} type={models.length ? "default" : "primary"} loading={building} disabled={!baselineId} onClick={() => void build()}>{simplified ? (models.length ? "建立新版模型" : "建立测试模型") : (models.length ? "建立新模型版本" : "建立测试模型")}</Button>
        {simulationReference && <Button loading={building} disabled={!baselineId || simulationReadiness?.ready === false} onClick={() => void loadSimulationReference()}>加载模拟参考模型</Button>}
        {!simplified && <Select style={{ minWidth: 300 }} placeholder="尚无 Approved Test Model" value={value} onChange={onChange}
          options={approved.map((item) => ({ value: item.record.id, label: `Approved Test Model v${item.record.version} · ${item.record.approvedBy}` }))} />}
        {simplified && value && <Tag color="green" icon={<CheckCircleOutlined />}>方案已确认</Tag>}
      </Flex>
      {simulationReference && simulationReadiness?.ready === false && <Alert
        type="warning"
        showIcon
        message="当前冻结基线需更新"
        description={simulationReadiness.blockers.join("；")}
      />}
      {!current ? <Alert type="warning" showIcon message={simplified ? "尚未建立测试模型" : "尚未建模"} description={simplified ? "点击“建立测试模型”，系统将读取当前冻结需求基线并按固定 Schema 生成候选。" : "请先基于获批需求基线建立测试模型。"} /> : <>
        <Flex justify="space-between" align="center" wrap gap={8}>
          <Space><Tag color={current.status === "approved" ? "green" : "gold"}>{current.status === "approved" ? (simplified ? "已批准" : "已冻结") : (simplified ? "待批准" : "候选模型")}</Tag>{current.model === "simulation-reference/v1" && <Tag color="orange">simulated · 参考资产</Tag>}<Text>{simplified ? "测试模型" : "Test Model"} v{current.version}</Text></Space>
          {current.status === "draft" && <Space><Button icon={<EditOutlined />} onClick={openEditor}>{simplified ? "编辑模型" : "人工修正模型"}</Button><Input style={{ width: 180 }} placeholder="批准人 *" value={approvedBy} onChange={(event) => setApprovedBy(event.target.value)} /><Button type="primary" icon={<CheckCircleOutlined />} disabled={!approvedBy.trim()} loading={approving} onClick={() => void approve()}>{simplified ? "批准测试模型" : "批准并冻结模型"}</Button></Space>}
        </Flex>
        <Row gutter={12}>
          <Col span={6}><Statistic title="行为模型视图" value={behaviorModels ? 4 : 0} suffix="/ 4" /></Col>
          <Col span={6}><Statistic title="风险" value={current.document.test_analysis.risks.length} /></Col>
          <Col span={6}><Statistic title={simplified ? "验收重点" : "测试点"} value={current.document.test_analysis.test_points.length} /></Col>
          <Col span={6}><Statistic title="覆盖目标" value={current.document.quality_model.coverage_targets.length} /></Col>
        </Row>
        <Descriptions size="small" bordered column={1}>
          <Descriptions.Item label="建模目标">{current.document.objective}</Descriptions.Item>
          <Descriptions.Item label="AI 测试范围">{current.document.ai_model.applicable ? <Space wrap>{current.document.ai_model.evaluation_subjects.map((item) => <Tag key={item}>{item}</Tag>)}{current.document.ai_model.evaluation_layers.map((item) => <Tag color="blue" key={item}>{item}</Tag>)}</Space> : "不适用"}</Descriptions.Item>
        </Descriptions>
        {!behaviorModels && <Alert type="warning" showIcon message="这是旧版测试模型草稿" description="旧草稿没有 M-01～M-04 四个行为模型视图，不能用于本轮智能导购流程；请建立新版模型。" />}
        <Collapse items={[
          ...(behaviorModels ? [
            { key: "m01", label: `${behaviorModels.semantic_parameter.model_id} · ${behaviorModels.semantic_parameter.name}`, children: <Space direction="vertical" size={8} style={{ width: "100%" }}>
              {behaviorModels.semantic_parameter.intents.map((item) => <Card key={item.id} size="small"><Text strong>意图 · {item.id}</Text><Paragraph style={{ margin: "4px 0" }}>{item.description}</Paragraph><Text type="secondary">必需参数：{item.required_slots.join("、") || "无"} · 来源：{item.source_refs.join("、")}</Text></Card>)}
              {behaviorModels.semantic_parameter.slots.map((item) => <Card key={item.name} size="small"><Text strong>Slot · {item.name}</Text><Paragraph style={{ margin: "4px 0" }}>类型 {item.value_type}；必填 {item.required ? "是" : "否"}；默认值 {item.default_value_json || "无"}；范围 {item.allowed_range || "未限定"}；标准单位 {item.canonical_unit || "无"}</Paragraph><Text type="secondary">规范化：{item.normalization_rules.join("；") || "无"} · 校验：{item.validation_rules.join("；") || "无"} · 来源：{item.source_refs.join("、")}</Text></Card>)}
              {behaviorModels.semantic_parameter.cross_parameter_constraints.map((item) => <Card key={item.id} size="small"><Text strong>{item.id}</Text><Paragraph style={{ margin: "4px 0" }}>{item.expression}</Paragraph><Text type="secondary">不满足时：{item.invalid_action} · 来源：{item.source_refs.join("、")}</Text></Card>)}
            </Space> },
            { key: "m02", label: `${behaviorModels.business_decision.model_id} · ${behaviorModels.business_decision.name}`, children: <Space direction="vertical" size={8} style={{ width: "100%" }}>{behaviorModels.business_decision.rules.map((item) => <Card key={item.id} size="small"><Space><Text strong>{item.id}</Text><Tag>优先级 {item.priority}</Tag></Space><Paragraph style={{ margin: "4px 0" }}>条件：{item.conditions.join("；")}</Paragraph><Text>动作：{item.actions.join("；")}</Text><br /><Text type="secondary">来源：{item.source_refs.join("、")}</Text></Card>)}</Space> },
            { key: "m03", label: `${behaviorModels.dialogue_state.model_id} · ${behaviorModels.dialogue_state.name}`, children: <Space direction="vertical" size={8} style={{ width: "100%" }}>
              <Space wrap>{behaviorModels.dialogue_state.states.map((item) => <Tag key={item.id} color={item.terminal ? "default" : "blue"}>{item.id}{item.terminal ? "（终态）" : ""}</Tag>)}</Space>
              {behaviorModels.dialogue_state.transitions.map((item) => <Card key={item.id} size="small"><Text strong>{item.id} · {item.from} → {item.to}</Text><Paragraph style={{ margin: "4px 0" }}>事件：{item.event}；守卫：{item.guard || "无"}；允许查询：{item.search_allowed ? "是" : "否"}</Paragraph><Text type="secondary">动作：{item.actions.join("；") || "无"} · 来源：{item.source_refs.join("、")}</Text></Card>)}
              {behaviorModels.dialogue_state.context_rules.map((item) => <Card key={item.id} size="small"><Text strong>{item.id} · {item.operation}</Text><Paragraph style={{ margin: "4px 0" }}>{item.trigger} → {item.outcome}</Paragraph><Text type="secondary">目标：{item.targets.join("、") || "全部上下文"} · 来源：{item.source_refs.join("、")}</Text></Card>)}
            </Space> },
            { key: "m04", label: `${behaviorModels.agent_interaction.model_id} · ${behaviorModels.agent_interaction.name}`, children: <Space direction="vertical" size={8} style={{ width: "100%" }}>
              {behaviorModels.agent_interaction.tools.map((item) => <Card key={item.name} size="small"><Text strong>工具 · {item.name}</Text><Paragraph style={{ margin: "4px 0" }}>{item.description}</Paragraph><Text type="secondary">请求：{item.request_contract} · 响应：{item.response_contract} · 来源：{item.source_refs.join("、")}</Text></Card>)}
              {behaviorModels.agent_interaction.interaction_rules.map((item) => <Card key={item.id} size="small"><Text strong>{item.id} · {item.trigger}</Text><Paragraph style={{ margin: "4px 0" }}>工具：{item.tool || "不调用"}；成功：{item.success_outcome}；无结果：{item.empty_outcome}；失败：{item.failure_outcome}</Paragraph><Text type="secondary">证据：{item.evidence_requirements.join("；")} · 来源：{item.source_refs.join("、")}</Text></Card>)}
            </Space> },
          ] : groups.map(([name, items]) => ({ key: name, label: `${name}（${items.length}）`, children: <Space direction="vertical" size={6} style={{ width: "100%" }}>{items.map((item) => <Card key={item.id} size="small"><Text strong>{item.id}</Text><Paragraph style={{ margin: "4px 0 0" }}>{item.description}</Paragraph><Text type="secondary">来源：{item.source_refs.join("、") || "无"}</Text></Card>)}</Space> }))),
          { key: "risks", label: `风险（${current.document.test_analysis.risks.length}）`, children: <Space direction="vertical" size={6} style={{ width: "100%" }}>{current.document.test_analysis.risks.map((risk) => <Card key={risk.id} size="small"><Space wrap><Text strong>{risk.id} · {risk.title}</Text><Tag color={risk.impact === "high" ? "red" : "default"}>影响 {risk.impact}</Tag><Tag>可能性 {risk.likelihood}</Tag></Space><Paragraph style={{ margin: "4px 0" }}>{risk.description}</Paragraph><Text type="secondary">关联需求：{risk.trace_refs.join("、")} · 原文：{risk.source_refs.join("、")}</Text></Card>)}</Space> },
          { key: "points", label: `测试点（${current.document.test_analysis.test_points.length}）`, children: <Space direction="vertical" size={6} style={{ width: "100%" }}>{current.document.test_analysis.test_points.map((point) => <Card key={point.id} size="small"><Text strong>{point.id} · {point.title}</Text><Paragraph style={{ margin: "4px 0" }}>{point.objective}</Paragraph><Text type="secondary">技法：{point.technique} · 关联需求：{point.trace_refs.join("、")} · 风险：{point.risk_refs.join("、")} · 原文：{point.source_refs.join("、")}</Text></Card>)}</Space> },
        ]} />
        <Alert type="info" showIcon message="正式 TestCondition 在下一步独立生成和审批" description={`模型阶段内部形成的 ${current.document.test_analysis.test_conditions.length} 条候选仅用于覆盖自检，不在这里批准，也不会直接进入 TestCase。`} />
        {current.document.test_analysis.parameter_extraction_assessment?.status === "blocked" && <Alert type="warning" showIcon message="参数提取测试暂不可建模" description={current.document.test_analysis.parameter_extraction_assessment.reason} />}
      </>}
    </Space>
    <Modal title={simplified ? "编辑测试模型" : "人工修正测试模型"} open={editOpen} width={1000} okText="保存修正" confirmLoading={saving} onOk={() => void saveModel()} onCancel={() => setEditOpen(false)}>
      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        <Alert type="warning" showIcon message="保存时会重新执行来源、覆盖、风险、AI双对象和四层证据校验；已批准模型不能修改。" />
        <Text>修正人 *</Text><Input value={editor} onChange={(event) => setEditor(event.target.value)} />
        <Text>修正理由 *</Text><Input.TextArea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
        <Text>模型内容</Text><Input.TextArea className="testcase-gherkin-editor" rows={24} value={json} onChange={(event) => setJson(event.target.value)} />
      </Space>
    </Modal>
  </Card>;
}
