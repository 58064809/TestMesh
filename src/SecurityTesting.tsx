import {
  BugOutlined,
  FileTextOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Empty,
  Flex,
  Input,
  List,
  Row,
  Space,
  Statistic,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import type { SecurityRisk, SecurityTestRunRecord } from "./types";

const { Paragraph, Text } = Typography;

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T | { error?: string };
  if (!response.ok) {
    throw new Error((body as { error?: string }).error || `请求失败（HTTP ${response.status}）`);
  }
  return body as T;
}

const riskMeta: Record<SecurityRisk, { label: string; color: string }> = {
  high: { label: "高危", color: "error" },
  medium: { label: "中危", color: "orange" },
  low: { label: "低危", color: "gold" },
  informational: { label: "信息", color: "blue" },
  unknown: { label: "未知", color: "default" },
};

function outputBlock(value: string) {
  return value ? (
    <pre className="engineering-output">{value}</pre>
  ) : (
    <Empty description="无终端输出" image={Empty.PRESENTED_IMAGE_SIMPLE} />
  );
}

function RunResult({ run }: { run: SecurityTestRunRecord }) {
  const completed = run.status === "completed";
  return (
    <Card className="engineering-result-card">
      <Flex justify="space-between" align="flex-start" gap={12} wrap>
        <div>
          <Space wrap>
            <Tag color={completed ? "success" : run.status === "error" ? "error" : "processing"}>
              {completed ? "扫描完成" : run.status === "error" ? "运行错误" : "运行中"}
            </Tag>
            <Text strong>{run.targetUrl}</Text>
          </Space>
          <div>
            <Text type="secondary">无认证被动基线 · Traditional Spider</Text>
          </div>
        </div>
        <Space wrap>
          <Tag>ZAP {run.zapVersion}</Tag>
          <Tag>退出码 {run.exitCode ?? "-"}</Tag>
        </Space>
      </Flex>

      {run.error && (
        <Alert className="engineering-task-error" type="error" showIcon message={run.error} />
      )}

      <Row gutter={[12, 12]} className="engineering-metrics">
        <Col xs={12} md={6}><Statistic title="高危" value={run.high} valueStyle={{ color: "#cf1322" }} /></Col>
        <Col xs={12} md={6}><Statistic title="中危" value={run.medium} valueStyle={{ color: "#d46b08" }} /></Col>
        <Col xs={12} md={6}><Statistic title="低危" value={run.low} valueStyle={{ color: "#d4b106" }} /></Col>
        <Col xs={12} md={6}><Statistic title="信息" value={run.informational} valueStyle={{ color: "#1677ff" }} /></Col>
      </Row>

      <Tabs
        items={[
          {
            key: "findings",
            label: `安全发现 ${run.totalFindings}`,
            children: run.findings.length ? (
              <List
                dataSource={run.findings}
                renderItem={(finding) => (
                  <List.Item>
                    <Card size="small" className="engineering-main-stack">
                      <Flex justify="space-between" align="flex-start" gap={8} wrap>
                        <Space wrap>
                          <Tag color={riskMeta[finding.risk].color}>{riskMeta[finding.risk].label}</Tag>
                          <Text strong>{finding.name}</Text>
                        </Space>
                        <Text type="secondary">规则 {finding.pluginId || "-"}</Text>
                      </Flex>
                      <Descriptions size="small" column={1} className="engineering-task-meta">
                        <Descriptions.Item label="URL">{finding.url || "-"}</Descriptions.Item>
                        <Descriptions.Item label="请求">
                          {[finding.method, finding.parameter].filter(Boolean).join(" · ") || "-"}
                        </Descriptions.Item>
                        <Descriptions.Item label="证据">{finding.evidence || "-"}</Descriptions.Item>
                        <Descriptions.Item label="说明">{finding.description || "-"}</Descriptions.Item>
                        <Descriptions.Item label="建议">{finding.solution || "-"}</Descriptions.Item>
                      </Descriptions>
                    </Card>
                  </List.Item>
                )}
              />
            ) : (
              <Empty description={completed ? "本次报告没有安全发现" : "尚无安全发现"} />
            ),
          },
          { key: "output", label: "终端输出", children: outputBlock(run.runnerOutput) },
          {
            key: "evidence",
            label: `证据 ${run.artifacts.length}`,
            children: run.artifacts.length ? (
              <List
                dataSource={run.artifacts}
                renderItem={(artifact) => (
                  <List.Item>
                    <Space>
                      <FileTextOutlined />
                      <a href={`/api/p04/security-runs/${run.id}/artifacts/${artifact.id}`}>
                        {artifact.kind === "report" ? "Traditional JSON 报告" : "终端输出"} · {artifact.name}
                      </a>
                    </Space>
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="本次尚无证据" />
            ),
          },
        ]}
      />
    </Card>
  );
}

export default function SecurityTesting() {
  const { message } = AntdApp.useApp();
  const [targetUrl, setTargetUrl] = useState("http://127.0.0.1:3301");
  const [authorized, setAuthorized] = useState(false);
  const [runs, setRuns] = useState<SecurityTestRunRecord[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void fetch("/api/p04/security-runs")
      .then((response) => readJson<SecurityTestRunRecord[]>(response))
      .then(setRuns)
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : "安全 TestRun 加载失败"),
      );
  }, []);

  async function runTest() {
    setRunning(true);
    setError(undefined);
    try {
      const run = await readJson<SecurityTestRunRecord>(
        await fetch("/api/p04/security-runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetUrl, authorized }),
        }),
      );
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setAuthorized(false);
      message.success(run.status === "completed" ? "安全基线扫描完成" : "安全测试已结束");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ZAP 安全测试未启动");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="engineering-page">
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={9}>
          <Card title={<Space><LinkOutlined />扫描目标</Space>}>
            <Space direction="vertical" size={12} className="engineering-main-stack">
              <Text strong>Target URL</Text>
              <Input
                value={targetUrl}
                onChange={(event) => setTargetUrl(event.target.value)}
                placeholder="http://127.0.0.1:3301"
                disabled={running}
              />
              <Alert
                type="warning"
                showIcon
                icon={<WarningOutlined />}
                message="Traditional Spider 对现代 JavaScript 应用覆盖有限"
                description="TestMesh 不会自动切换 Client/AJAX Spider。本阶段只做无认证 Traditional Spider + 被动扫描。"
              />
              <Alert
                type="info"
                showIcon
                message="本阶段不执行主动攻击"
                description="不做认证、API 导入、主动扫描、插件更新、云扫描或 Quality Gate。"
              />
            </Space>
          </Card>
        </Col>
        <Col xs={24} xl={15}>
          <Space direction="vertical" size={16} className="engineering-main-stack">
            <Card title={<Space><SafetyCertificateOutlined />扫描授权</Space>}>
              <Space direction="vertical" size={12} className="engineering-main-stack">
                <Checkbox
                  checked={authorized}
                  onChange={(event) => setAuthorized(event.target.checked)}
                  disabled={running}
                >
                  我确认有权扫描该目标，并授权本次无认证被动基线扫描。
                </Checkbox>
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  loading={running}
                  disabled={!targetUrl.trim() || !authorized || running}
                  onClick={() => void runTest()}
                >
                  运行安全基线扫描
                </Button>
                <Paragraph type="secondary">
                  <BugOutlined /> ZAP 2.17.0 · 单进程 · zero retry · Traditional JSON 唯一结果源
                </Paragraph>
              </Space>
            </Card>
            {error && <Alert type="error" showIcon message="P04-D 已停在失败点" description={error} />}
            {runs.length ? <RunResult run={runs[0]} /> : <Card><Empty description="尚无安全 TestRun" /></Card>}
          </Space>
        </Col>
      </Row>
    </div>
  );
}
