import { CheckCircleOutlined, ExperimentOutlined, PlusOutlined, StopOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Form, Input, List, Modal, Select, Space, Tag, Typography, message } from "antd";
import { useEffect, useState } from "react";

const { Text } = Typography;

interface Calibration {
  id: string;
  evaluatorName: string;
  evaluatorVersion: string;
  evaluatorKind: "code" | "llm_judge";
  targetDimensions: string[];
  evaluationSubjects: string[];
  evaluationLayers: string[];
  phoenixDatasetId: string;
  phoenixDatasetVersionId: string;
  phoenixExperimentId: string;
  sampleCount: number;
  metrics: {
    accuracyPct: number;
    macroF1Pct: number;
    minimumPerLabelRecallPct: number;
    repeatAgreementPct: number;
    worstSliceAccuracyPct: number;
    doubleAnnotatedPct: number;
    humanAgreementPct: number;
    blockers: string[];
  };
  passed: boolean;
  calibratedBy: string;
  createdAt: string;
}

async function read<T>(response: Response | Promise<Response>): Promise<T> {
  const result = await response;
  const body = await result.json() as T & { error?: string };
  if (!result.ok) throw new Error(body.error ?? `请求失败（HTTP ${result.status}）`);
  return body;
}

const rowExample = JSON.stringify([
  {
    sampleId: "gold-001",
    slice: "paraphrase",
    humanLabels: ["pass", "pass"],
    adjudicatedLabel: "pass",
    adjudicationNote: "",
    evaluatorLabels: ["pass", "pass", "pass"],
  },
  {
    sampleId: "gold-002",
    slice: "tool_failure",
    humanLabels: ["fail", "fail"],
    adjudicatedLabel: "fail",
    adjudicationNote: "",
    evaluatorLabels: ["fail", "fail", "fail"],
  },
], null, 2);

