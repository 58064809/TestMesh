import {
  CodeOutlined,
  ContainerOutlined,
  FolderOpenOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
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
import TextArea from "antd/es/input/TextArea";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DockerContainerSummary,
  EngineeringTaskRecord,
  EngineeringTaskStatus,
  RepositoryInspection,
} from "./types";

const { Text } = Typography;
const RUNNING_STATUSES: EngineeringTaskStatus[] = ["queued", "starting", "running"];

const statusMeta: Record<EngineeringTaskStatus, { label: string; color: string }> = {
  queued: { label: "排队中", color: "default" },
  starting: { label: "启动容器", color: "processing" },
  running: { label: "执行中", color: "processing" },
  completed: { label: "已完成", color: "success" },
  failed: { label: "失败", color: "error" },
  stopped: { label: "已停止", color: "warning" },
};

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T | { error?: string };
  if (!response.ok) {
    throw new Error("error" in (body as object) && (body as { error?: string }).error
      ? (body as { error: string }).error
      : `请求失败（HTTP ${response.status}）`);
  }
  return body as T;
}

function outputBlock(value: string, empty: string) {
  return value ? <pre className="engineering-output">{value}</pre> : <Empty description={empty} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
}

function TaskResult({ task }: { task: EngineeringTaskRecord }) {
  const terminalEvents = task.events.filter((event) => event.terminalOutput);
  return (
    <Card className="engineering-result-card">
      <Flex justify="space-between" align="flex-start" gap={12} wrap>
        <div>
          <Space wrap>
            <Tag color={statusMeta[task.status].color}>{statusMeta[task.status].label}</Tag>
            <Text strong>{task.instruction}</Text>
          </Space>
          <div><Text type="secondary">{task.repoPath}</Text></div>
        </div>
        <Space>
          <Tag>{task.model}</Tag>
          {task.cost !== null && <Tag color="blue">${task.cost.toFixed(4)}</Tag>}
        </Space>
      </Flex>

      {task.error && <Alert className="engineering-task-error" type="error" showIcon message={task.error} />}

      <Row gutter={[12, 12]} className="engineering-metrics">
        <Col xs={12} md={6}><Statistic title="Agent Events" value={task.events.length} /></Col>
        <Col xs={12} md={6}><Statistic title="Terminal Events" value={terminalEvents.length} /></Col>
        <Col xs={12} md={6}><Statistic title="选择代码" value={task.selectedFiles.length} /></Col>
        <Col xs={12} md={6}><Statistic title="费用（USD）" value={task.cost ?? 0} precision={4} /></Col>
      </Row>

      <Tabs
        items={[
          {
            key: "result",
            label: "最终结论",
            children: outputBlock(task.finalResponse, RUNNING_STATUSES.includes(task.status) ? "Agent 正在执行" : "没有最终结论"),
          },
          {
            key: "terminal",
            label: `终端输出 ${terminalEvents.length}`,
            children: outputBlock(task.terminalOutput, "暂无终端输出"),
          },
          {
            key: "diff",
            label: "Git Diff",
            children: outputBlock(task.gitDiff, "仓库没有代码变更"),
          },
          {
            key: "events",
            label: `Agent Events ${task.events.length}`,
            children: (
              <List
                size="small"
                dataSource={task.events}
                locale={{ emptyText: "等待 Agent Event" }}
                renderItem={(event) => (
                  <List.Item>
                    <Space align="start">
                      <Tag>{event.ordinal}</Tag>
                      <div>
                        <Text strong>{event.kind}</Text>
                        <div><Text type="secondary">{event.source || "system"} · {event.timestamp}</Text></div>
                        {event.terminalOutput && <pre className="engineering-event-output">{event.terminalOutput}</pre>}
                      </div>
                    </Space>
                  </List.Item>
                )}
              />
            ),
          },
          {
            key: "docker",
            label: "Docker 快照",
            children: outputBlock(task.dockerContext, "本次任务没有选择 Docker 日志"),
          },
        ]}
      />
    </Card>
  );
}

