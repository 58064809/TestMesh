import { DownloadOutlined, FileDoneOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Flex, Input, Modal, Segmented, Select, Space, Tag, Tooltip, Typography, Upload, type UploadFile } from "antd";
import { useEffect, useMemo, useState } from "react";
import { renderReviewMarkdown, reviewEntries, unresolvedDecisionEntries, visibleReviewEntries, type ReviewEntry, type ReviewView } from "./review-report";
import { issueTypeLabels, locatorLabels } from "./analysis-report";
import { pdfPageRange, sourceFileUrl, visualEvidence } from "./evidence-preview";
import type { AnalysisResponse, AnalysisReviewRecord, AnalysisReviewStatus, AnalysisIssueType, RequirementBaselineRecord } from "./types";

const { Text, Paragraph } = Typography;
const reviewStatusLabels: Record<AnalysisReviewStatus, string> = {
  accepted: "接受", rejected: "驳回", merged: "合并", clarify: "待澄清",
};
type ReviewDraft = Omit<AnalysisReviewRecord, "id" | "analysisId" | "itemId" | "createdAt">;
const emptyDraft: ReviewDraft = {
  status: "accepted", reviewer: "", reason: "", evidenceChecked: false,
  issueType: "", mergeInto: "", decision: "", decisionBy: "", prdRevision: "",
};

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `请求失败（HTTP ${response.status}）`);
  return body;
}

