import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Flex,
  Input,
  List,
  Row,
  Select,
  Space,
  Statistic,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import type { PerformanceTestRunRecord, RepositoryInspection } from "./types";

const { Text } = Typography;

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T | { error?: string };
  if (!response.ok) throw new Error((body as { error?: string }).error || `请求失败（HTTP ${response.status}）`);
  return body as T;
}

function outputBlock(value: string) {
  return value ? <pre className="engineering-output">{value}</pre> : <Empty description="无终端输出" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
}

function RunResult({ run }: { run: PerformanceTestRunRecord }) {
  const color = run.status === "passed" ? "success" : run.status === "failed" ? "error" : "warning";
  const label = run.status === "passed" ? "通过" : run.status === "failed" ? "阈值失败" : run.status === "error" ? "运行错误" : "运行中";
  return (
    <Card className="engineering-result-card">
      <Flex justify="space-between" align="flex-start" gap={12} wrap>
        <div>
          <Space wrap><Tag color={color}>{label}</Tag><Text strong>{run.scriptFile}</Text></Space>
          <div><Text type="secondary">{run.repoPath}</Text></div>
        </div>
        <Space wrap><Tag>k6 {run.k6Version}</Tag><Tag>退出码 {run.exitCode ?? "-"}</Tag></Space>
      </Flex>
      {run.error && <Alert className="engineering-task-error" type="error" showIcon message={run.error} />}
      <Row gutter={[12, 12]} className="engineering-metrics">
        <Col xs={12} md={6}><Statistic title="HTTP 请求" value={run.httpRequests} /></Col>
        <Col xs={12} md={6}><Statistic title="请求失败率" value={run.requestFailedRate * 100} precision={2} suffix="%" /></Col>
        <Col xs={12} md={6}><Statistic title="迭代" value={run.iterations} /></Col>
        <Col xs={12} md={6}><Statistic title="P95 响应" value={run.durationP95Ms} precision={2} suffix="ms" /></Col>
      </Row>
      <Tabs items={[
        {
          key: "summary",
          label: "TestRun",
          children: (
            <Row gutter={[12, 12]}>
              <Col xs={12} md={6}><Statistic title="平均响应" value={run.durationAvgMs} precision={2} suffix="ms" /></Col>
              <Col xs={12} md={6}><Statistic title="P90 响应" value={run.durationP90Ms} precision={2} suffix="ms" /></Col>
              <Col xs={12} md={6}><Statistic title="最大响应" value={run.durationMaxMs} precision={2} suffix="ms" /></Col>
              <Col xs={12} md={6}><Statistic title="检查" value={run.checksPassed} suffix={`/ ${run.checksPassed + run.checksFailed}`} /></Col>
            </Row>
          ),
        },
        {
          key: "thresholds",
          label: `阈值 ${run.thresholds.length}`,
          children: run.thresholds.length ? (
            <List size="small" dataSource={run.thresholds} renderItem={(item) => (
              <List.Item>
                <Space>
                  {item.failed ? <CloseCircleOutlined className="ui-test-fail" /> : <CheckCircleOutlined className="ui-test-pass" />}
                  <Text strong>{item.metric}</Text><Text code>{item.expression}</Text>
                  <Tag color={item.failed ? "error" : "success"}>{item.failed ? "未达标" : "达标"}</Tag>
                </Space>
              </List.Item>
            )} />
          ) : <Empty description="脚本未定义 threshold" />,
        },
        { key: "output", label: "终端输出", children: outputBlock(run.runnerOutput) },
        {
          key: "evidence",
          label: `证据 ${run.artifacts.length}`,
          children: run.artifacts.length ? (
            <List dataSource={run.artifacts} renderItem={(artifact) => (
              <List.Item>
                <Space>
                  <FileTextOutlined />
                  <a href={`/api/p04/performance-runs/${run.id}/artifacts/${artifact.id}`}>
                    {artifact.kind === "summary" ? "结构化 summary" : "终端输出"} · {artifact.name}
                  </a>
                </Space>
              </List.Item>
            )} />
          ) : <Empty description="本次尚无证据" />,
        },
      ]} />
    </Card>
  );
}