export default function EvaluatorCalibration() {
  const [rows, setRows] = useState<Calibration[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form] = Form.useForm();

  async function load() {
    setRows(await read<Calibration[]>(fetch("/api/ai-quality/evaluator-calibrations", { cache: "no-store" })));
  }

  useEffect(() => {
    void read<Calibration[]>(fetch("/api/ai-quality/evaluator-calibrations", { cache: "no-store" }))
      .then(setRows)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Evaluator 校准记录加载失败"));
  }, []);

  async function save(values: Record<string, string>) {
    setBusy(true); setError("");
    try {
      let calibrationRows: unknown;
      try { calibrationRows = JSON.parse(values.rowsJson); } catch { throw new Error("金标准对比结果必须是合法 JSON"); }
      if (!Array.isArray(calibrationRows)) throw new Error("金标准对比结果必须是 JSON 数组");
      const saved = await read<Calibration>(fetch("/api/ai-quality/evaluator-calibrations", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          evaluatorName: values.evaluatorName, evaluatorVersion: values.evaluatorVersion,
          evaluatorKind: values.evaluatorKind, targetDimensions: values.targetDimensions.split(",").map((item) => item.trim()).filter(Boolean),
          evaluationSubjects: values.evaluationSubjects.split(",").map((item) => item.trim()).filter(Boolean),
          evaluationLayers: values.evaluationLayers.split(",").map((item) => item.trim()).filter(Boolean),
          phoenixDatasetId: values.phoenixDatasetId, phoenixDatasetVersionId: values.phoenixDatasetVersionId,
          phoenixExperimentId: values.phoenixExperimentId, calibratedBy: values.calibratedBy,
          calibrationNote: values.calibrationNote ?? "", rows: calibrationRows,
        }),
      }));
      await load(); setOpen(false); form.resetFields();
      if (saved.passed) message.success("Evaluator 已通过校准，可以用于执行准备度检查");
      else message.warning("校准记录已保存，但指标未通过，批量执行仍保持阻断");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Evaluator 校准失败"); }
    finally { setBusy(false); }
  }

  return <Card title={<Space><ExperimentOutlined />Evaluator 校准门禁</Space>}>
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      <Alert type="warning" showIcon message="先校准 Evaluator，再运行批量 Experiment" description="使用 Phoenix 金标准 Dataset 和独立人工标签对 Evaluator 做基准验证。TestMesh 计算混淆矩阵派生指标、重复一致性和最差切片表现；未通过的 Evaluator 不能解除批量执行阻断。连续评分不直接用于准入，优先使用 pass/fail 或有限类别标签。" />
      <Space wrap>
        <Tag color="blue">金标准样本默认 ≥ 20</Tag>
        <Tag color="blue">每条重复判定 ≥ 3 次</Tag>
        <Tag color="blue">至少 2 个类别 / 2 个切片</Tag>
        <Tag color="blue">双人复核覆盖默认 ≥ 20%</Tag>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.setFieldsValue({ evaluatorKind: "llm_judge", rowsJson: rowExample }); setOpen(true); }}>登记校准实验</Button>
      </Space>
      {error && <Alert type="error" showIcon message="Evaluator 校准未完成" description={error} closable onClose={() => setError("")} />}
      <List dataSource={rows} locale={{ emptyText: "尚无通过校准的 Evaluator；批量 AI Experiment 将保持阻断" }} renderItem={(item) => <List.Item>
        <List.Item.Meta
          avatar={item.passed ? <CheckCircleOutlined style={{ color: "#52c41a", fontSize: 22 }} /> : <StopOutlined style={{ color: "#ff4d4f", fontSize: 22 }} />}
          title={<Space wrap><Text strong>{item.evaluatorName}</Text><Text code>v{item.evaluatorVersion}</Text><Tag>{item.evaluatorKind}</Tag><Tag color={item.passed ? "green" : "red"}>{item.passed ? "校准通过" : "校准失败"}</Tag></Space>}
          description={<Space direction="vertical" size={4} style={{ width: "100%" }}>
            <Text type="secondary">{item.sampleCount} 个金标准样本 · {item.calibratedBy} · {new Date(item.createdAt).toLocaleString("zh-CN")}</Text>
            <Space wrap>{item.evaluationSubjects.map((value) => <Tag key={value} color="purple">{value}</Tag>)}{item.evaluationLayers.map((value) => <Tag key={value}>{value}</Tag>)}</Space>
            <Descriptions size="small" column={{ xs: 2, lg: 4 }}>
              <Descriptions.Item label="准确率">{item.metrics.accuracyPct}%</Descriptions.Item>
              <Descriptions.Item label="Macro-F1">{item.metrics.macroF1Pct}%</Descriptions.Item>
              <Descriptions.Item label="重复一致率">{item.metrics.repeatAgreementPct}%</Descriptions.Item>
              <Descriptions.Item label="最差切片">{item.metrics.worstSliceAccuracyPct}%</Descriptions.Item>
            </Descriptions>
            {!item.passed && <Text type="danger">{item.metrics.blockers.join("；")}</Text>}
          </Space>}
        />
      </List.Item>} />
    </Space>

    <Modal open={open} title="登记 Phoenix Evaluator 校准实验" width={820} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={busy} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={(values) => void save(values)}>
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message="这里只登记真实校准证据" description="Dataset、Experiment、人工 Annotation 和 Evaluator 输出应已存在于 Phoenix。示例 JSON 仅说明结构，不能直接作为项目校准证据。" />
        <Space align="start" wrap>
          <Form.Item name="evaluatorName" label="Evaluator ID" rules={[{ required: true }]}><Input placeholder="例如 intent_correctness" /></Form.Item>
          <Form.Item name="evaluatorVersion" label="版本" rules={[{ required: true }]}><Input placeholder="例如 1.0.0" /></Form.Item>
          <Form.Item name="evaluatorKind" label="类型" rules={[{ required: true }]}><Select style={{ width: 160 }} options={[{ value: "code", label: "确定性 Code" }, { value: "llm_judge", label: "LLM Judge" }]} /></Form.Item>
        </Space>
        <Form.Item name="targetDimensions" label="适用 AI 维度（逗号分隔）" rules={[{ required: true }]}><Input placeholder="intent_recognition, robustness_consistency" /></Form.Item>
        <Space wrap align="start">
          <Form.Item name="evaluationSubjects" label="评测对象（逗号分隔）" rules={[{ required: true }]}><Input style={{ width: 300 }} placeholder="testmesh, target_application" /></Form.Item>
          <Form.Item name="evaluationLayers" label="证据层（逗号分隔）" rules={[{ required: true }]}><Input style={{ width: 420 }} placeholder="agent_decision, tool_execution, business_outcome, final_response" /></Form.Item>
        </Space>
        <Space align="start" wrap>
          <Form.Item name="phoenixDatasetId" label="Phoenix Dataset ID" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="phoenixDatasetVersionId" label="Dataset Version ID" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="phoenixExperimentId" label="Calibration Experiment ID" rules={[{ required: true }]}><Input /></Form.Item>
        </Space>
        <Form.Item name="rowsJson" label="人工金标准与 Evaluator 重复结果 JSON" rules={[{ required: true }]}><Input.TextArea rows={13} className="testcase-gherkin-editor" /></Form.Item>
        <Form.Item name="calibratedBy" label="校准负责人" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="calibrationNote" label="校准说明"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </Modal>
  </Card>;
}
