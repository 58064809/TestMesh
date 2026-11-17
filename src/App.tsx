import {
  AndroidOutlined,
  ApiOutlined,
  AuditOutlined,
  BulbOutlined,
  CloudUploadOutlined,
  SettingOutlined,
  DesktopOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
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
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AnalysisResponse, RequirementAnalysis } from "./types";
import ApiTesting from "./ApiTesting";
import UiTesting from "./UiTesting";
import AppTesting from "./AppTesting";
import PerformanceTesting from "./PerformanceTesting";
import SecurityTesting from "./SecurityTesting";
import RequirementAnalysisView from "./RequirementAnalysisView";
import AiAcceptance from "./AiAcceptance";
import QualityManagement from "./QualityManagement";
import QualityOverview from "./QualityOverview";

const { Header, Sider, Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;

const MAX_FILES = 6;
const MAX_FILE_MB = 8;
const ACCEPT = ".pdf,.txt,.md,.json,.xml,.html,.htm,.png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp,.docx,.odt,.pptx,.xlsx,.ods,.csv";

type AnalysisResult = { id: string; analysis: AnalysisResponse };

type SavedAnalysis = {
  id: string;
  summary: string;
  model: string;
  createdAt: string;
  protocol: "current" | "incompatible";
  status: "candidate" | "reviewing" | "baselined";
  traceProvider: string;
  traceProjectName: string;
  traceId: string;
  traceUrl: string;
  reviewSummary: {
    total: number;
    pending: number;
    accepted: number;
    rejected: number;
    merged: number;
  };
};

function fileObject(file: UploadFile): File | undefined {
  return file.originFileObj;
}

const analysisStatusLabels: Record<SavedAnalysis["status"], { label: string; color: string }> = {
  candidate: { label: "待评审", color: "orange" },
  reviewing: { label: "评审中", color: "blue" },
  baselined: { label: "已基线", color: "green" },
};

function AnalysisView({ response, onReviewSaved }: { response: AnalysisResponse; onReviewSaved: () => Promise<void> }) {
  return <RequirementAnalysisView response={response} onReviewSaved={onReviewSaved} />;
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
        <p className="ant-upload-hint">PDF、Office、表格和图片由 Docling 统一解析 OCR、表格、阅读顺序与版面定位。</p>
      </Dragger>
    </Card>
  );
}

