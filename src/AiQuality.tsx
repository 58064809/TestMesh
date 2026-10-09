import {
  CheckCircleOutlined,
  ExperimentOutlined,
  LinkOutlined,
  SafetyCertificateOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Empty,
  Form,
  Input,
  Modal,
  Progress,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from "antd";
import { useCallback, useEffect, useState } from "react";

const { Paragraph, Text } = Typography;

interface QualityProfile {
  id: string;
  name: string;
  version: string;
  status: "pending" | "approved" | "retired";
  targetName: string;
  targetVersion: string;
  environment: string;
  sourceAnalysisId: string;
  sourceFilename: string;
  sourceSha256: string;
  criteria: {
    minimumOpenQuestions: number;
    requiredIssueTypes: string[];
    requiredTopicGroups: string[][];
    maximumAgentLatencyMs: number;
    maximumTotalTokens: number;
  };
  phoenix: { projectName: string; datasetId: string; experimentId: string; traceId: string };
  phoenixLinks: { home: string; datasets: string; projects: string };
  readiness: { ready: boolean; totalOpenQuestions: number; reviewedOpenQuestions: number; blockers: string[] };
  approvedBy: string;
  approvalNote: string;
  approvedAt: string | null;
}

interface ApprovalValues {
  approvedBy: string;
  approvalNote: string;
}

function statusTag(profile: QualityProfile) {
  if (profile.status === "approved") return <Tag color="green" icon={<CheckCircleOutlined />}>已批准</Tag>;
  if (profile.status === "retired") return <Tag>已停用</Tag>;
  return <Tag color="orange" icon={<WarningOutlined />}>待人工批准</Tag>;
}

export default function AiQuality() {
  const [profiles, setProfiles] = useState<QualityProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [approving, setApproving] = useState<QualityProfile>();
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<ApprovalValues>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch("/api/ai-quality/profiles");
      const body = await response.json() as QualityProfile[] | { error?: string };
      if (!response.ok) throw new Error(!Array.isArray(body) && body.error ? body.error : "读取评测配置失败");
      setProfiles(body as QualityProfile[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取评测配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetch("/api/ai-quality/profiles")
      .then(async (response) => {
        const body = await response.json() as QualityProfile[] | { error?: string };
        if (!response.ok) throw new Error(!Array.isArray(body) && body.error ? body.error : "读取评测配置失败");
        setProfiles(body as QualityProfile[]);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "读取评测配置失败"))
      .finally(() => setLoading(false));
  }, []);

  async function approve(values: ApprovalValues) {
    if (!approving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/ai-quality/profiles/${encodeURIComponent(approving.id)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await response.json() as QualityProfile | { error?: string };
      if (!response.ok) throw new Error("error" in body && body.error ? body.error : "批准失败");
      message.success("评测配置已批准并冻结版本");
      setApproving(undefined);
      form.resetFields();
      await load();
    } catch (caught) {
      message.error(caught instanceof Error ? caught.message : "批准失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="centered-state"><Spin tip="正在读取 AI 质量评测配置" /></div>;

  return (
    <div className="quality-page">
      {error && <Alert type="error" showIcon message="AI 质量评估暂不可用" description={error} />}
      {!error && profiles.length === 0 && <Empty description="尚未建立评测配置" />}
      {profiles.map((profile) => {
        const progress = profile.readiness.totalOpenQuestions
          ? Math.round(profile.readiness.reviewedOpenQuestions / profile.readiness.totalOpenQuestions * 100)
          : 0;
        return (
          <Card
            key={profile.id}
            title={<Space><ExperimentOutlined />{profile.name}{statusTag(profile)}</Space>}
            extra={profile.status === "pending" && (
              <Button type="primary" disabled={!profile.readiness.ready} onClick={() => setApproving(profile)}>
                人工批准
              </Button>
            )}
          >
            <Alert
              type={profile.readiness.ready ? "success" : "warning"}
              showIcon
              message={profile.readiness.ready ? "验收问题集已完成评审，可以批准此版本" : "尚不能批准此评测版本"}
              description={profile.readiness.blockers.join("；") || "批准后配置将作为后续 Agent 版本回归比较的固定基准。"}
            />

            <Row gutter={[16, 16]} className="quality-grid">
              <Col xs={24} xl={12}>
                <Card size="small" title="评测对象与来源">
                  <Descriptions size="small" column={1}>
                    <Descriptions.Item label="目标">{profile.targetName}</Descriptions.Item>
                    <Descriptions.Item label="目标版本">{profile.targetVersion}</Descriptions.Item>
                    <Descriptions.Item label="环境">{profile.environment}</Descriptions.Item>
                    <Descriptions.Item label="配置版本">{profile.version}</Descriptions.Item>
                    <Descriptions.Item label="真实需求">{profile.sourceFilename}</Descriptions.Item>
                    <Descriptions.Item label="Analysis ID"><Text code copyable>{profile.sourceAnalysisId}</Text></Descriptions.Item>
                    <Descriptions.Item label="文件 SHA-256"><Text code copyable ellipsis>{profile.sourceSha256}</Text></Descriptions.Item>
                  </Descriptions>
                </Card>
              </Col>
              <Col xs={24} xl={12}>
                <Card size="small" title="人工确认进度">
                  <Progress percent={progress} status={profile.readiness.ready ? "success" : "active"} />
                  <Paragraph type="secondary">
                    已评审 {profile.readiness.reviewedOpenQuestions} / {profile.readiness.totalOpenQuestions} 条待确认问题。
                    TestMesh 只负责业务准入与人工决策，不替代 Phoenix 的实验和评测能力。
                  </Paragraph>
                  {profile.status === "approved" && (
                    <Descriptions size="small" column={1}>
                      <Descriptions.Item label="批准人">{profile.approvedBy}</Descriptions.Item>
                      <Descriptions.Item label="批准时间">{profile.approvedAt ? new Date(profile.approvedAt).toLocaleString("zh-CN") : "-"}</Descriptions.Item>
                      <Descriptions.Item label="说明">{profile.approvalNote || "无"}</Descriptions.Item>
                    </Descriptions>
                  )}
                </Card>
              </Col>
            </Row>

            <Divider orientation="left">准入标准</Divider>
            <Space size={[8, 8]} wrap>
              <Tag color="blue">待确认问题 ≥ {profile.criteria.minimumOpenQuestions}</Tag>
              <Tag color="blue">问题类型：{profile.criteria.requiredIssueTypes.join(" / ")}</Tag>
              <Tag color="blue">延迟 ≤ {Math.round(profile.criteria.maximumAgentLatencyMs / 1000)} 秒</Tag>
              <Tag color="blue">Token ≤ {profile.criteria.maximumTotalTokens.toLocaleString()}</Tag>
              {profile.criteria.requiredTopicGroups.map((group) => <Tag key={group.join("-")}>主题：{group.join(" / ")}</Tag>)}
            </Space>

            <Divider orientation="left">Phoenix 评测证据</Divider>
            <Descriptions size="small" column={{ xs: 1, lg: 2 }}>
              <Descriptions.Item label="Project">{profile.phoenix.projectName}</Descriptions.Item>
              <Descriptions.Item label="Dataset ID"><Text code copyable>{profile.phoenix.datasetId}</Text></Descriptions.Item>
              <Descriptions.Item label="Experiment ID"><Text code copyable>{profile.phoenix.experimentId}</Text></Descriptions.Item>
              <Descriptions.Item label="Trace ID"><Text code copyable>{profile.phoenix.traceId}</Text></Descriptions.Item>
            </Descriptions>
            <Space wrap>
              <Button icon={<LinkOutlined />} href={profile.phoenixLinks.datasets} target="_blank">打开 Phoenix Datasets</Button>
              <Button icon={<LinkOutlined />} href={profile.phoenixLinks.projects} target="_blank">打开 Phoenix Traces</Button>
            </Space>
          </Card>
        );
      })}

      <Modal
        title={<Space><SafetyCertificateOutlined />批准 AI 质量评测配置</Space>}
        open={Boolean(approving)}
        onCancel={() => { setApproving(undefined); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText="确认批准"
      >
        <Alert type="info" showIcon message="批准会冻结当前版本；后续调整需创建新版本，历史证据不会被覆盖。" />
        <Form form={form} layout="vertical" onFinish={(values) => void approve(values)} className="approval-form">
          <Form.Item label="批准人" name="approvedBy" required rules={[{ required: true, whitespace: true, message: "请填写批准人姓名" }]}>
            <Input placeholder="例如：测试负责人张三" />
          </Form.Item>
          <Form.Item label="批准说明" name="approvalNote" extra="可记录评审会议、适用范围或已接受的风险。">
            <Input.TextArea rows={3} placeholder="选填" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
