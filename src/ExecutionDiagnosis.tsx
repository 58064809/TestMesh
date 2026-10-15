import { BugOutlined, LinkOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Collapse, Descriptions, Empty, List, Space, Spin, Tag, Timeline, Typography } from "antd";
import { useEffect, useState } from "react";
import type { FailureRunKind, FailureTriageRecord } from "./types";

const { Text, Paragraph } = Typography;

const statusMeta = {
  located: { label: "已有直接定位证据", color: "green" },
  suspected: { label: "候选定位", color: "orange" },
  insufficient_evidence: { label: "证据不足", color: "default" },
} as const;

const layerLabels: Record<FailureTriageRecord["result"]["failure_layer"], string> = {
  test_script: "测试脚本", frontend: "前端", gateway: "网关", backend: "后端服务", database: "数据库",
  cache: "缓存", message_queue: "消息队列", third_party: "第三方依赖", environment: "测试环境", unknown: "尚未确定",
};

export default function ExecutionDiagnosis({ runKind, runId }: { runKind: FailureRunKind; runId: string }) {
  const [record, setRecord] = useState<FailureTriageRecord>();
  const [traceUrl, setTraceUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/failure-triages", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("智能诊断记录加载失败");
        return await response.json() as FailureTriageRecord[];
      })
      .then((records) => {
        if (!active) return;
        setRecord(records.find((item) => item.input.runKind === runKind && item.input.runId === runId));
        setTraceUrl("");
        setError("");
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "智能诊断记录加载失败"); });
    return () => { active = false; };
  }, [runId, runKind]);

  async function diagnose() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/failure-triages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runKind, runId }),
      });
      const body = await response.json() as { record?: FailureTriageRecord; traceUrl?: string; error?: string };
      if (!response.ok || !body.record) throw new Error(body.error ?? `智能诊断失败（HTTP ${response.status}）`);
      setRecord(body.record);
      setTraceUrl(body.traceUrl ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "智能诊断失败");
    } finally {
      setLoading(false);
    }
  }

  return <Card className="execution-diagnosis" title={<Space><BugOutlined />失败智能诊断</Space>} extra={<Button type="primary" loading={loading} onClick={() => void diagnose()}>{record ? "重新诊断" : "开始诊断"}</Button>}>
    <Alert type="info" showIcon message="自动承接本次执行上下文" description="预期结果来自 Approved TestCase，实际结果来自失败断言、HTTP 响应、Runner 与 Trace；无需重复填写缺陷现象。调用链、日志、数据库、中间件和源码将在对应证据源接入后按需查询。" />
    {error && <Alert className="engineering-task-error" type="error" showIcon message="智能诊断已停止" description={error} />}
    {loading ? <div className="centered-state"><Spin tip="正在核对用例、断言和执行证据…" /></div>
      : record ? <DiagnosisResult record={record} traceUrl={traceUrl} />
        : <Empty description="本次失败尚未诊断" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
  </Card>;
}

function DiagnosisResult({ record, traceUrl }: { record: FailureTriageRecord; traceUrl: string }) {
  const result = record.result;
  const meta = statusMeta[result.status];
  const evidence = new Map(record.evidence.map((item) => [item.id, item]));
  return <Space direction="vertical" size={12} className="engineering-main-stack">
    <Card size="small" title="诊断结论" extra={<Space><Tag color={meta.color}>{meta.label}</Tag><Tag>{layerLabels[result.failure_layer]}</Tag></Space>}>
      <Paragraph>{result.summary}</Paragraph>
      {result.suspected_components.length > 0 && <Space wrap>{result.suspected_components.map((item) => <Tag color="blue" key={item}>{item}</Tag>)}</Space>}
      {traceUrl && <div className="triage-trace"><a href={traceUrl} target="_blank" rel="noreferrer"><LinkOutlined /> 查看 Phoenix Agent Trace</a></div>}
    </Card>
    <Collapse items={[
      { key: "reasoning", label: `事实与候选原因（${result.facts.length} / ${result.hypotheses.length}）`, children: <><Timeline items={result.facts.map((fact) => ({ children: <><Text>{fact.statement}</Text><div>{fact.evidence_refs.map((ref) => <Tag key={ref}>{ref} · {evidence.get(ref)?.title}</Tag>)}</div></> }))} /><List size="small" dataSource={result.hypotheses} renderItem={(item) => <List.Item><List.Item.Meta title={<Space><Tag color={item.confidence === "high" ? "red" : item.confidence === "medium" ? "orange" : "default"}>{item.confidence}</Tag>{item.cause}</Space>} description={`支持证据：${item.supporting_evidence_refs.join("、")}`} /></List.Item>} /></> },
      { key: "next", label: "缺失证据与下一步调查", children: <><Alert showIcon type={result.missing_evidence.length ? "warning" : "success"} message={result.missing_evidence.length ? "仍缺少证据" : "当前结论不缺少关键证据"} description={result.missing_evidence.length ? <ul>{result.missing_evidence.map((item) => <li key={item}>{item}</li>)}</ul> : undefined} /><List size="small" dataSource={result.next_checks} renderItem={(item, index) => <List.Item>{index + 1}. {item}</List.Item>} /></> },
      { key: "draft", label: "可提交缺陷草稿", children: <Descriptions column={1} bordered size="small" items={[
        { key: "title", label: "标题", children: result.submission_draft.title },
        { key: "severity", label: "严重程度建议", children: result.submission_draft.severity },
        { key: "steps", label: "复现步骤", children: <ol>{result.submission_draft.steps.map((step) => <li key={step}>{step}</li>)}</ol> },
        { key: "expected", label: "预期结果", children: result.submission_draft.expected },
        { key: "actual", label: "实际结果", children: result.submission_draft.actual },
        { key: "analysis", label: "技术分析", children: result.submission_draft.technical_analysis },
      ]} /> },
      { key: "evidence", label: `原始证据 ${record.evidence.length} 项`, children: <List size="small" dataSource={record.evidence} renderItem={(item) => <List.Item><List.Item.Meta title={`${item.id} · ${item.title}`} description={<><Text code>{item.locator}</Text><pre className="triage-evidence-content">{item.content}</pre></>} /></List.Item>} /> },
    ]} />
  </Space>;
}