function Workbench() {
  const { message: toast } = AntdApp.useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [activePage, setActivePage] = useState<"overview" | "chat" | "acceptance" | "project-config" | "api" | "ui" | "app" | "performance" | "security">("overview");
  const [attachments, setAttachments] = useState<UploadFile[]>([]);
  const [knowledge, setKnowledge] = useState<UploadFile[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisResult[]>([]);
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysis[]>([]);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string>();
  const [openingAnalysisId, setOpeningAnalysisId] = useState<string>();
  const [savedAnalysisError, setSavedAnalysisError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const navigate = (event: Event) => {
      const page = (event as CustomEvent<string>).detail;
      const normalized = page === "test-design" || page === "quality" ? "acceptance" : page;
      if (["overview", "chat", "acceptance", "project-config", "api", "ui", "app", "performance", "security"].includes(normalized)) {
        setActivePage(normalized as typeof activePage);
      }
    };
    window.addEventListener("testmesh:navigate", navigate);
    return () => window.removeEventListener("testmesh:navigate", navigate);
  }, []);

  const totalFiles = attachments.length + knowledge.length;
  const remaining = Math.max(0, MAX_FILES - totalFiles);
  const lastResponse = analyses.at(-1);

  const refreshSavedAnalyses = useCallback(async () => {
    const response = await fetch("/api/analyses", { cache: "no-store" });
    if (!response.ok) throw new Error(`刷新已保存报告失败（HTTP ${response.status}）`);
    setSavedAnalyses((await response.json()) as SavedAnalysis[]);
  }, []);

  useEffect(() => {
    void fetch("/api/analyses", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`读取已保存报告失败（HTTP ${response.status}）`);
        setSavedAnalyses((await response.json()) as SavedAnalysis[]);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "读取已保存报告失败"));
  }, []);

  async function openSavedAnalysis(item: SavedAnalysis) {
    setSelectedAnalysisId(item.id);
    setAnalyses([]);
    setError(undefined);
    setSavedAnalysisError(undefined);
    if (item.protocol === "incompatible") {
      setSavedAnalysisError("这份报告生成于需求分析协议升级前，原始结果仍然保留，但不能按当前 Schema 展示。请使用原始资料按新协议重新分析。");
      return;
    }
    setOpeningAnalysisId(item.id);
    try {
      const response = await fetch(`/api/analyses/${encodeURIComponent(item.id)}`);
      const body = (await response.json()) as RequirementAnalysis | { error?: string };
      if (!response.ok) throw new Error("error" in body && body.error ? body.error : `读取报告失败（HTTP ${response.status}）`);
      const analysis: AnalysisResponse = {
        analysisId: item.id,
        result: body as RequirementAnalysis,
        model: item.model,
        sources: [],
        observability: item.traceProvider === "phoenix" && item.traceId ? {
          provider: "phoenix",
          projectName: item.traceProjectName,
          traceId: item.traceId,
          traceUrl: item.traceUrl,
        } : undefined,
      };
      setAnalyses([{ id: item.id, analysis }]);
    } catch (caught) {
      setSavedAnalysisError(caught instanceof Error ? caught.message : "读取报告失败");
    } finally {
      setOpeningAnalysisId(undefined);
    }
  }

  const subtitle = useMemo(() => {
    if (loading) return "OpenAI 正在读取资料并生成结构化分析";
    if (lastResponse) return `最近一次分析使用 ${lastResponse.analysis.model}`;
    return "上传 PRD 或截图，获得可追溯的需求分析";
  }, [lastResponse, loading]);

  async function submit() {
    if (totalFiles === 0) {
      toast.warning("请至少上传一份 PRD、文档或图片");
      return;
    }

    const formData = new FormData();
    for (const file of attachments) {
      const nativeFile = fileObject(file);
      if (nativeFile) formData.append("attachments", nativeFile, file.name);
    }
    for (const file of knowledge) {
      const nativeFile = fileObject(file);
      if (nativeFile) formData.append("knowledge", nativeFile, file.name);
    }

    setSavedAnalysisError(undefined);
    setOpeningAnalysisId(undefined);
    setSelectedAnalysisId(undefined);
    setLoading(true);
    setError(undefined);

    try {
      const response = await fetch("/api/analyze", { method: "POST", body: formData });
      const body = (await response.json()) as AnalysisResponse | { error?: string };
      if (!response.ok) {
        throw new Error("error" in body && body.error ? body.error : `请求失败（HTTP ${response.status}）`);
      }
      const analysis = body as AnalysisResponse;
      setAnalyses((current) => [
        ...current,
        { id: crypto.randomUUID(), analysis },
      ]);
      setSelectedAnalysisId(analysis.analysisId);
      void refreshSavedAnalyses().catch((caught) => setError(caught instanceof Error ? caught.message : "刷新已保存报告失败"));
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
                <div className="brand-caption">AI 质量工程平台</div>
              </div>
            )}
          </div>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[activePage]}
            onClick={({ key }) => {
              if (key === "overview" || key === "chat" || key === "acceptance" || key === "project-config" || key === "api" || key === "ui" || key === "app" || key === "performance" || key === "security") setActivePage(key);
            }}
            items={[
              { key: "overview", icon: <BulbOutlined />, label: "质量报告" },
              { key: "chat", icon: <MessageOutlined />, label: "AI 需求分析" },
              { key: "acceptance", icon: <AuditOutlined />, label: "AI 应用验收" },
              { key: "project-config", icon: <SettingOutlined />, label: "项目质量管理" },
              { key: "api", icon: <ApiOutlined />, label: "API 自动化" },
              { key: "ui", icon: <DesktopOutlined />, label: "UI 测试" },
              { key: "app", icon: <AndroidOutlined />, label: "APP 测试" },
              { key: "performance", icon: <ThunderboltOutlined />, label: "性能测试" },
              { key: "security", icon: <SafetyCertificateOutlined />, label: "安全测试" },
            ]}
          />
          {!collapsed && (
            <div className="phase-card">
              <Flex justify="space-between" align="center">
                <Text className="phase-label">当前阶段</Text>
                <Tag color={activePage === "api" || activePage === "acceptance" || activePage === "project-config" || activePage === "overview" ? "processing" : "success"} bordered={false}>
                  {activePage === "api" || activePage === "ui" || activePage === "acceptance" || activePage === "project-config" || activePage === "overview" ? "进行中" : "已完成"}
                </Tag>
              </Flex>
              <Text className="phase-title">{activePage === "overview" ? "项目质量总览" : activePage === "project-config" ? "QM01 · 项目质量管理" : activePage === "acceptance" ? "AI 应用验收" : activePage === "api" ? "AT01 · API 自动化" : activePage === "ui" ? "AT02 · UI 自动化" : "RA01 · AI 需求分析"}</Text>
              <Text className="phase-copy">{activePage === "overview" ? "集中查看发布结论、核心指标、证据缺口与历史归档报告" : activePage === "project-config" ? "以质量计划统筹质量资产、分层指标、正式发布准入和持续改进" : activePage === "acceptance" ? "从冻结需求到测试模型、测试条件、用例、Dataset、执行和结论" : activePage === "api" ? "执行 API 测试；失败后基于断言和链路证据智能诊断" : activePage === "ui" ? "执行 Playwright 测试；失败后基于用例、Trace 和系统证据智能诊断" : "单一需求分析入口：发现缺失、歧义与冲突，并提供可核对的原文证据"}</Text>
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
                    {activePage === "overview" ? "质量报告" : activePage === "chat" ? "AI 需求分析" : activePage === "acceptance" ? "AI 应用验收" : activePage === "project-config" ? "项目质量管理" : activePage === "api" ? "API 自动化" : activePage === "ui" ? "UI 测试" : activePage === "app" ? "APP 测试" : activePage === "performance" ? "性能测试" : "安全测试"}
                  </Title>
                  <Text type="secondary">
                    {activePage === "overview"
                      ? "发布结论、质量指标、证据缺口和历史报告的统一决策视图"
                      : activePage === "chat"
                      ? subtitle
                      : activePage === "acceptance"
                        ? "按版本化 Schema 完成测试建模、条件、用例、Dataset 和执行验收"
                      : activePage === "project-config"
                        ? "用质量计划统一项目配置、质量资产、指标、发布准入与持续改进"
                      : activePage === "api"
                        ? "选择 Approved TestCase，执行契约生成测试或确定性业务 API 场景"
                        : activePage === "ui"
                            ? "关联 Approved TestCase，在本机运行已审核的 Playwright 测试"
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
                  {activePage === "overview"
                    ? "Quality Report + OPA"
                    : activePage === "chat"
                    ? "LangGraph Harness"
                    : activePage === "acceptance"
                      ? "Acceptance Flow"
                    : activePage === "project-config"
                      ? "Quality Plan + OPA"
                    : activePage === "api"
                      ? "Schemathesis 4.29.3 + FastAPI YAML"
                      : activePage === "ui"
                          ? "Playwright 1.64.0"
                      : activePage === "app"
                            ? "Appium 3.7.0"
                            : activePage === "performance"
                              ? "k6 2.2.0"
                              : "ZAP 2.17.0"}
                </Tag>
                <Avatar className="user-avatar">U</Avatar>
              </Space>
            </Flex>
          </Header>

          <Content className={`app-content ${activePage === "chat" ? "app-content--fixed" : "app-content--scrollable"}`}>
            {activePage === "overview" ? (
              <QualityOverview />
            ) : activePage === "chat" ? (
              <div className="workspace-grid">
              <section className="chat-panel">
                <div className="chat-feed">
                  {savedAnalyses.length > 0 && (
                    <Card size="small" title="已保存的需求分析报告">
                      <Space size={[8, 8]} wrap>
                        {savedAnalyses.map((item) => (
                          <Button key={item.id} loading={openingAnalysisId === item.id} type={selectedAnalysisId === item.id ? "primary" : "default"} onClick={() => void openSavedAnalysis(item)}>
                            <Space size={6} wrap>
                              {new Date(item.createdAt).toLocaleString("zh-CN")} · {item.summary.slice(0, 28) || "需求分析"}
                              {item.protocol === "incompatible" && <Tag>旧协议</Tag>}
                              <Tag color={analysisStatusLabels[item.status]?.color}>{analysisStatusLabels[item.status]?.label ?? "状态未知"}</Tag>
                              {item.reviewSummary && <>
                                <Tag color="orange">待评审 {item.reviewSummary.pending}</Tag>
                                <Tag color="green">已接受 {item.reviewSummary.accepted}</Tag>
                                {(item.reviewSummary.rejected + item.reviewSummary.merged) > 0 && <Tag>已处理 {item.reviewSummary.rejected + item.reviewSummary.merged}</Tag>}
                              </>}
                            </Space>
                          </Button>
                        ))}
                      </Space>
                    </Card>
                  )}
                  {savedAnalysisError && (
                    <Alert
                      type="warning"
                      showIcon
                      message="无法打开这份已保存报告"
                      description={savedAnalysisError}
                    />
                  )}
                  {analyses.length === 0 && (
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

                  {analyses.map((item) => (
                    <div className="message-row assistant-message" key={item.id}>
                      <Avatar className="ai-avatar">AI</Avatar>
                      <div className="assistant-bubble">
                        <AnalysisView response={item.analysis} onReviewSaved={refreshSavedAnalyses} />
                      </div>
                    </div>
                  ))}

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
                  <div className="composer analysis-action">
                    <Text type="secondary">
                      使用固定需求分析协议检查功能边界、业务规则、异常路径、缺失、歧义与冲突。
                    </Text>
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
                    单次最多 {MAX_FILES} 个文件 · 结论必须回链真实原文证据
                  </Text>
                </div>
              </section>

              <aside className="source-panel">
                <div>
                  <Title level={5}>分析资料</Title>
                  <Paragraph type="secondary">两类来源只在本次分析请求中使用，不建立复杂知识库。</Paragraph>
                </div>

                <UploadPanel
                  title="需求原始资料"
                  description="本次分析使用的 PRD 与截图"
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

                <Alert
                  type="info"
                  showIcon
                  message="统一文档解析"
                  description="PDF、Office、表格和图片统一由 Docling 解析 OCR、表格与版面；TestMesh 只保留上传、文件哈希和原文引用。解析失败时不会切换到其他解析器。"
                />

                <Card size="small" className="boundary-card">
                  <Space direction="vertical" size={8}>
                    <Space>
                      <SafetyCertificateOutlined />
                      <Text strong>RA01 边界</Text>
                    </Space>
                    <Text type="secondary">只做需求分析；不执行 UI、API、APP、性能或安全测试。</Text>
                  </Space>
                </Card>
              </aside>
              </div>
            ) : activePage === "acceptance" ? (
              <AiAcceptance />
            ) : activePage === "project-config" ? (
              <QualityManagement />
            ) : activePage === "api" ? (
              <ApiTesting />
            ) : activePage === "ui" ? (
              <UiTesting />
            ) : activePage === "app" ? (
              <AppTesting />
            ) : activePage === "performance" ? (
              <PerformanceTesting />
            ) : (
              <SecurityTesting />
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
