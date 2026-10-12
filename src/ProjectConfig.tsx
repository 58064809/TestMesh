import { CloudServerOutlined, EditOutlined, PlusOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Form,
  Input,
  List,
  Modal,
  Row,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import TextArea from "antd/es/input/TextArea";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectEnvironmentRecord, ProjectRecord } from "./types";

const { Text, Title, Paragraph } = Typography;

type ProjectForm = { name: string; code: string; description: string };
type EnvironmentForm = { name: string; baseUrl: string; headersText: string };

function headersToText(headers: Array<{ name: string; value: string }>): string {
  return headers.map((header) => `${header.name}: ${header.value}`).join("\n");
}

function parseHeaders(value: string): Array<{ name: string; value: string }> {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf(":");
    if (separator <= 0) throw new Error(`Header 格式错误：${line}`);
    return { name: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() };
  });
}

export default function ProjectConfig() {
  const { message } = AntdApp.useApp();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [environmentModalOpen, setEnvironmentModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectRecord>();
  const [editingEnvironment, setEditingEnvironment] = useState<ProjectEnvironmentRecord>();
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [projectForm] = Form.useForm<ProjectForm>();
  const [environmentForm] = Form.useForm<EnvironmentForm>();

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId],
  );

  const refresh = useCallback(async (preferredProjectId?: string) => {
    const response = await fetch("/api/projects", { cache: "no-store" });
    const body = (await response.json()) as ProjectRecord[] | { error?: string };
    if (!response.ok) throw new Error("error" in body ? body.error ?? "项目配置加载失败" : "项目配置加载失败");
    const next = body as ProjectRecord[];
    setProjects(next);
    setSelectedProjectId((current) => {
      const preferred = preferredProjectId || current;
      return next.some((item) => item.id === preferred) ? preferred : next[0]?.id ?? "";
    });
  }, []);

  useEffect(() => {
    void fetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`项目配置加载失败（HTTP ${response.status}）`);
        return (await response.json()) as ProjectRecord[];
      })
      .then((next) => {
        setProjects(next);
        setSelectedProjectId(next[0]?.id ?? "");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "项目配置加载失败"))
      .finally(() => setInitialLoading(false));
  }, []);

  function openProject(project?: ProjectRecord) {
    setEditingProject(project);
    projectForm.setFieldsValue(project ? { name: project.name, code: project.code, description: project.description } : { name: "", code: "", description: "" });
    setProjectModalOpen(true);
  }

  function openEnvironment(environment?: ProjectEnvironmentRecord) {
    setEditingEnvironment(environment);
    environmentForm.setFieldsValue(environment ? {
      name: environment.name,
      baseUrl: environment.baseUrl,
      headersText: headersToText(environment.headers),
    } : { name: "", baseUrl: "", headersText: "" });
    setEnvironmentModalOpen(true);
  }

  async function saveProject() {
    const values = await projectForm.validateFields();
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(editingProject ? `/api/projects/${editingProject.id}` : "/api/projects", {
        method: editingProject ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = (await response.json()) as ProjectRecord | { error?: string };
      if (!response.ok) throw new Error("error" in body ? body.error ?? "项目保存失败" : "项目保存失败");
      const saved = body as ProjectRecord;
      await refresh(saved.id);
      setProjectModalOpen(false);
      message.success(editingProject ? "项目已更新" : "项目已创建");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "项目保存失败");
    } finally {
      setLoading(false);
    }
  }

  async function saveEnvironment() {
    if (!selectedProject) return;
    const values = await environmentForm.validateFields();
    setLoading(true);
    setError(undefined);
    try {
      const payload = {
        name: values.name,
        baseUrl: values.baseUrl,
        headers: parseHeaders(values.headersText || ""),
      };
      const url = editingEnvironment
        ? `/api/projects/${selectedProject.id}/environments/${editingEnvironment.id}`
        : `/api/projects/${selectedProject.id}/environments`;
      const response = await fetch(url, {
        method: editingEnvironment ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as ProjectEnvironmentRecord | { error?: string };
      if (!response.ok) throw new Error("error" in body ? body.error ?? "环境保存失败" : "环境保存失败");
      await refresh(selectedProject.id);
      setEnvironmentModalOpen(false);
      message.success(editingEnvironment ? "环境已更新" : "环境已创建");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "环境保存失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="project-config-page">
      <Space direction="vertical" size={16} className="project-config-stack">
        <Alert
          type="info"
          showIcon
          icon={<SafetyCertificateOutlined />}
          message="TestMesh 只保存项目归属与非敏感测试环境信息"
          description="Token、密码、Cookie、API Key 不会保存。当前执行时临时输入；团队部署后可接入 Infisical，复用其项目、环境、版本和审计能力。"
        />
        {error && <Alert type="error" showIcon message="操作未完成" description={error} closable onClose={() => setError(undefined)} />}
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={8}>
            <Card loading={initialLoading} title="项目" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openProject()}>新建项目</Button>}>
              {projects.length === 0 ? (
                <Empty description="还没有项目配置" image={Empty.PRESENTED_IMAGE_SIMPLE}>
                  <Button type="primary" onClick={() => openProject()}>创建第一个项目</Button>
                </Empty>
              ) : (
                <Select
                  className="project-config-select"
                  value={selectedProjectId}
                  onChange={setSelectedProjectId}
                  options={projects.map((project) => ({ value: project.id, label: `${project.name} · ${project.code}` }))}
                />
              )}
              {selectedProject && (
                <div className="project-summary">
                  <Flex justify="space-between" align="flex-start" gap={12}>
                    <div>
                      <Title level={4}>{selectedProject.name}</Title>
                      <Tag>{selectedProject.code}</Tag>
                    </div>
                    <Button icon={<EditOutlined />} onClick={() => openProject(selectedProject)}>编辑</Button>
                  </Flex>
                  <Paragraph type="secondary">{selectedProject.description || "暂无项目说明"}</Paragraph>
                  <Text type="secondary">项目 ID：{selectedProject.id}</Text>
                </div>
              )}
            </Card>
          </Col>
          <Col xs={24} lg={16}>
            <Card
              loading={initialLoading}
              title={<Space><CloudServerOutlined />测试环境</Space>}
              extra={<Button type="primary" icon={<PlusOutlined />} disabled={!selectedProject} onClick={() => openEnvironment()}>新增环境</Button>}
            >
              {!selectedProject || selectedProject.environments.length === 0 ? (
                <Empty description={selectedProject ? "该项目还没有测试环境" : "请先创建项目"} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <List
                  dataSource={selectedProject.environments}
                  renderItem={(environment) => (
                    <List.Item actions={[<Button key="edit" type="link" icon={<EditOutlined />} onClick={() => openEnvironment(environment)}>编辑</Button>] }>
                      <List.Item.Meta
                        title={<Space>{environment.name}<Tag color="blue">非敏感配置</Tag></Space>}
                        description={<Space direction="vertical" size={2}>
                          <Text code>{environment.baseUrl}</Text>
                          <Text type="secondary">{environment.headers.length} 条公共 Header · 凭据在运行时临时提供</Text>
                        </Space>}
                      />
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </Col>
        </Row>
      </Space>

      <Modal title={editingProject ? "编辑项目" : "新建项目"} open={projectModalOpen} onCancel={() => setProjectModalOpen(false)} onOk={() => void saveProject()} okText="保存" cancelText="取消" confirmLoading={loading} destroyOnHidden>
        <Form form={projectForm} layout="vertical">
          <Form.Item label="项目名称" name="name" rules={[{ required: true, message: "请填写项目名称" }]}><Input placeholder="例如：AI 售后系统" /></Form.Item>
          <Form.Item label="项目标识" name="code" rules={[{ required: true, message: "请填写项目标识" }, { pattern: /^[a-z0-9][a-z0-9_-]{1,31}$/, message: "使用 2-32 位小写字母、数字、下划线或短横线" }]}><Input placeholder="例如：ai-after-sales" /></Form.Item>
          <Form.Item label="项目说明" name="description"><TextArea rows={3} placeholder="说明业务范围和测试目标" /></Form.Item>
        </Form>
      </Modal>

      <Modal title={editingEnvironment ? "编辑测试环境" : "新增测试环境"} open={environmentModalOpen} onCancel={() => setEnvironmentModalOpen(false)} onOk={() => void saveEnvironment()} okText="保存" cancelText="取消" confirmLoading={loading} destroyOnHidden>
        <Form form={environmentForm} layout="vertical">
          <Form.Item label="环境名称" name="name" rules={[{ required: true, message: "请填写环境名称" }]}><Input placeholder="例如：测试环境" /></Form.Item>
          <Form.Item label="Base URL" name="baseUrl" rules={[{ required: true, message: "请填写 Base URL" }, { type: "url", message: "请填写完整的 HTTP/HTTPS 地址" }]}><Input placeholder="例如：http://127.0.0.1:8080" /></Form.Item>
          <Form.Item label="公共 Header" name="headersText" extra="每行一条 Name: Value。Authorization、Cookie、Token、API Key 等敏感信息会被拒绝保存。">
            <TextArea rows={4} placeholder={"例如：\nX-Tenant-ID: demo\nAccept-Language: zh-CN"} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
