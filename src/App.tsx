import {
  ApiOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  CodeOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  PaperClipOutlined,
  QuestionCircleOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { Refine } from "@refinedev/core";
import {
  Alert,
  App as AntdApp,
  Avatar,
  Button,
  Card,
  Col,
  ConfigProvider,
  Divider,
  Empty,
  Flex,
  Layout,
  List,
  Menu,
  Row,
  Segmented,
  Space,
  Spin,
  Statistic,
  Tag,
  Tooltip,
  Typography,
  Upload,
  theme,
  type UploadFile,
} from "antd";
import TextArea from "antd/es/input/TextArea";
import { useMemo, useState } from "react";
import type { AnalysisResponse, Evidence, LocatorType, Priority, Severity } from "./types";
import ApiTesting from "./ApiTesting";
import EngineeringTasks from "./EngineeringTasks";

const { Header, Sider, Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;

const MAX_FILES = 6;
const MAX_FILE_MB = 8;
const ACCEPT = ".pdf,.txt,.md,.json,.html,.xml,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.rtf,.odt,.ppt,.pptx";

type Message =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; analysis: AnalysisResponse };

const priorityMeta: Record<Priority, { label: string; color: string }> = {
  must: { label: "必须", color: "red" },
  should: { label: "应该", color: "gold" },
  could: { label: "可选", color: "blue" },
};

const severityMeta: Record<Severity, { label: string; color: string }> = {
  high: { label: "高风险", color: "red" },
  medium: { label: "中风险", color: "orange" },
  low: { label: "低风险", color: "green" },
};

const locatorMeta: Record<LocatorType, string> = {
  page: "页码",
  paragraph: "段落",
  image: "图片",
  limited: "定位受限",
};

function fileObject(file: UploadFile): File | undefined {
  return file.originFileObj;
}

function hasOfficeLocationLimit(files: UploadFile[]): boolean {
  return files.some((file) => /\.(docx?|rtf|odt|pptx?)$/i.test(file.name));
}

function EvidenceLinks({ ids, evidence }: { ids: string[]; evidence: Evidence[] }) {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  return (
    <Space size={[6, 6]} wrap>
      {ids.map((id) => {
        const item = byId.get(id);
        return (
          <Tooltip
            key={id}
            title={item ? `${item.sourceName} · ${locatorMeta[item.locatorType]} ${item.locator}` : "证据不存在"}
          >
            <Tag color={item ? "geekblue" : "red"}>{id}</Tag>
          </Tooltip>
        );
      })}
    </Space>
  );
}

function AnalysisView({ response }: { response: AnalysisResponse }) {
  const { result, usage, model, sources } = response;
  const [section, setSection] = useState("需求");

  return (
    <div className="analysis-result">
      <Flex justify="space-between" align="flex-start" gap={16} wrap>
        <div>
          <Space size={8}>
            <CheckCircleOutlined className="success-icon" />
            <Text strong>分析完成</Text>
            <Tag color="blue">{model}</Tag>
          </Space>
          <Paragraph className="analysis-summary">{result.summary}</Paragraph>
        </div>
        <Text type="secondary" className="token-note">
          本次 {usage.totalTokens.toLocaleString()} tokens
        </Text>
      </Flex>

      <Row gutter={[12, 12]} className="metric-row">
        <Col xs={12} lg={6}>
          <Statistic title="需求" value={result.requirements.length} prefix={<FileSearchOutlined />} />
        </Col>
        <Col xs={12} lg={6}>
          <Statistic title="风险" value={result.risks.length} prefix={<WarningOutlined />} />
        </Col>
        <Col xs={12} lg={6}>
          <Statistic title="待确认" value={result.pendingQuestions.length} prefix={<QuestionCircleOutlined />} />
        </Col>
        <Col xs={12} lg={6}>
          <Statistic title="证据" value={result.evidence.length} prefix={<SafetyCertificateOutlined />} />
        </Col>
      </Row>

      <Segmented
        block
        value={section}
        onChange={setSection}
        options={[
          `需求 ${result.requirements.length}`,
          `风险 ${result.risks.length}`,
          `待确认 ${result.pendingQuestions.length}`,
          `证据 ${result.evidence.length}`,
        ]}
      />

      <div className="analysis-section">
        {section.startsWith("需求") && (
          <List
            dataSource={result.requirements}
            locale={{ emptyText: <Empty description="未识别到明确需求" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            renderItem={(item) => (
              <List.Item>
                <Card size="small" className="result-card">
                  <Flex justify="space-between" align="flex-start" gap={12}>
                    <Space align="start">
                      <Tag>{item.id}</Tag>
                      <Text strong>{item.title}</Text>
                    </Space>
                    <Tag color={priorityMeta[item.priority].color}>{priorityMeta[item.priority].label}</Tag>
                  </Flex>
                  <Paragraph>{item.description}</Paragraph>
                  {item.acceptanceCriteria.length > 0 && (
                    <div className="criteria-list">
                      <Text type="secondary">验收标准</Text>
                      <ul>
                        {item.acceptanceCriteria.map((criterion) => (
                          <li key={criterion}>{criterion}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <EvidenceLinks ids={item.evidenceIds} evidence={result.evidence} />
                </Card>
              </List.Item>
            )}
          />
        )}

        {section.startsWith("风险") && (
          <List
            dataSource={result.risks}
            locale={{ emptyText: <Empty description="未识别到风险" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            renderItem={(item) => (
              <List.Item>
                <Card size="small" className="result-card risk-card">
                  <Flex justify="space-between" align="flex-start" gap={12}>
                    <Space align="start">
                      <Tag>{item.id}</Tag>
                      <Text strong>{item.title}</Text>
                    </Space>
                    <Tag color={severityMeta[item.severity].color}>{severityMeta[item.severity].label}</Tag>
                  </Flex>
                  <Paragraph>{item.description}</Paragraph>
                  <Paragraph className="mitigation">
                    <Text strong>建议：</Text>
                    {item.mitigation}
                  </Paragraph>
                  <EvidenceLinks ids={item.evidenceIds} evidence={result.evidence} />
                </Card>
              </List.Item>
            )}
          />
        )}

        {section.startsWith("待确认") && (
          <List
            dataSource={result.pendingQuestions}
            locale={{ emptyText: <Empty description="暂无待确认问题" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            renderItem={(item) => (
              <List.Item>
                <Card size="small" className="result-card question-card">
                  <Space align="start">
                    <Tag color="purple">{item.id}</Tag>
                    <div>
                      <Text strong>{item.question}</Text>
                      <Paragraph type="secondary">为什么要确认：{item.reason}</Paragraph>
                      {item.relatedRequirementIds.length > 0 && (
                        <Space size={4} wrap>
                          {item.relatedRequirementIds.map((id) => (
                            <Tag key={id}>{id}</Tag>
                          ))}
                        </Space>
                      )}
                    </div>
                  </Space>
                </Card>
              </List.Item>
            )}
          />
        )}

        {section.startsWith("证据") && (
          <List
            dataSource={result.evidence}
            renderItem={(item) => (
              <List.Item>
                <Card size="small" className="result-card evidence-card">
                  <Flex justify="space-between" align="flex-start" gap={12} wrap>
                    <Space align="start">
                      <Tag color="geekblue">{item.id}</Tag>
                      <div>
                        <Text strong>{item.sourceName}</Text>
                        <div>
                          <Text type="secondary">{item.sourceId}</Text>
                        </div>
                      </div>
                    </Space>
                    <Tag color={item.locatorType === "limited" ? "warning" : "success"}>
                      {locatorMeta[item.locatorType]}
                      {item.locator ? ` ${item.locator}` : ""}
                    </Tag>
                  </Flex>
                  {item.excerpt && <blockquote>{item.excerpt}</blockquote>}
                  {item.note && <Alert type={item.locatorType === "limited" ? "warning" : "info"} message={item.note} showIcon />}
                </Card>
              </List.Item>
            )}
          />
        )}
      </div>

      <Divider />
      <Flex gap={8} wrap>
        {sources.map((source) => (
          <Tooltip key={source.id} title={source.capabilityNote}>
            <Tag color={source.capability === "limited" ? "warning" : "default"}>
              {source.id} · {source.name}
            </Tag>
          </Tooltip>
        ))}
      </Flex>
    </div>
  );
}

function UploadPanel({
  title,
  description,
  icon,
  files,
  onChange,
  remaining,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  files: UploadFile[];
  onChange: (files: UploadFile[]) => void;
  remaining: number;
}) {
  return (
    <Card className="upload-card" size="small">
      <Flex gap={10} align="center" className="upload-heading">
        <Avatar size={34} icon={icon} className="soft-avatar" />
        <div>
          <Text strong>{title}</Text>
          <div>
            <Text type="secondary" className="upload-description">
              {description}
            </Text>
          </div>
        </div>
      </Flex>
      <Dragger
        accept={ACCEPT}
        multiple
        fileList={files}
        disabled={remaining <= 0}
        beforeUpload={(file) => {
          if (file.size > MAX_FILE_MB * 1024 * 1024) {
            return Upload.LIST_IGNORE;
          }
          return false;
        }}
        onChange={({ fileList }) => onChange(fileList.slice(0, files.length + remaining))}
        onRemove={(file) => {
          onChange(files.filter((item) => item.uid !== file.uid));
          return true;
        }}
        showUploadList={{ showDownloadIcon: false, showPreviewIcon: false }}
      >
        <p className="ant-upload-drag-icon">
          <CloudUploadOutlined />
        </p>
        <p className="ant-upload-text">拖入或选择文件</p>
        <p className="ant-upload-hint">单个不超过 {MAX_FILE_MB} MB</p>
      </Dragger>
    </Card>
  );
}

function Workbench() {
  const { message: toast } = AntdApp.useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [activePage, setActivePage] = useState<"chat" | "api" | "engineering">("engineering");
  const [prompt, setPrompt] = useState("帮我分析这个需求");
  const [attachments, setAttachments] = useState<UploadFile[]>([]);
  const [knowledge, setKnowledge] = useState<UploadFile[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const totalFiles = attachments.length + knowledge.length;
  const officeWarning = hasOfficeLocationLimit([...attachments, ...knowledge]);
  const remaining = Math.max(0, MAX_FILES - totalFiles);
  const lastResponse = [...messages].reverse().find((item) => item.role === "assistant");

  const subtitle = useMemo(() => {
    if (loading) return "OpenAI 正在读取资料并生成结构化分析";
    if (lastResponse?.role === "assistant") return `最近一次分析使用 ${lastResponse.analysis.model}`;
    return "上传 PRD 或截图，获得可追溯的需求与风险分析";
  }, [lastResponse, loading]);

  async function submit() {
    if (!prompt.trim()) {
      toast.warning("请输入分析指令");
      return;
    }
    if (totalFiles === 0) {
      toast.warning("请至少上传一份 PRD、文档或图片");
      return;
    }

    const formData = new FormData();
    formData.append("message", prompt.trim());
    for (const file of attachments) {
      const nativeFile = fileObject(file);
      if (nativeFile) formData.append("attachments", nativeFile, file.name);
    }
    for (const file of knowledge) {
      const nativeFile = fileObject(file);
      if (nativeFile) formData.append("knowledge", nativeFile, file.name);
    }

    const userMessage: Message = { id: crypto.randomUUID(), role: "user", text: prompt.trim() };
    setMessages((current) => [...current, userMessage]);
    setLoading(true);
    setError(undefined);

    try {
      const response = await fetch("/api/analyze", { method: "POST", body: formData });
      const body = (await response.json()) as AnalysisResponse | { error?: string };
      if (!response.ok) {
        throw new Error("error" in body && body.error ? body.error : `请求失败（HTTP ${response.status}）`);
      }
      const analysis = body as AnalysisResponse;
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", analysis },
      ]);
      toast.success("需求分析完成");
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "未知错误";
      setError(detail);
      toast.error("分析失败，已停在失败点");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Refine
      options={{
        disableTelemetry: true,
        syncWithLocation: false,
        warnWhenUnsavedChanges: false,
      }}
    >
      <Layout className="app-shell">
        <Sider
          width={232}
          collapsedWidth={72}
          collapsed={collapsed}
          trigger={null}
          className="app-sider"
        >
          <div className="brand">
            <div className="brand-mark">TM</div>
            {!collapsed && (
              <div>
                <div className="brand-name">TestMesh</div>
                <div className="brand-caption">AI 测试工程平台</div>
              </div>
            )}
          </div>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[activePage]}
            onClick={({ key }) => {
              if (key === "chat" || key === "api" || key === "engineering") setActivePage(key);
            }}
            items={[
              { key: "overview", icon: <BulbOutlined />, label: "工作台概览", disabled: true },
              { key: "chat", icon: <MessageOutlined />, label: "AI 需求分析" },
              { key: "api", icon: <ApiOutlined />, label: "API 测试" },
              { key: "engineering", icon: <CodeOutlined />, label: "工程任务" },
              { key: "knowledge", icon: <DatabaseOutlined />, label: "项目资料", disabled: true },
            ]}
          />
          {!collapsed && (
            <div className="phase-card">
              <Flex justify="space-between" align="center">
                <Text className="phase-label">当前阶段</Text>
                <Tag color="processing" bordered={false}>
                  进行中
                </Tag>
              </Flex>
              <Text className="phase-title">P03 · 工程上下文</Text>
              <Text className="phase-copy">Repo → OpenHands → Evidence</Text>
            </div>
          )}
        </Sider>

        <Layout>
          <Header className="app-header">
            <Flex align="center" justify="space-between">
              <Space size={12}>
                <Button
                  type="text"
                  icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                  onClick={() => setCollapsed((value) => !value)}
                />
                <div>
                  <Title level={4}>
                    {activePage === "chat" ? "AI 需求分析" : activePage === "api" ? "API 测试" : "工程任务"}
                  </Title>
                  <Text type="secondary">
                    {activePage === "chat"
                      ? subtitle
                      : activePage === "api"
                        ? "导入 OpenAPI，关联需求与证据并运行 Schemathesis"
                        : "选择仓库和工程上下文，明确授权后交给 OpenHands"}
                  </Text>
                </div>
              </Space>
              <Space>
                <Tag color="blue">
                  {activePage === "chat"
                    ? "Responses API"
                    : activePage === "api"
                      ? "Schemathesis 4.24.3"
                      : "OpenHands 1.39.0"}
                </Tag>
                <Avatar className="user-avatar">U</Avatar>
              </Space>
            </Flex>
          </Header>

          <Content className="app-content">
            {activePage === "chat" ? (
              <div className="workspace-grid">
              <section className="chat-panel">
                <div className="chat-feed">
                  {messages.length === 0 && (
                    <div className="welcome-state">
                      <div className="welcome-orbit">
                        <FileSearchOutlined />
                      </div>
                      <Title level={3}>从 PRD 到可测试需求</Title>
                      <Paragraph>
                        上传 PRD、截图或补充资料。TestMesh 会返回结构化需求、风险、待确认问题和可追溯证据。
                      </Paragraph>
                      <Space size={[8, 8]} wrap>
                        <Tag>功能与边界</Tag>
                        <Tag>异常路径</Tag>
                        <Tag>风险识别</Tag>
                        <Tag>证据追溯</Tag>
                      </Space>
                    </div>
                  )}

                  {messages.map((item) =>
                    item.role === "user" ? (
                      <div className="message-row user-message" key={item.id}>
                        <div className="message-bubble">{item.text}</div>
                        <Avatar className="user-avatar">U</Avatar>
                      </div>
                    ) : (
                      <div className="message-row assistant-message" key={item.id}>
                        <Avatar className="ai-avatar">AI</Avatar>
                        <div className="assistant-bubble">
                          <AnalysisView response={item.analysis} />
                        </div>
                      </div>
                    ),
                  )}

                  {loading && (
                    <div className="message-row assistant-message">
                      <Avatar className="ai-avatar">AI</Avatar>
                      <div className="thinking-card">
                        <Spin />
                        <div>
                          <Text strong>正在分析资料</Text>
                          <div>
                            <Text type="secondary">不会自动重试或切换模型</Text>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {error && (
                    <Alert
                      type="error"
                      showIcon
                      message="分析失败，流程已停止"
                      description={error}
                      className="failure-alert"
                    />
                  )}
                </div>

                <div className="composer-wrap">
                  <div className="attachment-summary">
                    <Space size={6} wrap>
                      <PaperClipOutlined />
                      <Text type="secondary">
                        {totalFiles === 0 ? "尚未选择资料" : `已选择 ${totalFiles} 个来源`}
                      </Text>
                      {[...attachments, ...knowledge].map((file) => (
                        <Tag key={file.uid}>{file.name}</Tag>
                      ))}
                    </Space>
                  </div>
                  <div className="composer">
                    <TextArea
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      onPressEnter={(event) => {
                        if (!event.shiftKey) {
                          event.preventDefault();
                          void submit();
                        }
                      }}
                      autoSize={{ minRows: 2, maxRows: 6 }}
                      placeholder="输入分析指令，例如：帮我分析这个需求"
                      disabled={loading}
                    />
                    <Button
                      type="primary"
                      size="large"
                      icon={<SendOutlined />}
                      loading={loading}
                      onClick={() => void submit()}
                    >
                      开始分析
                    </Button>
                  </div>
                  <Text type="secondary" className="composer-hint">
                    Enter 发送 · Shift + Enter 换行 · 单次最多 {MAX_FILES} 个文件
                  </Text>
                </div>
              </section>

              <aside className="source-panel">
                <div>
                  <Title level={5}>分析资料</Title>
                  <Paragraph type="secondary">两类来源只在本次分析请求中使用，不建立复杂知识库。</Paragraph>
                </div>

                <UploadPanel
                  title="Chat Attachment"
                  description="跟随当前对话的 PRD 与截图"
                  icon={<PaperClipOutlined />}
                  files={attachments}
                  onChange={setAttachments}
                  remaining={remaining}
                />

                <UploadPanel
                  title="Project Knowledge"
                  description="本次分析使用的项目补充资料"
                  icon={<FolderOpenOutlined />}
                  files={knowledge}
                  onChange={setKnowledge}
                  remaining={remaining}
                />

                {officeWarning && (
                  <Alert
                    type="warning"
                    showIcon
                    message="Office 文件定位受限"
                    description="DOC/DOCX/PPT/PPTX 只抽取文本，嵌入图片不会送入模型。请转为 PDF 或把图片单独上传。"
                  />
                )}

                <Card size="small" className="boundary-card">
                  <Space direction="vertical" size={8}>
                    <Space>
                      <SafetyCertificateOutlined />
                      <Text strong>P01 边界</Text>
                    </Space>
                    <Text type="secondary">只做需求分析；不执行 UI、API、APP、性能或安全测试。</Text>
                  </Space>
                </Card>
              </aside>
              </div>
            ) : activePage === "api" ? (
              <ApiTesting />
            ) : (
              <EngineeringTasks />
            )}
          </Content>
        </Layout>
      </Layout>
    </Refine>
  );
}

export default function App() {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: "#2457f5",
          colorInfo: "#2457f5",
          borderRadius: 10,
          fontFamily:
            'Inter, "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        },
        components: {
          Layout: { headerBg: "#ffffff", siderBg: "#111a32" },
          Menu: { darkItemBg: "#111a32", darkItemSelectedBg: "#2457f5" },
        },
      }}
    >
      <AntdApp>
        <Workbench />
      </AntdApp>
    </ConfigProvider>
  );
}
