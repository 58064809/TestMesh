import { DownloadOutlined, FileDoneOutlined } from "@ant-design/icons";
import { Alert, App as AntdApp, Button, Card, Empty, Flex, Input, Modal, Segmented, Select, Space, Tabs, Tag, Tooltip, Typography, Upload, type UploadFile } from "antd";
import { useEffect, useMemo, useState } from "react";
import { mergedSourceEntries, renderReviewMarkdown, reviewEntries, unresolvedDecisionEntries, visibleReviewEntries, type ReviewEntry, type ReviewView } from "./review-report";
import { issueTypeLabels, locatorLabels } from "./analysis-report";
import { pdfPageRange, sourceFileUrl, visualEvidence } from "./evidence-preview";
import DecisionMarkdown from "./DecisionMarkdown";
import { PENDING_PRD_REVISION, type AnalysisAmendmentRecord, type AnalysisResponse, type AnalysisReviewRecord, type AnalysisReviewStatus, type AnalysisIssueType, type RequirementBaselineRecord } from "./types";

const { Text, Paragraph } = Typography;
const reviewStatusLabels: Record<AnalysisReviewStatus, string> = {
  accepted: "接受", rejected: "驳回", merged: "合并", clarify: "待澄清",
};
type ReviewDraft = Omit<AnalysisReviewRecord, "id" | "analysisId" | "itemId" | "createdAt">;
type ReviewField = "status" | "mergeInto" | "issueType" | "decision" | "decisionBy" | "prdRevision";
type BaselineField = "revision" | "approver" | "previous" | "file";
type BaselineLineageMode = "first" | "revision";
const emptyDraft: ReviewDraft = {
  status: "accepted", reviewer: "", reason: "",
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

function fieldHint(message: string, error?: string) {
  return <Text type={error ? "danger" : "secondary"}>{error ?? message}</Text>;
}

type StoredSourceFile = { sourceFileId: string; mimeType: string; provenance: string };

export default function RequirementReviewView({ response, sourceFiles, onReviewSaved }: { response: AnalysisResponse; sourceFiles: StoredSourceFile[]; onReviewSaved?: () => Promise<void> | void }) {
  const { message: toast } = AntdApp.useApp();
  const [reviews, setReviews] = useState<AnalysisReviewRecord[]>([]);
  const [amendments, setAmendments] = useState<AnalysisAmendmentRecord[]>([]);
  const [baselines, setBaselines] = useState<RequirementBaselineRecord[]>([]);
  const [view, setView] = useState<ReviewView>("pending");
  const [selected, setSelected] = useState<ReviewEntry>();
  const [preview, setPreview] = useState<{ sourceId: string; page: number }>();
  const [draft, setDraft] = useState<ReviewDraft>(emptyDraft);
  const [baselineOpen, setBaselineOpen] = useState(false);
  const [baselineRevision, setBaselineRevision] = useState("");
  const [baselineApprover, setBaselineApprover] = useState("");
  const [previousBaselineId, setPreviousBaselineId] = useState("");
  const [baselineLineageMode, setBaselineLineageMode] = useState<BaselineLineageMode>("first");
  const [reviewedPrd, setReviewedPrd] = useState<UploadFile[]>([]);
  const [baselineSnapshot, setBaselineSnapshot] = useState<{ record: RequirementBaselineRecord; accepted: Array<{ section: string; item: { id: string; description: string }; review: AnalysisReviewRecord }> }>();
  const [history, setHistory] = useState<{ itemId: string; events: AnalysisReviewRecord[] }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [reviewErrors, setReviewErrors] = useState<Partial<Record<ReviewField, string>>>({});
  const [amendedDescription, setAmendedDescription] = useState("");
  const [amendedSourceRefs, setAmendedSourceRefs] = useState<string[]>([]);
  const [baselineErrors, setBaselineErrors] = useState<Partial<Record<BaselineField, string>>>({});

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch(`/api/analyses/${encodeURIComponent(response.analysisId)}/reviews`).then((res) => readJson<AnalysisReviewRecord[]>(res)),
      fetch(`/api/analyses/${encodeURIComponent(response.analysisId)}/amendments`).then((res) => readJson<AnalysisAmendmentRecord[]>(res)),
      fetch("/api/requirement-baselines").then((res) => readJson<RequirementBaselineRecord[]>(res)),
    ]).then(([loadedReviews, loadedAmendments, loadedBaselines]) => {
      if (active) { setReviews(loadedReviews); setAmendments(loadedAmendments); setBaselines(loadedBaselines); setError(undefined); }
    }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "评审资料读取失败"); });
    return () => { active = false; };
  }, [response.analysisId]);

  const entries = useMemo(() => reviewEntries(response.result, reviews), [response.result, reviews]);
  const pending = visibleReviewEntries(entries, "pending");
  const accepted = visibleReviewEntries(entries, "accepted");
  const issues = visibleReviewEntries(entries, "issues");
  const visible = visibleReviewEntries(entries, view);
  const issueCounts = issues.reduce<Record<AnalysisIssueType, number>>((counts, entry) => {
    if ("issue_type" in entry.item) counts[entry.item.issue_type as AnalysisIssueType] += 1;
    return counts;
  }, { missing: 0, ambiguity: 0, conflict: 0 });
  const unresolvedDecisions = unresolvedDecisionEntries(entries);
  const analysisBaselines = baselines.filter((item) => item.analysisId === response.analysisId);
  const currentBaseline = analysisBaselines[0];
  const previousBaselineOptions = baselines
    .filter((item) => item.analysisId !== response.analysisId)
    .map((item) => ({
      value: item.id,
      label: `${item.prdRevision} · ${item.prdFilename} · ${item.approvedBy}`,
    }));
  const mergeTarget = draft.mergeInto ? entries.find((entry) => entry.item.id === draft.mergeInto) : undefined;
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

  function clearReviewError(field: ReviewField) {
    setReviewErrors((current) => ({ ...current, [field]: undefined }));
  }

  function clearBaselineError(field: BaselineField) {
    setBaselineErrors((current) => ({ ...current, [field]: undefined }));
  }

  function openReview(entry: ReviewEntry) {
    setSelected(entry);
    setAmendedDescription(entry.item.description);
    setAmendedSourceRefs([...entry.item.source_refs]);
    const firstVisual = entry.item.source_refs.map((id) => sources.get(id)).find((source) => {
      const file = source && storedById.get(source.source_file_id);
      return source && file && visualEvidence(source, file.mimeType);
    });
    const firstFile = firstVisual && storedById.get(firstVisual.source_file_id);
    const firstPreview = firstVisual && firstFile && visualEvidence(firstVisual, firstFile.mimeType);
    setPreview(firstVisual && firstPreview ? { sourceId: firstVisual.id, page: firstPreview.pages?.start ?? 1 } : undefined);
    setDraft(entry.review ? {
      status: entry.review.status, reviewer: entry.review.reviewer, reason: entry.review.reason,
      issueType: entry.review.issueType,
      mergeInto: entry.review.mergeInto, decision: entry.review.decision,
      decisionBy: entry.review.decisionBy, prdRevision: entry.review.prdRevision,
    } : { ...emptyDraft });
    setReviewErrors({});
    setError(undefined);
  }

  async function saveReview() {
    if (!selected) return;
    const validation: Partial<Record<ReviewField, string>> = {};
    if (!draft.status) validation.status = "请选择处理结果。";
    if (draft.status === "merged" && !draft.mergeInto) validation.mergeInto = "请选择要保留并继续处理的条目。";
    if (selected.section === "open_questions" && draft.status === "accepted") {
      if (!draft.issueType) validation.issueType = "请选择问题类型。";
      if (!draft.decision.trim()) validation.decision = "请填写最终确认的业务规则或处理结论。";
      if (!draft.decisionBy.trim()) validation.decisionBy = "请填写本次结论的决策人。";
      if (!(draft.prdRevision || PENDING_PRD_REVISION).trim()) validation.prdRevision = "请选择要回写的 PRD 版本。";
    }
    setReviewErrors(validation);
    if (Object.keys(validation).length > 0) return;
    setSaving(true);
    setError(undefined);
    try {
      const payload = selected.section === "open_questions" && draft.status === "accepted" && !draft.prdRevision
        ? { ...draft, prdRevision: PENDING_PRD_REVISION, amendment: { description: amendedDescription, sourceRefs: amendedSourceRefs } }
        : { ...draft, amendment: { description: amendedDescription, sourceRefs: amendedSourceRefs } };
      const savedReview = await readJson<AnalysisReviewRecord>(await fetch(
        `/api/analyses/${encodeURIComponent(response.analysisId)}/reviews/${encodeURIComponent(selected.item.id)}`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      ));
      setReviews((current) => [
        ...current.filter((review) => review.itemId !== savedReview.itemId),
        savedReview,
      ]);
      setSelected(undefined);
      setPreview(undefined);
      setView("pending");
      toast.success(`${savedReview.itemId} 已保存，评审列表和状态标签已刷新`);
      const [, refreshedReviews] = await Promise.all([
        onReviewSaved?.(),
        readJson<AnalysisReviewRecord[]>(await fetch(
          `/api/analyses/${encodeURIComponent(response.analysisId)}/reviews`,
          { cache: "no-store" },
        )),
      ]);
      setReviews(refreshedReviews);
      setAmendments(await readJson<AnalysisAmendmentRecord[]>(await fetch(`/api/analyses/${encodeURIComponent(response.analysisId)}/amendments`, { cache: "no-store" })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "评审保存失败");
    } finally { setSaving(false); }
  }

  async function createBaseline() {
    const file = reviewedPrd[0]?.originFileObj;
    const validation: Partial<Record<BaselineField, string>> = {};
    if (!baselineRevision.trim()) validation.revision = "请填写获批 PRD 的正式版本号。";
    if (!baselineApprover.trim()) validation.approver = "请填写实际批准该版本的负责人。";
    if (baselineLineageMode === "revision" && !previousBaselineId) validation.previous = "请选择同一业务的前一需求基线。";
    if (!file) validation.file = "请上传评审完成并已获批的 PRD 文件。";
    setBaselineErrors(validation);
    if (Object.keys(validation).length > 0 || !file) return;
    setSaving(true);
    setError(undefined);
    try {
      const data = new FormData();
      data.append("reviewedPrd", file, file.name);
      data.append("prdRevision", baselineRevision.trim());
      data.append("approvedBy", baselineApprover.trim());
      if (previousBaselineId) data.append("previousBaselineId", previousBaselineId);
      await readJson<RequirementBaselineRecord>(await fetch(`/api/analyses/${encodeURIComponent(response.analysisId)}/baselines`, { method: "POST", body: data }));
      const [, refreshedBaselines] = await Promise.all([
        onReviewSaved?.(),
        readJson<RequirementBaselineRecord[]>(await fetch("/api/requirement-baselines", { cache: "no-store" })),
      ]);
      setBaselines(refreshedBaselines);
      setBaselineOpen(false);
      setReviewedPrd([]);
      setBaselineRevision("");
      setBaselineApprover("");
      setPreviousBaselineId("");
      setBaselineLineageMode("first");
      setBaselineErrors({});
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
      <Paragraph type="secondary">AI 输出是候选稿；人工可在评审时修正内容和原文引用，系统保存修改前后 Diff 并重新校验。不同文件规则冲突时默认不设来源优先级，查看双方原文后由产品决策；冻结基线后不可覆盖。</Paragraph>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      {unresolvedDecisions.length > 0 && <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message={`${unresolvedDecisions.length} 条待确认问题尚未回写完整决策`}
        description={<Space direction="vertical" size={4}>
          <Text>进入需求基线前，请登记正式评审决策、决策人和回写的 PRD 版本。点击问题编号可直接处理。</Text>
          <Space size={[8, 4]} wrap>{unresolvedDecisions.map((entry) => {
            const mergedFrom = mergedSourceEntries(entries, entry.item.id).map(({ item }) => item.id);
            return <Button key={entry.item.id} type="link" size="small" style={{ paddingInline: 0 }} onClick={() => openReview(entry)}>处理 {entry.item.id}{mergedFrom.length ? `（已合并 ${mergedFrom.join("、")}）` : ""}</Button>;
          })}</Space>
        </Space>}
      />}
      <Flex gap={8} wrap align="center" justify="space-between">
        <Space wrap>
          <Tag color="orange">待评审 {pending.length}</Tag>
          <Tag color="green">已接受 {accepted.length}</Tag>
          <Tag color="gold">问题 {issues.length}</Tag>
          <Tag>总计 {entries.length}</Tag>
          {currentBaseline && <Tag color="blue">基线 v{currentBaseline.version} · 已冻结</Tag>}
        </Space>
        <Space wrap>
          <Button icon={<DownloadOutlined />} onClick={() => downloadMarkdown(`需求问题验收清单-${response.analysisId}.md`, renderReviewMarkdown(response.result, reviews, "issues"))}>导出问题清单</Button>
          <Button icon={<DownloadOutlined />} onClick={() => downloadMarkdown(`待评审清单-${response.analysisId}.md`, renderReviewMarkdown(response.result, reviews, "pending"))}>导出待评审清单</Button>
          <Button icon={<DownloadOutlined />} onClick={() => downloadMarkdown(`已接受需求分析-${response.analysisId}.md`, renderReviewMarkdown(response.result, reviews, "accepted"))}>导出已接受报告</Button>
          <Tooltip title={baselineBlockedReason}><span><Button type="primary" disabled={Boolean(baselineBlockedReason)} onClick={() => { setBaselineErrors({}); setBaselineOpen(true); }}>建立需求基线</Button></span></Tooltip>
        </Space>
      </Flex>
      <Segmented style={{ marginTop: 14, marginBottom: 12 }} value={view} onChange={(value) => setView(value as ReviewView)} options={[
        { label: `待评审 ${pending.length}`, value: "pending" }, { label: `只看问题 ${issues.length}`, value: "issues" }, { label: `已接受 ${accepted.length}`, value: "accepted" }, { label: `全部记录 ${entries.length}`, value: "all" },
      ]} />
      {view === "issues" && <Space size={[8, 6]} wrap style={{ marginBottom: 12 }}>
        <Tag color="orange">缺失 {issueCounts.missing}</Tag>
        <Tag color="gold">歧义 {issueCounts.ambiguity}</Tag>
        <Tag color="red">冲突 {issueCounts.conflict}</Tag>
      </Space>}
      {visible.length ? visible.map((entry) => (
        <Card size="small" key={entry.item.id} className="result-card">
          <Flex justify="space-between" gap={8} wrap align="center">
            <Space wrap><Tag>{entry.item.id}</Tag><Text strong>{entry.label}</Text>{"issue_type" in entry.item && <Tag color="gold">AI 分类：{issueTypeLabels[entry.item.issue_type as AnalysisIssueType]}</Tag>}<Tag color={entry.review?.status === "accepted" ? "green" : entry.review?.status === "rejected" ? "red" : "orange"}>{entry.review ? reviewStatusLabels[entry.review.status] : "待评审"}</Tag>{entry.review?.status === "merged" && <Tag color="blue">合并到 {entry.review.mergeInto}（目标保留）</Tag>}{entry.review?.issueType && <Tag>人工分类：{issueTypeLabels[entry.review.issueType]}</Tag>}</Space>
            <Space><Button size="small" onClick={() => void openHistory(entry.item.id)}>查看历史</Button><Button size="small" disabled={Boolean(currentBaseline)} onClick={() => openReview(entry)}>评审</Button></Space>
          </Flex>
          <Paragraph style={{ marginTop: 8, marginBottom: 6 }}>{entry.item.description}</Paragraph>
          <Space size={[6, 6]} wrap>
            {entry.item.source_refs.map((id) => {
              const source = sources.get(id);
              return <Tooltip key={id} title={source ? `${source.source_file_name} · ${locatorLabels[source.locator_type]} ${source.locator} · ${source.excerpt || source.description}` : "引用不存在"}><a href={`#analysis-source-${response.analysisId}-${id}`}><Tag color="geekblue">原文 {id}</Tag></a></Tooltip>;
            })}
          </Space>
          {entry.review?.decision && <div className="review-decision-block">
            <Text strong>正式评审决策</Text>
            <DecisionMarkdown value={entry.review.decision} compact />
            <Text type="secondary">决策人：{entry.review.decisionBy} · PRD {entry.review.prdRevision || PENDING_PRD_REVISION}</Text>
          </div>}
          {entry.review?.reason && <Text type="secondary">评审理由：{entry.review.reason}</Text>}
        </Card>
      )) : <Empty description={view === "pending" ? "没有待评审条目" : "此视图暂无条目"} />}

      {analysisBaselines.length > 0 && <section style={{ marginTop: 14 }}><Text strong>当前需求的基线版本</Text><Space size={[8, 8]} wrap style={{ marginTop: 8 }}>
        {analysisBaselines.map((item) => <Card key={item.id} size="small"><Space direction="vertical" size={3}>
          <Text>v{item.version} · {item.prdRevision} · {item.prdFilename}</Text>
          <Text type="secondary">登记批准人：{item.approvedBy} · {new Date(item.approvedAt).toLocaleString("zh-CN")}</Text>
          <Space><Button size="small" onClick={() => void openBaseline(item.id)}>查看冻结内容</Button><a href={`/api/requirement-baselines/${encodeURIComponent(item.id)}/prd`} download><Button size="small">下载获批 PRD</Button></a></Space>
        </Space></Card>)}
      </Space></section>}

      <Modal title={`人工评审 · ${selected?.item.id ?? ""}`} open={Boolean(selected)} onCancel={() => setSelected(undefined)} onOk={() => void saveReview()} okText="保存评审" confirmLoading={saving} destroyOnHidden width={920} style={{ maxWidth: "calc(100vw - 24px)" }}>
        {selected && <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {error && <Alert type="error" showIcon message="评审保存失败" description={error} />}
          <Paragraph>{selected.item.description}</Paragraph>
          <Alert type="info" showIcon message="可直接修正 AI 候选内容" description="保存时会校验来源 ID，并与评审作为同一次事务留痕；已冻结基线不可修改。修改内容时必须填写评审人和修改理由。" />
          {requiredLabel("问题描述（可修正 AI 识别结果）")}<Input.TextArea rows={4} value={amendedDescription} onChange={(event) => setAmendedDescription(event.target.value)} />
          <Text type="secondary">这里描述“缺少、歧义或冲突在哪里”，不是填写最终业务答案。</Text>
          <Text>保留的原文引用</Text><Select mode="multiple" value={amendedSourceRefs} onChange={setAmendedSourceRefs} options={response.result.sources.map((source) => ({ value: source.id, label: `${source.id} · ${source.source_file_name} · ${source.excerpt.slice(0, 48)}` }))} optionFilterProp="label" />
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
          {requiredLabel("处理结果")}<Select status={reviewErrors.status ? "error" : undefined} value={draft.status} onChange={(status: AnalysisReviewStatus) => { clearReviewError("status"); updateDraft({
            status,
            mergeInto: status === "merged" ? draft.mergeInto : "",
            ...(status === "accepted" ? {} : { decision: "", decisionBy: "", prdRevision: "" }),
          }); }} options={Object.entries(reviewStatusLabels).map(([value, label]) => ({ value, label }))} />
          {fieldHint("选择接受、驳回、合并或待澄清。", reviewErrors.status)}
          {draft.status === "merged" && <>
            {requiredLabel("合并到（保留项）")}<Select status={reviewErrors.mergeInto ? "error" : undefined} value={draft.mergeInto || undefined} onChange={(mergeInto) => { clearReviewError("mergeInto"); updateDraft({ mergeInto }); }} placeholder="选择保留并继续处理的同类条目" options={entries.filter((entry) => entry.section === selected.section && entry.item.id !== selected.item.id).map((entry) => ({ value: entry.item.id, label: `${entry.item.id} · ${entry.item.description.slice(0, 30)}` }))} />
            {fieldHint("选择承接当前内容和来源证据的保留项。", reviewErrors.mergeInto)}
            <Alert
              type="info"
              showIcon
              message={mergeTarget ? `${selected.item.id} 将合并到 ${mergeTarget.item.id}` : `${selected.item.id} 将不再单独处理`}
              description={mergeTarget
                ? `${mergeTarget.item.id} 作为保留项继续处理，承接 ${selected.item.id} 的来源证据，并负责回写一次最终决策。`
                : "请选择需要保留并继续处理的目标条目；当前条目保存后不再单独进入基线。"}
            />
          </>}
          <Text>理由或补充说明（选填）</Text><Input.TextArea value={draft.reason} onChange={(event) => updateDraft({ reason: event.target.value })} rows={2} />
          {selected.section === "open_questions" && <>
            {draft.status === "accepted" ? requiredLabel("问题类型（人工复核，不改写 AI issue_type）") : <Text>问题类型（人工复核，不改写 AI issue_type）</Text>}<Select status={reviewErrors.issueType ? "error" : undefined} value={draft.issueType || undefined} onChange={(issueType: AnalysisIssueType) => { clearReviewError("issueType"); updateDraft({ issueType }); }} placeholder="选择缺失、歧义或冲突" options={Object.entries(issueTypeLabels).map(([value, label]) => ({ value, label }))} />
            {draft.status === "accepted" && fieldHint("按人工复核结果选择缺失、歧义或冲突。", reviewErrors.issueType)}
            {draft.status === "accepted" && <>
              {requiredLabel("最终解决方案 / 业务规则（进入基线）")}
              <Alert type="info" showIcon message="这里填写问题的正式答案" description="支持 Markdown 长文本、标题、列表、表格和代码块。内容将作为需求基线中的正式产品决策，不要再次填写“尚未定义”。" />
              <Tabs size="small" items={[
                {
                  key: "edit",
                  label: "编辑 Markdown",
                  children: <Input.TextArea
                    className="review-decision-editor"
                    status={reviewErrors.decision ? "error" : undefined}
                    value={draft.decision}
                    onChange={(event) => { clearReviewError("decision"); updateDraft({ decision: event.target.value }); }}
                    autoSize={{ minRows: 12, maxRows: 28 }}
                    showCount
                    placeholder={"例如：\n\n## BR-001：推荐数量\n\n| 场景 | 正式规则 |\n| --- | --- |\n| 未指定数量 | 默认推荐 3 款 |\n| 数量超过 5 | 提示最多推荐 5 款，不执行查询 |"}
                  />,
                },
                {
                  key: "preview",
                  label: "格式预览",
                  children: draft.decision.trim()
                    ? <DecisionMarkdown value={draft.decision} />
                    : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="填写正式决策后可在这里预览" />,
                },
              ]} />
              {fieldHint("填写最终确认的业务规则、边界、状态或处理结论；表格请使用 Markdown 表格语法。", reviewErrors.decision)}
              {requiredLabel("决策人（进入基线前填写）")}<Input status={reviewErrors.decisionBy ? "error" : undefined} value={draft.decisionBy} onChange={(event) => { clearReviewError("decisionBy"); updateDraft({ decisionBy: event.target.value }); }} placeholder="例如：产品负责人张三" />
              {fieldHint("填写对该结论负责并完成确认的人。", reviewErrors.decisionBy)}
              {requiredLabel("回写到哪版 PRD")}<Select
                status={reviewErrors.prdRevision ? "error" : undefined}
                value={draft.prdRevision || PENDING_PRD_REVISION}
                onChange={(prdRevision) => { clearReviewError("prdRevision"); updateDraft({ prdRevision }); }}
                options={[
                  { value: PENDING_PRD_REVISION, label: `${PENDING_PRD_REVISION}（建立基线时统一填写版本号）` },
                  ...analysisBaselines.map((item) => ({
                    value: item.prdRevision,
                    label: `${item.prdRevision}（已冻结，不可回写）`,
                    disabled: true,
                  })),
                ]}
              />
              {fieldHint("如果还没有任何版本，保持“待建立的新版本”即可；冻结基线时再填写正式版本号。", reviewErrors.prdRevision)}
              <Text type="secondary">尚未形成结论时可先选择“待澄清”；确认问题不成立时选择“驳回”。</Text>
            </>}
          </>}
        </Space>}
      </Modal>

      <Modal title="建立需求基线" open={baselineOpen} onCancel={() => setBaselineOpen(false)} onOk={() => void createBaseline()} okText="冻结基线" confirmLoading={saving} destroyOnHidden width={680} style={{ maxWidth: "calc(100vw - 24px)" }}>
        <Space direction="vertical" size={16} className="baseline-form">
          <Alert type="info" showIcon message="上传产品负责人已确认的完整需求文件" description="模拟业务也需要真实的版本文件作为冻结证据。你可以上传《智能导购系统业务需求基线 V1.0》的 Markdown 或 TXT 文件。" />
          <div className="baseline-form-field">
            {requiredLabel("获批 PRD 修订标识")}
            <Input status={baselineErrors.revision ? "error" : undefined} value={baselineRevision} onChange={(event) => { clearBaselineError("revision"); setBaselineRevision(event.target.value); }} placeholder="例如：V1.0" />
            {fieldHint("填写获批文档中的正式版本号，例如 V1.0。", baselineErrors.revision)}
          </div>
          <div className="baseline-form-field">
            {requiredLabel("登记批准人")}
            <Input status={baselineErrors.approver ? "error" : undefined} value={baselineApprover} onChange={(event) => { clearBaselineError("approver"); setBaselineApprover(event.target.value); }} placeholder="例如：产品负责人路昭凡" />
            {fieldHint("填写实际确认并批准该需求版本的负责人。", baselineErrors.approver)}
          </div>
          <div className="baseline-form-field">
            <Text strong>版本关系</Text>
            <Segmented block value={baselineLineageMode} onChange={(value) => {
              const mode = value as BaselineLineageMode;
              setBaselineLineageMode(mode);
              clearBaselineError("previous");
              if (mode === "first") setPreviousBaselineId("");
            }} options={[{ label: "首次建立", value: "first" }, { label: "已有基线的后续版本", value: "revision" }]} />
            {baselineLineageMode === "first"
              ? <Alert type="success" showIcon message="这是该业务的第一份基线" description="前一基线保持为空，冻结后版本号从 v1 开始。" />
              : <>
                {requiredLabel("选择同一业务的前一基线")}
                <Select
                  allowClear
                  showSearch
                  status={baselineErrors.previous ? "error" : undefined}
                  value={previousBaselineId || undefined}
                  onChange={(value) => { clearBaselineError("previous"); setPreviousBaselineId(value ?? ""); }}
                  placeholder="选择本业务上一版已冻结的需求基线"
                  optionFilterProp="label"
                  options={previousBaselineOptions}
                  style={{ width: "100%" }}
                  notFoundContent="没有可关联的历史基线"
                />
                {fieldHint("只能关联同一业务的上一版本；不要选择售后系统或其他项目的基线。", baselineErrors.previous)}
              </>}
          </div>
          <div className="baseline-form-field">
            {requiredLabel("上传评审后获批的 PRD 文件")}
            <Upload.Dragger
              accept=".pdf,.doc,.docx,.rtf,.odt,.md,.txt,.html,.htm"
              beforeUpload={() => false}
              maxCount={1}
              fileList={reviewedPrd}
              onChange={({ fileList }) => { clearBaselineError("file"); setReviewedPrd(fileList.slice(-1)); }}
            >
              <p className="ant-upload-text">点击或拖入获批需求文件</p>
              <p className="ant-upload-hint">支持 PDF、Word、Markdown、TXT 等；仅保存正式批准版本</p>
            </Upload.Dragger>
            {fieldHint("对于当前模拟业务，上传你确认的《智能导购系统业务需求基线 V1.0》文件。", baselineErrors.file)}
          </div>
        </Space>
      </Modal>

      <Modal title={`需求基线 v${baselineSnapshot?.record.version ?? ""}`} open={Boolean(baselineSnapshot)} onCancel={() => setBaselineSnapshot(undefined)} footer={null} width={760}>
        {baselineSnapshot && <Space direction="vertical" size={8} style={{ width: "100%" }}>
          <Text>获批 PRD：{baselineSnapshot.record.prdFilename} · {baselineSnapshot.record.prdRevision}</Text>
          <Text type="secondary">文件 SHA-256：{baselineSnapshot.record.prdSha256}</Text>
          {baselineSnapshot.accepted.map((entry) => <Card size="small" key={entry.item.id}><Text strong>{entry.item.id} · {entry.section}</Text><Paragraph>{entry.item.description}</Paragraph>{"issue_type" in entry.item && <Tag color="gold">AI 分类：{issueTypeLabels[entry.item.issue_type as AnalysisIssueType]}</Tag>}{entry.review.issueType && <Tag color="blue">人工分类：{issueTypeLabels[entry.review.issueType]}</Tag>}{entry.review.decision && <div className="review-decision-block"><Text strong>最终决策</Text><DecisionMarkdown value={entry.review.decision} compact /></div>}</Card>)}
        </Space>}
      </Modal>

      <Modal title={`评审历史 · ${history?.itemId ?? ""}`} open={Boolean(history)} onCancel={() => setHistory(undefined)} footer={null}>
        {history && (history.events.length ? <Space direction="vertical" style={{ width: "100%" }}>
          {amendments.filter((event) => event.itemId === history.itemId).map((event) => <Card size="small" key={event.id} title="人工修正 Diff"><Space wrap><Text>{event.editor}</Text><Text type="secondary">{new Date(event.createdAt).toLocaleString("zh-CN")}</Text></Space><Paragraph>修改理由：{event.reason}</Paragraph><Text strong>修改前</Text><pre className="triage-evidence-content">{JSON.stringify(event.before, null, 2)}</pre><Text strong>修改后</Text><pre className="triage-evidence-content">{JSON.stringify(event.after, null, 2)}</pre></Card>)}
          {history.events.map((event) => <Card size="small" key={event.id}>
            <Space wrap><Tag>{reviewStatusLabels[event.status]}</Tag><Text>{event.reviewer}</Text><Text type="secondary">{new Date(event.createdAt).toLocaleString("zh-CN")}</Text></Space>
            {event.reason && <Paragraph>理由：{event.reason}</Paragraph>}
            {event.decision && <div className="review-decision-block"><Text strong>正式评审决策</Text><DecisionMarkdown value={event.decision} compact /><Text type="secondary">决策人：{event.decisionBy} · PRD {event.prdRevision || PENDING_PRD_REVISION}</Text></div>}
          </Card>)}
        </Space> : <Empty description="尚无评审记录" />)}
      </Modal>
    </Card>
  );
}
