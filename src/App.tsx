import {
  AndroidOutlined,
  ApiOutlined,
  BulbOutlined,
  CodeOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  DesktopOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  ExperimentOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  PaperClipOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Refine } from "@refinedev/core";
import {
  Alert,
  App as AntdApp,
  Avatar,
  Button,
  Card,
  ConfigProvider,
  Flex,
  Layout,
  Menu,
  Space,
  Spin,
  Tag,
  Typography,
  Upload,
  theme,
  type UploadFile,
} from "antd";
import TextArea from "antd/es/input/TextArea";
import { useEffect, useMemo, useState } from "react";
import type { AnalysisResponse, RequirementAnalysis } from "./types";
import ApiTesting from "./ApiTesting";
import EngineeringTasks from "./EngineeringTasks";
import UiTesting from "./UiTesting";
import AppTesting from "./AppTesting";
import PerformanceTesting from "./PerformanceTesting";
import SecurityTesting from "./SecurityTesting";
import TestDesign from "./TestDesign";
import RequirementAnalysisView from "./RequirementAnalysisView";

const { Header, Sider, Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;

const MAX_FILES = 6;
const MAX_FILE_MB = 8;
const ACCEPT = ".pdf,.txt,.md,.json,.html,.xml,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.rtf,.odt,.ppt,.pptx";

type Message =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; analysis: AnalysisResponse };

type SavedAnalysis = { id: string; summary: string; model: string; createdAt: string };

function fileObject(file: UploadFile): File | undefined {
  return file.originFileObj;
}

function hasOfficeLocationLimit(files: UploadFile[]): boolean {
  return files.some((file) => /\.(docx?|rtf|odt|pptx?)$/i.test(file.name));
}

function AnalysisView({ response }: { response: AnalysisResponse }) {
  return <RequirementAnalysisView response={response} />;
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
        <p className="ant-upload-hint">PDF 看正文和页面图片；PNG/JPG/WEBP/静态 GIF 看视觉内容；Word、Markdown 等非 PDF 文档只看文本。</p>
      </Dragger>
    </Card>
  );
}