export default function EngineeringTasks() {
  const { message } = AntdApp.useApp();
  const [repoPath, setRepoPath] = useState("D:\\TestHome\\TestMesh");
  const [inspection, setInspection] = useState<RepositoryInspection>();
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [logContext, setLogContext] = useState("");
  const [containers, setContainers] = useState<DockerContainerSummary[]>([]);
  const [dockerContainerId, setDockerContainerId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [tasks, setTasks] = useState<EngineeringTaskRecord[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [loadingRepo, setLoadingRepo] = useState(false);
  const [loadingDocker, setLoadingDocker] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();

  const activeTask = useMemo(
    () => tasks.find((task) => task.id === activeTaskId) ?? tasks.find((task) => RUNNING_STATUSES.includes(task.status)),
    [activeTaskId, tasks],
  );

  const loadTasks = useCallback(async () => {
    const loaded = await readJson<EngineeringTaskRecord[]>(await fetch("/api/p03/tasks"));
    setTasks(loaded);
    const running = loaded.find((task) => RUNNING_STATUSES.includes(task.status));
    setActiveTaskId(running?.id);
  }, []);

  const loadDocker = useCallback(async () => {
    setLoadingDocker(true);
    try {
      setContainers(await readJson<DockerContainerSummary[]>(await fetch("/api/p03/docker/containers")));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Docker 上下文读取失败");
    } finally {
      setLoadingDocker(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTasks().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "任务记录加载失败"));
      void loadDocker();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDocker, loadTasks]);

  useEffect(() => {
    if (!activeTaskId) return;
    const timer = window.setInterval(() => {
      void fetch(`/api/p03/tasks/${activeTaskId}`)
        .then((response) => readJson<EngineeringTaskRecord>(response))
        .then((task) => {
          setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
          if (!RUNNING_STATUSES.includes(task.status)) setActiveTaskId(undefined);
        })
        .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "任务状态读取失败"));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [activeTaskId]);

  async function inspectRepo() {
    setLoadingRepo(true);
    setError(undefined);
    try {
      const response = await fetch("/api/p03/repository/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repoPath }),
      });
      const result = await readJson<RepositoryInspection>(response);
      setInspection(result);
      setRepoPath(result.repoPath);
      setSelectedFiles([]);
      message.success("仓库上下文已读取");
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "仓库检查失败";
      setError(detail);
      setInspection(undefined);
    } finally {
      setLoadingRepo(false);
    }
  }

  async function startTask() {
    if (!inspection) {
      message.warning("请先读取仓库");
      return;
    }
    setStarting(true);
    setError(undefined);
    try {
      const response = await fetch("/api/p03/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repoPath: inspection.repoPath,
          instruction,
          selectedFiles,
          logContext,
          dockerContainerId,
          authorized,
        }),
      });
      const task = await readJson<EngineeringTaskRecord>(response);
      setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
      setActiveTaskId(task.id);
      message.success("OpenHands 工程任务已启动");
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "工程任务启动失败";
      setError(detail);
      message.error("工程任务未启动");
    } finally {
      setStarting(false);
    }
  }

  async function stopTask() {
    if (!activeTask) return;
    try {
      await readJson<{ ok: boolean }>(await fetch(`/api/p03/tasks/${activeTask.id}/stop`, { method: "POST" }));
      message.info("停止请求已发送");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "停止任务失败");
    }
  }

  return (
    <div className="engineering-page">
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={9}>
          <Card className="engineering-config-card" title={<Space><FolderOpenOutlined />工程上下文</Space>}>
            <div className="engineering-field">
              <Text strong>Git 仓库根目录</Text>
              <Input value={repoPath} onChange={(event) => setRepoPath(event.target.value)} disabled={Boolean(activeTask)} />
              <Button icon={<ReloadOutlined />} loading={loadingRepo} onClick={() => void inspectRepo()} disabled={Boolean(activeTask)}>
                读取仓库
              </Button>
            </div>

            {inspection && (
              <Alert
                type="success"
                showIcon
                message={`${inspection.branch} · ${inspection.files.length} 个文件`}
                description={<pre className="engineering-status">{inspection.status || "工作区干净"}</pre>}
              />
            )}

            <div className="engineering-field">
              <Text strong><CodeOutlined /> 代码上下文</Text>
              <Select
                mode="multiple"
                showSearch
                maxCount={20}
                value={selectedFiles}
                onChange={setSelectedFiles}
                disabled={!inspection || Boolean(activeTask)}
                placeholder="可选，最多选择 20 个文件"
                options={inspection?.files.map((file) => ({ label: file, value: file }))}
                optionFilterProp="label"
              />
            </div>

            <div className="engineering-field">
              <Flex justify="space-between" align="center">
                <Text strong><ContainerOutlined /> Docker 日志快照</Text>
                <Button type="text" size="small" icon={<ReloadOutlined />} loading={loadingDocker} onClick={() => void loadDocker()} />
              </Flex>
              <Select
                allowClear
                value={dockerContainerId || undefined}
                onChange={(value) => setDockerContainerId(value ?? "")}
                disabled={Boolean(activeTask)}
                placeholder="可选，只读取最近 200 行日志"
                options={containers.map((item) => ({
                  label: `${item.name} · ${item.image} · ${item.status}`,
                  value: item.id,
                }))}
              />
            </div>

            <div className="engineering-field">
              <Text strong><CodeOutlined /> 补充日志/终端上下文</Text>
              <TextArea
                value={logContext}
                onChange={(event) => setLogContext(event.target.value)}
                autoSize={{ minRows: 3, maxRows: 7 }}
                disabled={Boolean(activeTask)}
                placeholder="可选：粘贴报错、日志或终端输出"
              />
            </div>
          </Card>
        </Col>

        <Col xs={24} xl={15}>
          <Space direction="vertical" size={16} className="engineering-main-stack">
            <Card className="engineering-task-card" title={<Space><SafetyCertificateOutlined />批准并运行工程任务</Space>}>
              <TextArea
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                autoSize={{ minRows: 4, maxRows: 9 }}
                disabled={Boolean(activeTask)}
                placeholder="例如：阅读当前测试失败与相关代码，定位原因并完成最小修复；运行相关测试，通过后停止。"
              />
              <Checkbox
                className="engineering-authorization"
                checked={authorized}
                disabled={Boolean(activeTask)}
                onChange={(event) => setAuthorized(event.target.checked)}
              >
                我明确授权 OpenHands 在所选仓库内读写文件并执行终端命令；不允许 commit、push 或访问其他仓库。
              </Checkbox>
              <Flex gap={8} wrap>
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  loading={starting}
                  disabled={!inspection || !instruction.trim() || !authorized || Boolean(activeTask)}
                  onClick={() => void startTask()}
                >
                  启动 OpenHands
                </Button>
                {activeTask && (
                  <Button danger icon={<PauseCircleOutlined />} onClick={() => void stopTask()}>
                    手动停止
                  </Button>
                )}
              </Flex>
              <Text type="secondary" className="engineering-boundary-note">
                Agent Server 1.44.0 + Client 1.39.0 · single worker · API retry 0 · 费用仅统计展示
              </Text>
            </Card>

            {error && <Alert type="error" showIcon message="P03 已停在失败点" description={error} />}

            {tasks.length === 0 ? (
              <Card><Empty description="尚无工程任务" image={Empty.PRESENTED_IMAGE_SIMPLE} /></Card>
            ) : (
              <TaskResult task={tasks[0]} />
            )}

            {tasks.length > 1 && (
              <Card title="最近任务">
                <List
                  size="small"
                  dataSource={tasks.slice(1, 6)}
                  renderItem={(task) => (
                    <List.Item onClick={() => setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)])} className="engineering-history-item">
                      <Space>
                        <Tag color={statusMeta[task.status].color}>{statusMeta[task.status].label}</Tag>
                        <Text>{task.instruction}</Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </Card>
            )}
          </Space>
        </Col>
      </Row>
    </div>
  );
}
