import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExperimentOutlined,
  FolderOpenOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
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
import type { RepositoryInspection, UiTestRunRecord } from "./types";

const { Text } = Typography;

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T | { error?: string };
  if (!response.ok) {
    throw new Error((body as { error?: string }).error || `请求失败（HTTP ${response.status}）`);
  }
  return body as T;
}

function outputBlock(value: string, empty: string) {
  return value ? <pre className="engineering-output">{value}</pre> : <Empty description={empty} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
}

function RunResult({ run }: { run: UiTestRunRecord }) {
  const color = run.status === "passed" ? "success" : run.status === "failed" ? "error" : "warning";
  const label = run.status === "passed" ? "通过" : run.status === "failed" ? "测试失败" : run.status === "error" ? "运行错误" : "运行中";
  return (
    <Card className="engineering-result-card">
      <Flex justify="space-between" align="flex-start" gap={12} wrap>
        <div>
          <Space wrap><Tag color={color}>{label}</Tag><Text strong>{run.testFile}</Text></Space>
          <div><Text type="secondary">{run.repoPath}</Text></div>
        </div>
        <Space wrap><Tag>Playwright {run.playwrightVersion}</Tag><Tag>Chromium</Tag></Space>
      </Flex>
      {run.error && <Alert className="engineering-task-error" type="error" showIcon message={run.error} />}
      <Row gutter={[12, 12]} className="engineering-metrics">
        <Col xs={12} md={6}><Statistic title="通过" value={run.passed} /></Col>
        <Col xs={12} md={6}><Statistic title="失败" value={run.failed} /></Col>
        <Col xs={12} md={6}><Statistic title="跳过" value={run.skipped} /></Col>
        <Col xs={12} md={6}><Statistic title="Trace Evidence" value={run.artifacts.length} /></Col>
      </Row>
      <Tabs items={[
        {
          key: "results",
          label: `TestRun ${run.results.length}`,
          children: run.results.length ? (
            <List
              size="small"
              dataSource={run.results}
              renderItem={(item) => (
                <List.Item>
                  <Space align="start">
                    {item.status === "passed" ? <CheckCircleOutlined className="ui-test-pass" /> : <CloseCircleOutlined className="ui-test-fail" />}
                    <div>
                      <Text strong>{item.title}</Text>
                      <div><Text type="secondary">{item.projectName} · {item.durationMs.toFixed(0)} ms · {item.status}</Text></div>
                      {item.error && <pre className="engineering-event-output">{item.error}</pre>}
                    </div>
                  </Space>
                </List.Item>
              )}
            />
          ) : <Empty description="无可用 JSON Reporter 结果" />,
        },
        { key: "output", label: "运行输出", children: outputBlock(run.runnerOutput, "无运行输出") },
        {
          key: "evidence",
          label: `Trace Evidence ${run.artifacts.length}`,
          children: run.artifacts.length ? (
            <List
              dataSource={run.artifacts}
              renderItem={(artifact) => (
                <List.Item>
                  <a href={`/api/p04/ui-runs/${run.id}/artifacts/${artifact.id}`}>{artifact.name}</a>
                </List.Item>
              )}
            />
          ) : <Empty description="本次没有失败 Trace" />,
        },
      ]} />
    </Card>
  );
}

export default function UiTesting() {
  const { message } = AntdApp.useApp();
  const [repoPath, setRepoPath] = useState("D:\\TestHome\\TestMeshPlaywrightDemo");
  const [inspection, setInspection] = useState<RepositoryInspection>();
  const [testFile, setTestFile] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [runs, setRuns] = useState<UiTestRunRecord[]>([]);
  const [loadingRepo, setLoadingRepo] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();

  const testFiles = useMemo(
    () => inspection?.files.filter((file) => /\.(spec|test)\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file)) ?? [],
    [inspection],
  );

  useEffect(() => {
    void fetch("/api/p04/ui-runs")
      .then((response) => readJson<UiTestRunRecord[]>(response))
      .then(setRuns)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "UI TestRun 加载失败"));
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
      setTestFile("");
      message.success("已读取 Playwright 项目");
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
      const run = await readJson<UiTestRunRecord>(await fetch("/api/p04/ui-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoPath, testFile, authorized }),
      }));
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      setAuthorized(false);
      message.success(run.status === "passed" ? "Playwright UI 测试通过" : "Playwright UI 测试已完成");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Playwright UI 测试未启动");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="engineering-page">
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={9}>
          <Card title={<Space><FolderOpenOutlined />Playwright 项目</Space>}>
            <Space direction="vertical" size={12} className="engineering-main-stack">
              <Text strong>Git 仓库根目录</Text>
              <Input value={repoPath} onChange={(event) => setRepoPath(event.target.value)} disabled={running} />
              <Button icon={<FolderOpenOutlined />} loading={loadingRepo} onClick={() => void inspectRepo()} disabled={running}>读取仓库</Button>
              {inspection && <Alert type="success" showIcon message={`${inspection.branch} · ${testFiles.length} 个 Playwright 测试文件`} />}
              <Text strong>Playwright 测试文件</Text>
              <Select
                showSearch
                value={testFile || undefined}
                onChange={setTestFile}
                options={testFiles.map((file) => ({ label: file, value: file }))}
                placeholder="选择一个 spec/test 文件"
                disabled={!inspection || running}
                optionFilterProp="label"
              />
              <Alert
                type="info"
                showIcon
                message="目标项目负责 baseURL、认证、Header 和 fixture"
                description="TestMesh 不修改项目代码、依赖或配置。"
              />
            </Space>
          </Card>
        </Col>
        <Col xs={24} xl={15}>
          <Space direction="vertical" size={16} className="engineering-main-stack">
            <Card title={<Space><SafetyCertificateOutlined />授权容器执行</Space>}>
              <Space direction="vertical" size={12} className="engineering-main-stack">
                <Checkbox checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} disabled={running}>
                  我明确授权 TestMesh 在一次性 Playwright Docker 容器中执行所选测试代码。
                </Checkbox>
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  loading={running}
                  disabled={!inspection || !testFile || !authorized || running}
                  onClick={() => void runTest()}
                >
                  运行 UI 测试
                </Button>
                <Text type="secondary"><ExperimentOutlined /> Playwright 1.62.1 · Chromium · single worker · retries 0</Text>
              </Space>
            </Card>
            {error && <Alert type="error" showIcon message="P04-A 已停在失败点" description={error} />}
            {runs.length ? <RunResult run={runs[0]} /> : <Card><Empty description="尚无 UI TestRun" /></Card>}
          </Space>
        </Col>
      </Row>
    </div>
  );
}
