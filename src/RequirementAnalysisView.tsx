import { CheckCircleOutlined, DownloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Flex, Space, Tag, Tooltip, Typography } from "antd";
import { useEffect, useState } from "react";
import { analysisSections, issueTypeLabels, locatorLabels, originLabels, renderAnalysisMarkdown } from "./analysis-report";
import type { AnalysisIssueType, AnalysisItem, AnalysisResponse } from "./types";
import RequirementReviewView from "./RequirementReviewView";

const { Text, Paragraph } = Typography;
type StoredSourceFile = { sourceFileId: string; filename: string; mimeType: string; sha256: string; provenance: string; storedAt: string };

function downloadMarkdown(response: AnalysisResponse): void {
  const markdown = renderAnalysisMarkdown(response.result);
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `需求分析报告-${response.analysisId}.md`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ItemCard({ item, response }: { item: AnalysisItem; response: AnalysisResponse }) {
  const byId = new Map(response.result.sources.map((source) => [source.id, source]));
  return (
    <Card size="small" className="result-card" key={item.id}>
      <Flex gap={8} wrap align="center">
        <Tag>{item.id}</Tag>
        <Tag color={item.origin === "explicit" ? "blue" : "purple"}>
          {originLabels[item.origin]}
        </Tag>
        {"issue_type" in item && <Tag color={item.issue_type === "conflict" ? "red" : item.issue_type === "missing" ? "orange" : "gold"}>
          {issueTypeLabels[item.issue_type as AnalysisIssueType]}
        </Tag>}
        <Text type="secondary">可信度 {Math.round(item.confidence * 100)}%</Text>
      </Flex>
      {item.description && <Paragraph className="analysis-item-description">{item.description}</Paragraph>}
      {"acceptance_criteria" in item && Array.isArray(item.acceptance_criteria) && item.acceptance_criteria.length > 0 && (
        <div className="criteria-list">
          <Text type="secondary">原文验收标准</Text>
          <ul>{item.acceptance_criteria.map((criterion: string, index: number) => <li key={`${index}-${criterion}`}>{criterion}</li>)}</ul>
        </div>
      )}
      {item.source_refs.length > 0 && (
        <Space size={[6, 6]} wrap>
          {item.source_refs.map((id) => {
            const source = byId.get(id);
            return (
              <Tooltip key={id} title={source ? `${source.source_file_name} · ${locatorLabels[source.locator_type]} ${source.locator} · ${source.excerpt || source.description}` : "原文引用不存在"}>
                <a href={`#analysis-source-${response.analysisId}-${id}`}><Tag color="geekblue">原文 {id}</Tag></a>
              </Tooltip>
            );
          })}
        </Space>
      )}
    </Card>
  );
}

export default function RequirementAnalysisView({ response }: { response: AnalysisResponse }) {
  const { result } = response;
  const [storedFiles, setStoredFiles] = useState<{ analysisId: string; files: StoredSourceFile[] }>();
  const [storedError, setStoredError] = useState<{ analysisId: string; message: string }>();
  useEffect(() => {
    let active = true;
    void fetch(`/api/analyses/${encodeURIComponent(response.analysisId)}/source-files`)
      .then(async (reply) => {
        if (!reply.ok) throw new Error(`原文件目录读取失败（HTTP ${reply.status}）`);
        return reply.json() as Promise<StoredSourceFile[]>;
      })
      .then((files) => { if (active) { setStoredFiles({ analysisId: response.analysisId, files }); setStoredError(undefined); } })
      .catch((error) => { if (active) setStoredError({ analysisId: response.analysisId, message: error instanceof Error ? error.message : "原文件目录读取失败" }); });
    return () => { active = false; };
  }, [response.analysisId]);
  const sourceFiles = storedFiles?.analysisId === response.analysisId ? storedFiles.files : [];
  const sourceFileError = storedError?.analysisId === response.analysisId ? storedError.message : undefined;
  const storedById = new Map(sourceFiles.map((file) => [file.sourceFileId, file]));
  return (
    <div className="analysis-result analysis-report">
      <Flex justify="space-between" align="center" gap={12} wrap>
        <Space><CheckCircleOutlined className="success-icon" /><Text strong>需求分析报告</Text><Tag color="blue">{response.model}</Tag></Space>
        <Button icon={<DownloadOutlined />} onClick={() => downloadMarkdown(response)}>导出 Markdown</Button>
      </Flex>
      <Text type="secondary">{response.usage ? `本次 ${response.usage.totalTokens.toLocaleString()} tokens · ` : ""}报告与导出均由同一份结构化数据生成</Text>
      {sourceFileError && <Alert type="warning" message={sourceFileError} showIcon />}
      <RequirementReviewView response={response} sourceFiles={sourceFiles} />
      <section><Typography.Title level={5}>需求概述</Typography.Title>
        {result.summary ? <ItemCard item={result.summary} response={response} /> : <Text type="secondary">暂无可确认的概述</Text>}
      </section>
      {analysisSections.map(([key, label]) => (
        <section key={key}>
          <Typography.Title level={5}>{label} <Text type="secondary">{result[key].length}</Text></Typography.Title>
          {result[key].length ? result[key].map((item) => <ItemCard key={item.id} item={item} response={response} />) : <Text type="secondary">暂无已识别内容</Text>}
        </section>
      ))}
      <section><Typography.Title level={5}>原文引用 <Text type="secondary">{result.sources.length}</Text></Typography.Title>
        {result.sources.length ? result.sources.map((source) => (
          <Card size="small" className="result-card" key={source.id}>
            <div id={`analysis-source-${response.analysisId}-${source.id}`}>
              <Flex gap={8} wrap align="center"><Tag color="geekblue">{source.id}</Tag><Text strong>{source.source_file_name}</Text><Tag>{locatorLabels[source.locator_type]}{source.locator ? ` ${source.locator}` : ""}</Tag></Flex>
              {storedById.has(source.source_file_id) ? <Space wrap>
                <a href={`/api/analyses/${encodeURIComponent(response.analysisId)}/source-files/${encodeURIComponent(source.source_file_id)}`} target="_blank" rel="noreferrer">查看原文件</a>
                {storedById.get(source.source_file_id)?.provenance === "backfilled_after_analysis" && <Text type="warning">分析后补录；仅确认文件名及来源编号吻合，无法证明当时使用的字节完全相同</Text>}
              </Space> : <Text type="secondary">未留存原文件；可查看上方摘录与定位</Text>}
              {source.excerpt && <blockquote>{source.excerpt}</blockquote>}
              {source.description && <Paragraph>{source.description}</Paragraph>}
            </div>
          </Card>
        )) : <Text type="secondary">暂无原文引用</Text>}
      </section>
    </div>
  );
}