function Workbench() {
  const { message: toast } = AntdApp.useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [activePage, setActivePage] = useState<"chat" | "api" | "engineering" | "ui" | "app" | "performance" | "security" | "design">("chat");
  const [prompt, setPrompt] = useState("帮我分析这个需求");
  const [attachments, setAttachments] = useState<UploadFile[]>([]);
  const [knowledge, setKnowledge] = useState<UploadFile[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysis[]>([]);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const totalFiles = attachments.length + knowledge.length;
  const officeWarning = hasOfficeLocationLimit([...attachments, ...knowledge]);
  const remaining = Math.max(0, MAX_FILES - totalFiles);
  const lastResponse = [...messages].reverse().find((item) => item.role === "assistant");

  useEffect(() => {
    void fetch("/api/analyses")
      .then(async (response) => {
        if (!response.ok) throw new Error(`读取已保存报告失败（HTTP ${response.status}）`);
        setSavedAnalyses((await response.json()) as SavedAnalysis[]);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "读取已保存报告失败"));
  }, []);

  async function openSavedAnalysis(item: SavedAnalysis) {
    setError(undefined);
    try {
      const response = await fetch(`/api/analyses/${encodeURIComponent(item.id)}`);
      const body = (await response.json()) as RequirementAnalysis | { error?: string };
      if (!response.ok) throw new Error("error" in body && body.error ? body.error : `读取报告失败（HTTP ${response.status}）`);
      const analysis: AnalysisResponse = { analysisId: item.id, result: body as RequirementAnalysis, model: item.model, sources: [] };
      setSelectedAnalysisId(item.id);
      setMessages([{ id: item.id, role: "assistant", analysis }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取报告失败");
    }
  }

  const subtitle = useMemo(() => {
    if (loading) return "OpenAI 正在读取资料并生成结构化分析";
    if (lastResponse?.role === "assistant") return `最近一次分析使用 ${lastResponse.analysis.model}`;
    return "上传 PRD 或截图，获得可追溯的需求分析";
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
      setSelectedAnalysisId(analysis.analysisId);
      void fetch("/api/analyses")
        .then(async (response) => {
          if (!response.ok) throw new Error(`刷新已保存报告失败（HTTP ${response.status}）`);
          setSavedAnalyses((await response.json()) as SavedAnalysis[]);
        })
        .catch((caught) => setError(caught instanceof Error ? caught.message : "刷新已保存报告失败"));
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
              if (key === "chat" || key === "api" || key === "engineering" || key === "ui" || key === "app" || key === "performance" || key === "security" || key === "design") setActivePage(key);
            }}
            items={[
              { key: "overview", icon: <BulbOutlined />, label: "工作台概览", disabled: true },
              { key: "chat", icon: <MessageOutlined />, label: "AI 需求分析" },
              { key: "design", icon: <ExperimentOutlined />, label: "测试设计" },
              { key: "api", icon: <ApiOutlined />, label: "API 测试" },
              { key: "engineering", icon: <CodeOutlined />, label: "工程任务" },
              { key: "ui", icon: <DesktopOutlined />, label: "UI 测试" },
              { key: "app", icon: <AndroidOutlined />, label: "APP 测试" },
              { key: "performance", icon: <ThunderboltOutlined />, label: "性能测试" },
              { key: "security", icon: <SafetyCertificateOutlined />, label: "安全测试" },
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
              <Text className="phase-title">P01 · 需求分析</Text>
              <Text className="phase-copy">P05 测试设计暂停，待需求分析评审</Text>
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
                    {activePage === "chat" ? "AI 需求分析" : activePage === "api" ? "API 测试" : activePage === "engineering" ? "工程任务" : activePage === "ui" ? "UI 测试" : activePage === "app" ? "APP 测试" : activePage === "performance" ? "性能测试" : activePage === "security" ? "安全测试" : "测试设计与用例生成"}
                  </Title>
                  <Text type="secondary">
                    {activePage === "chat"
                      ? subtitle
                      : activePage === "api"
                        ? "导入 OpenAPI，关联需求与证据并运行 Schemathesis"
                        : activePage === "engineering"
                          ? "选择仓库和工程上下文，明确授权后交给 OpenHands"
                          : activePage === "ui"
                            ? "在一次性 Docker 容器中运行所选 Playwright 测试"
                            : activePage === "app"
                              ? "连接本机已启动的 Android Emulator，运行所选 WebdriverIO 测试"
                            : activePage === "performance"
                              ? "以当前 Windows 用户权限运行所选本地 k6 脚本"
                              : activePage === "security"
                                ? "明确授权后运行无认证 Traditional Spider 与被动安全扫描"
                                : "结合原始 PRD 与真实分析结果生成可追溯测试用例"}
                  </Text>
                </div>
              </Space>
              <Space>
                <Tag color="blue">
                  {activePage === "chat"
                    ? "Responses API"
                    : activePage === "api"
                      ? "Schemathesis 4.24.3"
                      : activePage === "engineering"
                        ? "OpenHands 1.39.0"
                        : activePage === "ui"
                          ? "Playwright 1.62.1"
                          : activePage === "app"
                            ? "Appium 3.7.0"
                            : activePage === "performance"
                              ? "k6 2.2.0"
                              : activePage === "security"
                                ? "ZAP 2.17.0"
                                : "Responses API + OpenHands"}
                </Tag>
                <Avatar className="user-avatar">U</Avatar>
              </Space>
            </Flex>
          </Header>

          <Content className={`app-content ${activePage === "chat" ? "app-content--fixed" : "app-content--scrollable"}`}>
            {activePage === "chat" ? (
              <div className="workspace-grid">
              <section className="chat-panel">
                <div className="chat-feed">
                  {savedAnalyses.length > 0 && (
                    <Card size="small" title="已保存的需求分析报告">
                      <Space size={[8, 8]} wrap>
                        {savedAnalyses.map((item) => (
                          <Button key={item.id} type={selectedAnalysisId === item.id ? "primary" : "default"} onClick={() => void openSavedAnalysis(item)}>
                            {new Date(item.createdAt).toLocaleString("zh-CN")} · {item.summary.slice(0, 28) || "需求分析"}
                          </Button>
                        ))}
                      </Space>
                    </Card>
                  )}
                  {messages.length === 0 && (
                    <div className="welcome-state">
                      <div className="welcome-orbit">
                        <FileSearchOutlined />
                      </div>
                      <Title level={3}>从 PRD 到可测试需求</Title>
                      <Paragraph>
                        上传 PRD、截图或补充资料。TestMesh 会返回固定格式的需求分析报告、待确认问题和可追溯原文引用。
                      </Paragraph>
                      <Space size={[8, 8]} wrap>
                        <Tag>功能与边界</Tag>
                        <Tag>异常路径</Tag>
                        <Tag>业务规则</Tag>
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
                    description="OpenAI 文件输入只从 DOC/DOCX/RTF/ODT/PPT/PPTX 抽取文本，嵌入图片不会进入模型。请转为 PDF 或把图片单独上传。"
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
            ) : activePage === "engineering" ? (
              <EngineeringTasks />
            ) : activePage === "ui" ? (
              <UiTesting />
            ) : activePage === "app" ? (
              <AppTesting />
            ) : activePage === "performance" ? (
              <PerformanceTesting />
            ) : activePage === "security" ? (
              <SecurityTesting />
            ) : (
              <TestDesign />
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
