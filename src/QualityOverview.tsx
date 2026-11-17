import { DownloadOutlined, FileDoneOutlined, SafetyCertificateOutlined, WarningOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Empty, Flex, List, Row, Select, Space, Spin, Statistic, Table, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectRecord, QualityPlanRecord, QualitySnapshot } from "./types";

const { Paragraph, Text, Title } = Typography;

type QualityReportRecord = {
  id: string;
  planId: string;
  projectId: string;
  contentSha256: string;
  generatedAt: string;
};

async function json<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `请求失败（HTTP ${response.status}）`);
  return body;
}

function gateColor(status?: string): string {
  if (status === "allow") return "green";
  if (status === "review") return "orange";
  if (status === "deny") return "red";
  return "default";
}

export default function QualityOverview() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectId, setProjectId] = useState("");
  const [plans, setPlans] = useState<QualityPlanRecord[]>([]);
  const [planId, setPlanId] = useState("");
  const [snapshot, setSnapshot] = useState<QualitySnapshot>();
  const [reports, setReports] = useState<QualityReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string>();

  const currentSnapshot = snapshot?.plan.id === planId ? snapshot : undefined;
  const unavailableMetrics = useMemo(
    () => currentSnapshot?.metricCatalog.filter((metric) => metric.status === "unavailable") ?? [],
    [currentSnapshot],
  );

  const loadProjects = useCallback(async () => {
    const rows = await json<ProjectRecord[]>(await fetch("/api/projects", { cache: "no-store" }));
    setProjects(rows);
    setProjectId((current) => rows.some((item) => item.id === current) ? current : rows[0]?.id ?? "");
  }, []);

  const loadPlans = useCallback(async (selectedProjectId: string) => {
    if (!selectedProjectId) { setPlans([]); setPlanId(""); return; }
    const rows = await json<QualityPlanRecord[]>(await fetch(`/api/quality-management/plans?projectId=${encodeURIComponent(selectedProjectId)}`, { cache: "no-store" }));
    setPlans(rows);
    setPlanId((current) => rows.some((item) => item.id === current) ? current : rows[0]?.id ?? "");
  }, []);

  const loadReport = useCallback(async (selectedPlanId: string) => {
    if (!selectedPlanId) { setSnapshot(undefined); setReports([]); setLoading(false); return; }
    setLoading(true);
    try {
      const [qualitySnapshot, reportRows] = await Promise.all([
        json<QualitySnapshot>(await fetch(`/api/quality-management/plans/${encodeURIComponent(selectedPlanId)}/snapshot`, { cache: "no-store" })),
        json<QualityReportRecord[]>(await fetch(`/api/quality-management/plans/${encodeURIComponent(selectedPlanId)}/reports`, { cache: "no-store" })),
      ]);
      setSnapshot(qualitySnapshot);
      setReports(reportRows);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "质量报告读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadProjects().catch((cause) => { setError(cause instanceof Error ? cause.message : "项目读取失败"); setLoading(false); }); }, [loadProjects]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadPlans(projectId).catch((cause) => { setError(cause instanceof Error ? cause.message : "质量计划读取失败"); setLoading(false); }); }, [projectId, loadPlans]);
  // Data is loaded from the server as the selected quality plan changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadReport(planId); }, [planId, loadReport]);

  async function generateReport() {
    if (!planId) return;
    setGenerating(true);
    try {
      const response = await fetch(`/api/quality-management/plans/${encodeURIComponent(planId)}/report.md`, { cache: "no-store" });
      if (!response.ok) throw new Error(`报告生成失败（HTTP ${response.status}）`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `quality-report-${planId}.md`;
      anchor.click();
      URL.revokeObjectURL(url);
      await loadReport(planId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "报告生成失败");
    } finally {
      setGenerating(false);
    }
  }

  return <div className="quality-overview-page">
    <Flex justify="space-between" align="flex-start" gap={16} wrap>
      <div>
        <Title level={3}>项目质量报告</Title>
        <Paragraph type="secondary">面向发布决策汇总质量计划、覆盖、执行、AI 评测、缺陷与准入证据。缺少证据的指标保持“暂无数据”，不会按 0% 或达标处理。</Paragraph>
      </div>
      <Button type="primary" icon={<DownloadOutlined />} disabled={!planId} loading={generating} onClick={() => void generateReport()}>生成并归档报告</Button>
    </Flex>

    <Card size="small" className="quality-overview-selector">
      <Space wrap>
        <Text strong>项目</Text>
        <Select style={{ minWidth: 260 }} value={projectId || undefined} onChange={setProjectId} placeholder="请选择项目" options={projects.map((item) => ({ value: item.id, label: `${item.name} · ${item.code}` }))} />
        <Text strong>质量计划</Text>
        <Select style={{ minWidth: 360 }} value={planId || undefined} onChange={setPlanId} placeholder="请选择质量计划" options={plans.map((item) => ({ value: item.id, label: `${item.name} · ${item.release} · v${item.version} · ${item.status}` }))} />
      </Space>
    </Card>

    {error && <Alert type="error" showIcon closable message="质量报告加载失败" description={error} onClose={() => setError(undefined)} />}
    {loading ? <div className="centered-state"><Spin size="large" /></div> : currentSnapshot ? <>
      <Alert
        className="quality-overview-gate"
        type={!currentSnapshot.gateFresh ? "warning" : currentSnapshot.latestGate?.status === "allow" ? "success" : currentSnapshot.latestGate?.status === "review" ? "warning" : "error"}
        showIcon
        icon={currentSnapshot.latestGate?.status === "allow" ? <SafetyCertificateOutlined /> : <WarningOutlined />}
        message={currentSnapshot.latestGate ? <>发布准入：<Tag color={gateColor(currentSnapshot.latestGate.status)}>{currentSnapshot.latestGate.status}</Tag>{!currentSnapshot.gateFresh && <Tag color="orange">已过期</Tag>}</> : "尚未执行发布准入评估"}
        description={!currentSnapshot.gateFresh && currentSnapshot.latestGate
          ? "质量事实已发生变化，当前准入结论不能用于发布；请在项目质量管理中重新执行 OPA 评估。"
          : currentSnapshot.latestGate?.result.reasons.join("；") || "当前报告不能给出正式发布结论，请在项目质量管理中执行 OPA 准入评估。"}
      />

      <Row gutter={[12, 12]}>
        <Col xs={12} xl={4}><Card><Statistic title="需求覆盖率" value={currentSnapshot.metrics.requirementCoveragePct} suffix="%" /></Card></Col>
        <Col xs={12} xl={4}><Card><Statistic title="执行完整率" value={currentSnapshot.metrics.executionCompletenessPct} suffix="%" /></Card></Col>
        <Col xs={12} xl={4}><Card><Statistic title="执行通过率" value={currentSnapshot.metrics.executionPassRatePct} suffix="%" /></Card></Col>
        <Col xs={12} xl={4}><Card><Statistic title="AI 评测完整率" value={currentSnapshot.metrics.aiEvaluationCoveragePct} suffix="%" /></Card></Col>
        <Col xs={12} xl={4}><Card><Statistic title="失败测试" value={currentSnapshot.metrics.failedTests} /></Card></Col>
        <Col xs={12} xl={4}><Card><Statistic title="未关闭改进项" value={currentSnapshot.metrics.openImprovementActions} /></Card></Col>
      </Row>

      <Card title="质量指标" className="quality-overview-section" extra={<Text type="secondary">分子、分母、口径和证据均进入归档快照</Text>}>
        <Table rowKey="id" pagination={false} scroll={{ x: 1080 }} dataSource={currentSnapshot.metricCatalog} columns={[
          { title: "分类", dataIndex: "category", width: 90 },
          { title: "指标", dataIndex: "name", width: 170 },
          { title: "当前值", width: 120, render: (_, item) => item.status === "available" ? <Text strong>{item.value}{item.unit}</Text> : <Tag>暂无数据</Tag> },
          { title: "分子 / 分母", width: 120, render: (_, item) => item.status === "available" ? `${item.numerator} / ${item.denominator}` : "- / -" },
          { title: "口径或缺失原因", render: (_, item) => item.formula || item.note },
          { title: "证据来源", dataIndex: "evidence", width: 220, render: (value: string) => value || "待接入" },
        ]} />
      </Card>

      <Row gutter={[16, 16]} className="quality-overview-section">
        <Col xs={24} xl={12}>
          <Card title="证据缺口" extra={<Tag color={unavailableMetrics.length ? "orange" : "green"}>{unavailableMetrics.length} 项</Tag>}>
            {unavailableMetrics.length ? <List dataSource={unavailableMetrics} renderItem={(metric) => <List.Item><List.Item.Meta title={metric.name} description={metric.note} /></List.Item>} /> : <Empty description="当前指标均有可计算证据" />}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title="历史归档报告" extra={<Tag>{reports.length} 版</Tag>}>
            {reports.length ? <List dataSource={reports} renderItem={(report) => <List.Item actions={[<Button key="download" type="link" icon={<DownloadOutlined />} href={`/api/quality-management/reports/${encodeURIComponent(report.id)}/report.md`} target="_blank">下载</Button>]}><List.Item.Meta avatar={<FileDoneOutlined />} title={new Date(report.generatedAt).toLocaleString("zh-CN")} description={<Space direction="vertical" size={0}><Text code>{report.id}</Text><Text type="secondary">SHA-256 {report.contentSha256}</Text></Space>} /></List.Item>} /> : <Empty description="尚未生成归档报告" />}
          </Card>
        </Col>
      </Row>
    </> : <Empty description="当前项目还没有质量计划，请先在项目质量管理中创建并批准" />}
  </div>;
}
