import { DatabaseOutlined, ExportOutlined, LinkOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Input, List, Select, Space, Tag, Typography, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { ApprovedTestCaseVersionOption } from "./types";

const { Text } = Typography;

interface DatasetPreview {
  approvedTestCaseVersionId: string;
  approvedVersion: number;
  datasetName: string;
  contentSha256: string;
  exampleCount: number;
  aiDimensions: string[];
  evaluatorNames: string[];
  dataClass: "test-plan-manifest";
}

interface DatasetExport {
  id: string;
  approvedTestCaseVersionId: string;
  datasetName: string;
  datasetId: string;
  datasetVersionId: string;
  contentSha256: string;
  exampleCount: number;
  aiDimensions: string[];
  dataClass: "test-plan-manifest" | "evaluation-dataset";
  exportedBy: string;
  createdAt: string;
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `请求失败（HTTP ${response.status}）`);
  return body;
}

async function getJson<T>(url: string): Promise<T> {
  return json<T>(await fetch(url, { cache: "no-store" }));
}

export default function AiDatasetExports() {
  const [versions, setVersions] = useState<ApprovedTestCaseVersionOption[]>([]);
  const [exports, setExports] = useState<DatasetExport[]>([]);
  const [versionId, setVersionId] = useState("");
  const [preview, setPreview] = useState<DatasetPreview>();
  const [operator, setOperator] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const aiVersions = useMemo(
    () => versions.filter((version) => version.testCases.some((testCase) => Boolean(testCase.ai_evaluation))),
    [versions],
  );

  async function refreshExports() {
    setExports(await json<DatasetExport[]>(await fetch("/api/ai-quality/dataset-exports", { cache: "no-store" })));
  }

  useEffect(() => {
    void Promise.all([
      getJson<ApprovedTestCaseVersionOption[]>("/api/api-automation/approved-versions"),
      getJson<DatasetExport[]>("/api/ai-quality/dataset-exports"),
    ]).then(([approvedVersions, datasetExports]) => {
      setVersions(approvedVersions);
      setExports(datasetExports);
      const first = approvedVersions.find((version) => version.testCases.some((testCase) => Boolean(testCase.ai_evaluation)));
      setVersionId(first?.id ?? "");
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Dataset 映射加载失败"));
  }, []);

  useEffect(() => {
    if (!versionId) return;
    void getJson<DatasetPreview>(`/api/ai-quality/dataset-exports/preview/${encodeURIComponent(versionId)}`)
      .then(setPreview)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Dataset 预览失败"));
  }, [versionId]);

  async function exportDataset() {
    if (!versionId || !operator.trim()) { message.warning("请选择 Approved TestCase 版本并填写操作人"); return; }
    setBusy(true); setError("");
    try {
      const saved = await json<DatasetExport>(await fetch("/api/ai-quality/dataset-exports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvedTestCaseVersionId: versionId, exportedBy: operator.trim() }),
      }));
      await refreshExports();
      message.success(`Phoenix Dataset Version 已关联：${saved.datasetVersionId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Phoenix Dataset 导出失败");
    } finally { setBusy(false); }
  }

  return <Card className="ai-dataset-card" title={<Space><DatabaseOutlined />Approved AI TestCase → Phoenix Dataset</Space>}>
    <Space direction="vertical" size={14} style={{ width: "100%" }}>
      <Alert type="info" showIcon message="AIAT02 同步的是冻结评测计划清单，不是可执行语料集" description="每条记录描述 AI TestCase、Oracle、阈值和样本要求。真实 Experiment 还需要把这些要求展开为包含实际输入、期望、标签和会话状态的 evaluation-dataset；计划清单禁止直接作为目标 Agent 的通过证据。" />
      {error && <Alert type="error" showIcon message="Dataset 操作未完成" description={error} />}
      <Space wrap>
        <Select style={{ minWidth: 280 }} value={versionId || undefined} onChange={(value) => { setPreview(undefined); setVersionId(value); }} placeholder="选择包含 AI 用例的 Approved 版本" options={aiVersions.map((version) => ({ value: version.id, label: `Approved v${version.version} · ${version.testCases.filter((item) => item.ai_evaluation).length} 条 AI 用例` }))} />
        <Input style={{ width: 180 }} value={operator} onChange={(event) => setOperator(event.target.value)} placeholder="操作人 *" />
        <Button type="primary" icon={<ExportOutlined />} loading={busy} disabled={!preview} onClick={() => void exportDataset()}>同步到 Phoenix</Button>
      </Space>
      {preview && <Descriptions size="small" column={{ xs: 1, lg: 3 }} bordered>
        <Descriptions.Item label="Dataset 名称">{preview.datasetName}</Descriptions.Item>
        <Descriptions.Item label="样本数">{preview.exampleCount}</Descriptions.Item>
        <Descriptions.Item label="内容哈希"><Text code copyable>{preview.contentSha256.slice(0, 16)}…</Text></Descriptions.Item>
        <Descriptions.Item label="数据类别" span={3}><Tag color="orange">{preview.dataClass}</Tag></Descriptions.Item>
        <Descriptions.Item label="AI 维度" span={3}><Space wrap>{preview.aiDimensions.map((item) => <Tag key={item}>{item}</Tag>)}</Space></Descriptions.Item>
        <Descriptions.Item label="Evaluator 要求" span={3}>{preview.evaluatorNames.join("、")}</Descriptions.Item>
      </Descriptions>}
      <List size="small" header="已归档 Phoenix Dataset Version 映射" dataSource={exports} locale={{ emptyText: "尚未同步 Approved AI TestCase" }} renderItem={(item) => <List.Item actions={[<Button key="phoenix" type="link" icon={<LinkOutlined />} href="http://127.0.0.1:6006/datasets" target="_blank">Phoenix</Button>]}><List.Item.Meta title={`${item.datasetName} · ${item.exampleCount} 条`} description={<Space wrap><Text code>{item.datasetVersionId}</Text><Text type="secondary">{item.exportedBy} · {new Date(item.createdAt).toLocaleString("zh-CN")}</Text></Space>} /></List.Item>} />
    </Space>
  </Card>;
}