export default function PerformanceTesting() {
  const { message } = AntdApp.useApp();
  const [repoPath, setRepoPath] = useState("D:\\TestHome\\TestMeshK6Demo");
  const [inspection, setInspection] = useState<RepositoryInspection>();
  const [scriptFile, setScriptFile] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [runs, setRuns] = useState<PerformanceTestRunRecord[]>([]);
  const [loadingRepo, setLoadingRepo] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();

  const scriptFiles = useMemo(
    () => inspection?.files.filter((file) => /\.js$/i.test(file)) ?? [],
    [inspection],
  );

  useEffect(() => {
    void fetch("/api/p04/performance-runs")
      .then((response) => readJson<PerformanceTestRunRecord[]>(response))
      .then(setRuns)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "性能 TestRun 加载失败"));
  }, []);

  async function inspectRepo() {
    setLoadingRepo(true);
    setError(undefined);
    try {
      const result = await readJson<RepositoryInspection>(await fetch("/api/p03/repository/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoPath }),
      }));
      setInspection(result);
      setRepoPath(result.repoPath);
      const scripts = result.files.filter((file) => /\.js$/i.test(file));
      setScriptFile(scripts.length === 1 ? scripts[0] : "");
      message.success("已读取 k6 测试仓库");
    } catch (caught) {
      setInspection(undefined);
      setError(caught instanceof Error ? caught.message : "仓库读取失败");
    } finally {
      setLoadingRepo(false);
    }
  }

  async function runTest() {
    setRunning(true);
    setError(undefined);
    try {
      const run = await readJson<PerformanceTestRunRecord>(await fetch("/api/p04/performance-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoPath, scriptFile, authorized }),
      }));
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setAuthorized(false);
      message.success(run.status === "passed" ? "性能测试通过" : "性能测试已完成");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "k6 性能测试未启动");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="engineering-page">
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={9}>
          <Card title={<Space><FolderOpenOutlined />k6 测试项目</Space>}>
            <Space direction="vertical" size={12} className="engineering-main-stack">
              <Text strong>Git 仓库根目录</Text>
              <Input value={repoPath} onChange={(event) => setRepoPath(event.target.value)} disabled={running} />
              <Button icon={<FolderOpenOutlined />} loading={loadingRepo} onClick={() => void inspectRepo()} disabled={running}>读取仓库</Button>
              {inspection && <Alert type="success" showIcon message={`${inspection.branch} · ${scriptFiles.length} 个 JavaScript 文件`} />}
              <Text strong>k6 脚本</Text>
              <Select showSearch value={scriptFile || undefined} onChange={setScriptFile} options={scriptFiles.map((file) => ({ label: file, value: file }))} placeholder="选择一个 .js 脚本" disabled={!inspection || running} optionFilterProp="label" />
              <Alert type="info" showIcon message="负载与阈值由脚本定义" description="TestMesh 不生成、修改或下载脚本；不覆盖 VU、duration、scenario 或 threshold。" />
            </Space>
          </Card>
        </Col>
        <Col xs={24} xl={15}>
          <Space direction="vertical" size={16} className="engineering-main-stack">
            <Card title={<Space><SafetyCertificateOutlined />授权宿主机执行</Space>}>
              <Space direction="vertical" size={12} className="engineering-main-stack">
                <Checkbox checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} disabled={running}>
                  我明确授权 TestMesh 以当前 Windows 用户权限，在宿主机执行所选本地 k6 脚本。
                </Checkbox>
                <Button type="primary" icon={<PlayCircleOutlined />} loading={running} disabled={!inspection || !scriptFile || !authorized || running} onClick={() => void runTest()}>
                  运行性能测试
                </Button>
                <Text type="secondary"><ThunderboltOutlined /> k6 2.2.0 · 单进程 · zero retry · summary JSON 唯一结果源</Text>
              </Space>
            </Card>
            {error && <Alert type="error" showIcon message="P04-C 已停在失败点" description={error} />}
            {runs.length ? <RunResult run={runs[0]} /> : <Card><Empty description="尚无性能 TestRun" /></Card>}
          </Space>
        </Col>
      </Row>
    </div>
  );
}