function downloadMarkdown(filename: string, markdown: string): void {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function requiredLabel(label: string) {
  return <Text><Text type="danger">*</Text> {label}</Text>;
}

type StoredSourceFile = { sourceFileId: string; mimeType: string; provenance: string };

export default function RequirementReviewView({ response, sourceFiles }: { response: AnalysisResponse; sourceFiles: StoredSourceFile[] }) {
  const [reviews, setReviews] = useState<AnalysisReviewRecord[]>([]);
  const [baselines, setBaselines] = useState<RequirementBaselineRecord[]>([]);
  const [view, setView] = useState<ReviewView>("pending");
  const [selected, setSelected] = useState<ReviewEntry>();
  const [preview, setPreview] = useState<{ sourceId: string; page: number }>();
  const [draft, setDraft] = useState<ReviewDraft>(emptyDraft);
  const [baselineOpen, setBaselineOpen] = useState(false);
  const [baselineRevision, setBaselineRevision] = useState("");
  const [baselineApprover, setBaselineApprover] = useState("");
  const [previousBaselineId, setPreviousBaselineId] = useState("");
  const [reviewedPrd, setReviewedPrd] = useState<UploadFile[]>([]);
  const [baselineSnapshot, setBaselineSnapshot] = useState<{ record: RequirementBaselineRecord; accepted: Array<{ section: string; item: { id: string; description: string }; review: AnalysisReviewRecord }> }>();
  const [history, setHistory] = useState<{ itemId: string; events: AnalysisReviewRecord[] }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch(`/api/analyses/${encodeURIComponent(response.analysisId)}/reviews`).then((res) => readJson<AnalysisReviewRecord[]>(res)),
      fetch("/api/requirement-baselines").then((res) => readJson<RequirementBaselineRecord[]>(res)),
    ]).then(([loadedReviews, loadedBaselines]) => {
      if (active) { setReviews(loadedReviews); setBaselines(loadedBaselines); setError(undefined); }
    }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "评审资料读取失败"); });
    return () => { active = false; };
  }, [response.analysisId]);

  const entries = useMemo(() => reviewEntries(response.result, reviews), [response.result, reviews]);
  const pending = visibleReviewEntries(entries, "pending");
  const accepted = visibleReviewEntries(entries, "accepted");
  const visible = visibleReviewEntries(entries, view);
  const unresolvedDecisions = unresolvedDecisionEntries(entries);
  const currentBaseline = baselines.find((item) => item.analysisId === response.analysisId);
  const baselineBlockedReason = currentBaseline
    ? `已建立需求基线 v${currentBaseline.version}`
    : pending.length > 0
      ? `还有 ${pending.length} 条内容未完成评审`
      : unresolvedDecisions.length > 0
        ? `还有 ${unresolvedDecisions.length} 条待确认问题未回写完整决策`
        : undefined;
  const sources = new Map(response.result.sources.map((source) => [source.id, source]));
  const storedById = new Map(sourceFiles.map((file) => [file.sourceFileId, file]));

  function updateDraft(changes: Partial<ReviewDraft>) { setDraft((current) => ({ ...current, ...changes })); }

  function openReview(entry: ReviewEntry) {
    setSelected(entry);
    const firstVisual = entry.item.source_refs.map((id) => sources.get(id)).find((source) => {
      const file = source && storedById.get(source.source_file_id);
      return source && file && visualEvidence(source, file.mimeType);
    });
    const firstFile = firstVisual && storedById.get(firstVisual.source_file_id);
    const firstPreview = firstVisual && firstFile && visualEvidence(firstVisual, firstFile.mimeType);
    setPreview(firstVisual && firstPreview ? { sourceId: firstVisual.id, page: firstPreview.pages?.start ?? 1 } : undefined);
    setDraft(entry.review ? {
      status: entry.review.status, reviewer: entry.review.reviewer, reason: entry.review.reason,
      evidenceChecked: entry.review.evidenceChecked, issueType: entry.review.issueType,
      mergeInto: entry.review.mergeInto, decision: entry.review.decision,
      decisionBy: entry.review.decisionBy, prdRevision: entry.review.prdRevision,
    } : { ...emptyDraft });
    setError(undefined);
  }

  async function saveReview() {
    if (!selected) return;
    setSaving(true);
    setError(undefined);
    try {
      await readJson<AnalysisReviewRecord>(await fetch(
        `/api/analyses/${encodeURIComponent(response.analysisId)}/reviews/${encodeURIComponent(selected.item.id)}`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) },
      ));
      setReviews(await readJson<AnalysisReviewRecord[]>(await fetch(`/api/analyses/${encodeURIComponent(response.analysisId)}/reviews`)));
      setSelected(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "评审保存失败");
    } finally { setSaving(false); }
  }

  async function createBaseline() {
    const file = reviewedPrd[0]?.originFileObj;
    if (!file) { setError("请上传评审后获批的 PRD"); return; }
    setSaving(true);
    setError(undefined);
    try {
      const data = new FormData();
      data.append("reviewedPrd", file, file.name);
      data.append("prdRevision", baselineRevision.trim());
      data.append("approvedBy", baselineApprover.trim());
      if (previousBaselineId) data.append("previousBaselineId", previousBaselineId);
      await readJson<RequirementBaselineRecord>(await fetch(`/api/analyses/${encodeURIComponent(response.analysisId)}/baselines`, { method: "POST", body: data }));
      setBaselines(await readJson<RequirementBaselineRecord[]>(await fetch("/api/requirement-baselines")));
      setBaselineOpen(false);
      setReviewedPrd([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法建立基线");
    } finally { setSaving(false); }
  }

  async function openBaseline(id: string) {
    try {
      const loaded = await readJson<RequirementBaselineRecord & { snapshot: { accepted: Array<{ section: string; item: { id: string; description: string }; review: AnalysisReviewRecord }> } }>(
        await fetch(`/api/requirement-baselines/${encodeURIComponent(id)}`),
      );
      const { snapshot, ...record } = loaded;
      setBaselineSnapshot({ record, accepted: snapshot.accepted });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "基线读取失败"); }
  }

  async function openHistory(itemId: string) {
    try {
      const events = await readJson<AnalysisReviewRecord[]>(await fetch(
        `/api/analyses/${encodeURIComponent(response.analysisId)}/reviews/${encodeURIComponent(itemId)}/history`,
      ));
      setHistory({ itemId, events });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "评审历史读取失败"); }
  }

  return (
    <Card size="small" className="requirement-review" title={<Space><FileDoneOutlined />人工评审与需求基线</Space>}>
      <Paragraph type="secondary">AI 原始分析保持不变；这里记录人工去留和业务决策。不同文件规则冲突时默认不设来源优先级，查看双方原文后由产品决策；如决定“PRD 优先”，请将适用范围写入决策和获批 PRD。待评审视图隐藏已接受、驳回和合并的条目。</Paragraph>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      {unresolvedDecisions.length > 0 && <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message={`${unresolvedDecisions.length} 条待确认问题尚未回写完整决策`}
        description={<Space direction="vertical" size={4}>
          <Text>进入需求基线前，请登记正式评审决策、决策人和回写的 PRD 版本。点击问题编号可直接处理。</Text>
          <Space size={[8, 4]} wrap>{unresolvedDecisions.map((entry) => <Button key={entry.item.id} type="link" size="small" style={{ paddingInline: 0 }} onClick={() => openReview(entry)}>处理 {entry.item.id}</Button>)}</Space>
        </Space>}
      />}
      <Flex gap={8} wrap align="center" justify="space-between">
        <Space wrap>
          <Tag color="orange">待评审 {pending.length}</Tag>
          <Tag color="green">已接受 {accepted.length}</Tag>
          <Tag>总计 {entries.length}</Tag>
          {currentBaseline && <Tag color="blue">基线 v{currentBaseline.version} · 已冻结</Tag>}
        </Space>
        <Space wrap>
          <Button icon={<DownloadOutlined />} onClick={() => downloadMarkdown(`待评审清单-${response.analysisId}.md`, renderReviewMarkdown(response.result, reviews, "pending"))}>导出待评审清单</Button>
          <Button icon={<DownloadOutlined />} onClick={() => downloadMarkdown(`已接受需求分析-${response.analysisId}.md`, renderReviewMarkdown(response.result, reviews, "accepted"))}>导出已接受报告</Button>
          <Tooltip title={baselineBlockedReason}><span><Button type="primary" disabled={Boolean(baselineBlockedReason)} onClick={() => setBaselineOpen(true)}>建立需求基线</Button></span></Tooltip>
        </Space>
      </Flex>
      <Segmented style={{ marginTop: 14, marginBottom: 12 }} value={view} onChange={(value) => setView(value as ReviewView)} options={[
        { label: "待评审", value: "pending" }, { label: "已接受", value: "accepted" }, { label: "全部记录", value: "all" },
      ]} />
      {visible.length ? visible.map((entry) => (
        <Card size="small" key={entry.item.id} className="result-card">
          <Flex justify="space-between" gap={8} wrap align="center">
            <Space wrap><Tag>{entry.item.id}</Tag><Text strong>{entry.label}</Text>{"issue_type" in entry.item && <Tag color="gold">AI 分类：{issueTypeLabels[entry.item.issue_type as AnalysisIssueType]}</Tag>}<Tag color={entry.review?.status === "accepted" ? "green" : entry.review?.status === "rejected" ? "red" : "orange"}>{entry.review ? reviewStatusLabels[entry.review.status] : "待评审"}</Tag>{entry.review?.issueType && <Tag>人工分类：{issueTypeLabels[entry.review.issueType]}</Tag>}</Space>
            <Space><Button size="small" onClick={() => void openHistory(entry.item.id)}>查看历史</Button><Button size="small" disabled={Boolean(currentBaseline)} onClick={() => openReview(entry)}>评审</Button></Space>
          </Flex>
          <Paragraph style={{ marginTop: 8, marginBottom: 6 }}>{entry.item.description}</Paragraph>
          <Space size={[6, 6]} wrap>
            {entry.item.source_refs.map((id) => {
              const source = sources.get(id);
              return <Tooltip key={id} title={source ? `${source.source_file_name} · ${locatorLabels[source.locator_type]} ${source.locator} · ${source.excerpt || source.description}` : "引用不存在"}><a href={`#analysis-source-${response.analysisId}-${id}`}><Tag color="geekblue">原文 {id}</Tag></a></Tooltip>;
            })}
          </Space>
          {entry.review?.decision && <Paragraph type="secondary" style={{ marginTop: 8 }}>决策：{entry.review.decision} · {entry.review.decisionBy} · PRD {entry.review.prdRevision}</Paragraph>}
          {entry.review?.reason && <Text type="secondary">评审理由：{entry.review.reason}</Text>}
        </Card>
      )) : <Empty description={view === "pending" ? "没有待评审条目" : "此视图暂无条目"} />}

      {baselines.length > 0 && <section style={{ marginTop: 14 }}><Text strong>基线版本</Text><Space size={[8, 8]} wrap style={{ marginTop: 8 }}>
        {baselines.map((item) => <Card key={item.id} size="small"><Space direction="vertical" size={3}>
          <Text>v{item.version} · {item.prdRevision} · {item.prdFilename}</Text>
          <Text type="secondary">登记批准人：{item.approvedBy} · {new Date(item.approvedAt).toLocaleString("zh-CN")}</Text>
          <Space><Button size="small" onClick={() => void openBaseline(item.id)}>查看冻结内容</Button><a href={`/api/requirement-baselines/${encodeURIComponent(item.id)}/prd`} download><Button size="small">下载获批 PRD</Button></a></Space>
        </Space></Card>)}
      </Space></section>}

      <Modal title={`人工评审 · ${selected?.item.id ?? ""}`} open={Boolean(selected)} onCancel={() => setSelected(undefined)} onOk={() => void saveReview()} okText="保存评审" confirmLoading={saving} destroyOnHidden width={920} style={{ maxWidth: "calc(100vw - 24px)" }}>
        {selected && <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Paragraph>{selected.item.description}</Paragraph>
          {"issue_type" in selected.item && <Tag color="gold">AI 问题分类：{issueTypeLabels[selected.item.issue_type as AnalysisIssueType]}</Tag>}
          {selected.item.source_refs.length > 0 && <><Text strong>关联原文（先核对原文件和图片，再登记接受）</Text>
            {selected.item.source_refs.map((id) => {
              const source = sources.get(id);
              if (!source) return <Alert key={id} type="warning" message={`原文 ${id} 不存在`} />;
              const file = storedById.get(source.source_file_id);
              const visual = file && visualEvidence(source, file.mimeType);
              const fileUrl = sourceFileUrl(response.analysisId, source.source_file_id);
              const pageRange = file?.mimeType === "application/pdf" ? pdfPageRange(source.locator) : undefined;
              const active = preview?.sourceId === id;
              const activePage = active ? preview?.page : undefined;
              const currentPage = activePage ?? pageRange?.start;
              const openUrl = pageRange && currentPage ? `${fileUrl}#page=${currentPage}` : fileUrl;
              return <Card size="small" key={id} className="review-evidence-card">
                <Text strong>{id} · {source.source_file_name} · {locatorLabels[source.locator_type]} {source.locator}</Text>
                <Paragraph style={{ marginBottom: 4 }}>{source.excerpt || source.description}</Paragraph>
                {file?.provenance === "backfilled_after_analysis" && <Text type="warning">原文件为分析后补录，无法确认与当时上传的文件字节完全一致。</Text>}
                <Space wrap>
                  {file ? <a href={openUrl} target="_blank" rel="noreferrer">{pageRange ? "在原文件中打开该页" : "打开原文件"}</a> : <Text type="warning">原文件未留存，暂不能预览</Text>}
                  {visual && !active && <Button size="small" onClick={() => setPreview({ sourceId: id, page: visual.pages?.start ?? 1 })}>查看图片证据</Button>}
                </Space>
                {visual && active && typeof activePage === "number" && <div className="review-evidence-preview">
                  {visual.kind === "image" ? <img src={fileUrl} alt={`${id} · ${source.source_file_name} 的图片证据`} /> : <>
                    <Flex align="center" gap={8} wrap>
                      <Text type="secondary">PDF 页面预览 · 第 {activePage} 页{visual.pages?.end !== visual.pages?.start ? `（引用范围 ${visual.pages?.start}-${visual.pages?.end} 页）` : ""}</Text>
                      {visual.pages && visual.pages.end > visual.pages.start && <Space size={4}>
                        <Button size="small" disabled={activePage <= visual.pages.start} onClick={() => setPreview({ sourceId: id, page: activePage - 1 })}>上一页</Button>
                        <Button size="small" disabled={activePage >= visual.pages.end} onClick={() => setPreview({ sourceId: id, page: activePage + 1 })}>下一页</Button>
                      </Space>}
                    </Flex>
                    <iframe key={`${id}-${activePage}`} title={`${id} · PDF 第 ${activePage} 页证据预览`} src={`${fileUrl}#page=${activePage}`} loading="lazy" />
                    <Text type="secondary">预览显示整页，图形未自动裁剪或高亮；请结合上方原文定位核对。</Text>
                  </>}
                </div>}
              </Card>;
            })}</>}
          <Text>评审人（选填）</Text><Input value={draft.reviewer} onChange={(event) => updateDraft({ reviewer: event.target.value })} placeholder="需要留痕时填写" />
          {requiredLabel("处理结果")}<Select value={draft.status} onChange={(status: AnalysisReviewStatus) => updateDraft({ status, mergeInto: status === "merged" ? draft.mergeInto : "" })} options={Object.entries(reviewStatusLabels).map(([value, label]) => ({ value, label }))} />
          {draft.status === "merged" && <>{requiredLabel("合并到")}<Select value={draft.mergeInto || undefined} onChange={(mergeInto) => updateDraft({ mergeInto })} placeholder="选择同类条目" options={entries.filter((entry) => entry.section === selected.section && entry.item.id !== selected.item.id).map((entry) => ({ value: entry.item.id, label: `${entry.item.id} · ${entry.item.description.slice(0, 30)}` }))} /></>}
          <Text>理由或补充说明（选填）</Text><Input.TextArea value={draft.reason} onChange={(event) => updateDraft({ reason: event.target.value })} rows={2} />
          {selected.section === "open_questions" && <>
            {draft.status === "accepted" ? requiredLabel("问题类型（人工复核，不改写 AI issue_type）") : <Text>问题类型（人工复核，不改写 AI issue_type）</Text>}<Select value={draft.issueType || undefined} onChange={(issueType: AnalysisIssueType) => updateDraft({ issueType })} placeholder="选择缺失、歧义或冲突" options={Object.entries(issueTypeLabels).map(([value, label]) => ({ value, label }))} />
            {draft.status === "accepted" && <>
              {requiredLabel("正式评审决策（进入基线前填写）")}<Input.TextArea value={draft.decision} onChange={(event) => updateDraft({ decision: event.target.value })} rows={2} placeholder="记录产品、开发和测试讨论后的最终规则" />
              {requiredLabel("决策人（进入基线前填写）")}<Input value={draft.decisionBy} onChange={(event) => updateDraft({ decisionBy: event.target.value })} />
              {requiredLabel("回写到哪版 PRD（进入基线前填写）")}<Input value={draft.prdRevision} onChange={(event) => updateDraft({ prdRevision: event.target.value })} placeholder="例如 v1.1" />
              <Text type="secondary">尚未形成结论时可先选择“待澄清”；确认问题不成立时选择“驳回”。</Text>
            </>}
          </>}
        </Space>}
      </Modal>

      <Modal title="建立需求基线" open={baselineOpen} onCancel={() => setBaselineOpen(false)} onOk={() => void createBaseline()} okText="冻结基线" confirmLoading={saving} destroyOnHidden>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert type="info" showIcon message="先由产品修订并批准 PRD，再上传获批版本。基线冻结后不覆盖；发生变更时重新上传新 PRD 生成新分析，并关联前一基线。" />
          {requiredLabel("获批 PRD 修订标识")}<Input value={baselineRevision} onChange={(event) => setBaselineRevision(event.target.value)} placeholder="例如 v1.0" />
          {requiredLabel("登记批准人")}<Input value={baselineApprover} onChange={(event) => setBaselineApprover(event.target.value)} placeholder="产品负责人" />
          <Text>前一基线（首次建立可留空）</Text><Select allowClear value={previousBaselineId || undefined} onChange={(value) => setPreviousBaselineId(value ?? "")} options={baselines.map((item) => ({ value: item.id, label: `v${item.version} · ${item.prdRevision} · ${item.prdFilename}` }))} />
          {requiredLabel("上传评审后获批的 PRD 文件")}<Upload accept=".pdf,.doc,.docx,.rtf,.odt,.md,.txt,.html,.htm" beforeUpload={() => false} maxCount={1} fileList={reviewedPrd} onChange={({ fileList }) => setReviewedPrd(fileList.slice(-1))}><Button>选择获批 PRD</Button></Upload>
        </Space>
      </Modal>

      <Modal title={`需求基线 v${baselineSnapshot?.record.version ?? ""}`} open={Boolean(baselineSnapshot)} onCancel={() => setBaselineSnapshot(undefined)} footer={null} width={760}>
        {baselineSnapshot && <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Text>获批 PRD：{baselineSnapshot.record.prdFilename} · {baselineSnapshot.record.prdRevision}</Text>
          <Text type="secondary">文件 SHA-256：{baselineSnapshot.record.prdSha256}</Text>
          {baselineSnapshot.accepted.map((entry) => <Card size="small" key={entry.item.id}><Text strong>{entry.item.id} · {entry.section}</Text><Paragraph>{entry.item.description}</Paragraph>{"issue_type" in entry.item && <Tag color="gold">AI 分类：{issueTypeLabels[entry.item.issue_type as AnalysisIssueType]}</Tag>}{entry.review.issueType && <Tag color="blue">人工分类：{issueTypeLabels[entry.review.issueType]}</Tag>}{entry.review.decision && <Text>最终决策：{entry.review.decision}</Text>}</Card>)}
        </Space>}
      </Modal>

      <Modal title={`评审历史 · ${history?.itemId ?? ""}`} open={Boolean(history)} onCancel={() => setHistory(undefined)} footer={null}>
        {history && (history.events.length ? <Space direction="vertical" style={{ width: "100%" }}>
          {history.events.map((event) => <Card size="small" key={event.id}>
            <Space wrap><Tag>{reviewStatusLabels[event.status]}</Tag><Text>{event.reviewer}</Text><Text type="secondary">{new Date(event.createdAt).toLocaleString("zh-CN")}</Text></Space>
            {event.reason && <Paragraph>理由：{event.reason}</Paragraph>}
            {event.decision && <Paragraph>决策：{event.decision} · {event.decisionBy} · PRD {event.prdRevision}</Paragraph>}
            <Text type="secondary">原文核对：{event.evidenceChecked ? "已登记核对" : "未登记核对"}</Text>
          </Card>)}
        </Space> : <Empty description="尚无评审记录" />)}
      </Modal>
    </Card>
  );
}
