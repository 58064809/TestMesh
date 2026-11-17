import { CheckCircleOutlined, PartitionOutlined } from "@ant-design/icons";
import { Alert, App as AntdApp, Button, Card, Collapse, Descriptions, Empty, Flex, Input, Space, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApprovedTestConditionVersion, TestConditionSetRecord } from "./types";

const { Paragraph, Text } = Typography;

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `请求失败（HTTP ${response.status}）`);
  return payload;
}

export default function TestConditions({ baselineId, approvedTestModelVersionId, value, onChange }: {
  baselineId: string;
  approvedTestModelVersionId?: string;
  value?: string;
  onChange?: (approvedVersionId?: string) => void;
}) {
  const { message } = AntdApp.useApp();
  const [sets, setSets] = useState<TestConditionSetRecord[]>([]);
  const [versions, setVersions] = useState<ApprovedTestConditionVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [approvedBy, setApprovedBy] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!baselineId) return;
    const [setRows, versionRows] = await Promise.all([
      readJson<TestConditionSetRecord[]>(await fetch(`/api/test-conditions?baselineId=${encodeURIComponent(baselineId)}`, { cache: "no-store" })),
      readJson<ApprovedTestConditionVersion[]>(await fetch(`/api/test-conditions/approved-versions?baselineId=${encodeURIComponent(baselineId)}`, { cache: "no-store" })),
    ]);
    setSets(setRows);
    setVersions(versionRows);
    const matching = versionRows.find((item) => item.record.approvedTestModelVersionId === approvedTestModelVersionId);
    onChange?.(matching?.record.id);
  }, [approvedTestModelVersionId, baselineId, onChange]);

  useEffect(() => { void Promise.resolve().then(refresh).catch((cause) => setError(cause instanceof Error ? cause.message : "测试条件读取失败")); }, [refresh]);

  const current = useMemo(() => sets.find((item) => item.approvedTestModelVersionId === approvedTestModelVersionId), [approvedTestModelVersionId, sets]);
  const approved = versions.find((item) => item.record.id === value);

  async function create() {
    if (!approvedTestModelVersionId) return;
    setLoading(true); setError("");
    try {
      await readJson(await fetch("/api/test-conditions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baselineId, approvedTestModelVersionId }) }));
      await refresh();
      message.success("测试条件草稿已建立");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "测试条件建立失败"); }
    finally { setLoading(false); }
  }

  async function approve() {
    if (!current || !approvedBy.trim()) return;
    setLoading(true); setError("");
    try {
      const version = await readJson<{ id: string }>(await fetch(`/api/test-conditions/${encodeURIComponent(current.id)}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approvedBy }) }));
      await refresh(); onChange?.(version.id);
      message.success("测试条件版本已批准");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "测试条件批准失败"); }
    finally { setLoading(false); }
  }

  if (!approvedTestModelVersionId) return <Empty description="请先生成并批准测试模型" />;

  return <Space direction="vertical" size={16} style={{ width: "100%" }}>
    <Alert type="info" showIcon message="测试条件是独立审批层" description="它把测试模型拆成可独立判断成功或失败的条件。此步骤不写操作步骤、不造 Dataset，也不执行应用。" />
    {error && <Alert type="error" showIcon message="测试条件步骤已停止" description={error} />}
    {!current && <Card>
      <Flex justify="space-between" align="center" gap={12} wrap>
        <div><Text strong>尚未建立测试条件</Text><Paragraph type="secondary" style={{ marginBottom: 0 }}>系统将加载独立版本化 Prompt，只读取已批准测试模型，并按固定 Schema 生成可审核条件。</Paragraph></div>
        <Button type="primary" icon={<PartitionOutlined />} loading={loading} onClick={() => void create()}>生成测试条件</Button>
      </Flex>
    </Card>}
    {current && <>
      <Card title={<Space><PartitionOutlined />测试条件 v{current.version}<Tag color={current.status === "approved" ? "green" : "blue"}>{current.status === "approved" ? "已批准" : "待批准"}</Tag></Space>} extra={<Tag>{current.document.schemaVersion}</Tag>}>
        <Paragraph>{current.document.objective}</Paragraph>
        <Alert type="warning" showIcon message={current.document.generation.mode === "prompt" ? `Prompt ${current.document.generation.promptVersion}` : "本版本未额外加载 Prompt"} description={current.document.generation.note} style={{ marginBottom: 12 }} />
        <Collapse items={current.document.conditions.map((item) => ({
          key: item.id,
          label: <Space wrap><Text strong>{item.id} · {item.title}</Text><Tag>{item.category}</Tag><Tag color={item.ai_dimension ? "purple" : "default"}>{item.ai_dimension ?? item.technique}</Tag></Space>,
          children: <Descriptions size="small" column={1} items={[
            { key: "objective", label: "判定目标", children: item.objective },
            { key: "rationale", label: "拆分依据", children: item.rationale },
            { key: "trace", label: "主要追溯", children: item.primary_trace_ref },
            { key: "source", label: "原文证据", children: item.source_refs.join("、") },
          ]} />,
        }))} />
      </Card>
      {current.status === "draft" && <Card size="small"><Flex justify="flex-end" gap={8} wrap><Input placeholder="批准人" value={approvedBy} onChange={(event) => setApprovedBy(event.target.value)} style={{ width: 240 }} /><Button type="primary" icon={<CheckCircleOutlined />} loading={loading} disabled={!approvedBy.trim()} onClick={() => void approve()}>批准测试条件</Button></Flex></Card>}
      {approved && <Alert type="success" showIcon message={`Approved TestCondition v${approved.record.version} 已就绪`} description={`批准人：${approved.record.approvedBy}；后续 TestCase 只能引用这一冻结版本。`} />}
    </>}
  </Space>;
}
