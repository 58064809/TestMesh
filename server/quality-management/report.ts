interface ReportSnapshot {
  plan: {
    id: string; name: string; version: number; status: string; projectId: string;
    release: string; objectives: string[]; scope: string; qualityCharacteristics: string[];
  };
  metrics: Record<string, unknown>;
  metricCatalog: Array<{ id: string; name: string; category: string; status: "available" | "unavailable"; value: number | null; unit: string; numerator: number | null; denominator: number | null; formula: string; evidence: string; note: string }>;
  latestGate: { id: string; policyVersion: string; opaVersion: string; status: "allow" | "review" | "deny"; result: unknown; riskAcceptance: { acceptedBy: string; reason: string; expiresAt: string | null; acceptedAt: string } | null; evaluatedAt: string } | null;
  gateFresh: boolean;
  layers: Record<string, Record<string, unknown>>;
  assets: { nodes: Array<{ id: string; type: string; label: string; status: string }>; links: Array<{ from: string; to: string; relation: string }> };
  improvements: Array<{ id: string; title: string; status: string; owner: string; dueDate: string; verificationEvidence: string }>;
}

export function renderQualityReport(snapshot: ReportSnapshot, generatedAt = new Date()): string {
  const { plan, metrics, metricCatalog, latestGate, gateFresh, layers, assets, improvements } = snapshot;
  const metricRows = Object.entries(metrics).map(([name, value]) => `| ${cell(name)} | ${cell(format(value))} |`).join("\n");
  const layerRows = Object.entries(layers).flatMap(([layer, values]) =>
    Object.entries(values).map(([name, value]) => `| ${cell(layer)} | ${cell(name)} | ${cell(format(value))} |`),
  ).join("\n");
  const catalogRows = metricCatalog.map((metric) => `| ${cell(metric.category)} | ${cell(metric.name)} | ${metric.status === "available" ? `${format(metric.value)}${metric.unit}` : "暂无数据"} | ${metric.numerator ?? "-"} / ${metric.denominator ?? "-"} | ${cell(metric.formula || metric.note)} | ${cell(metric.evidence || "待接入")} |`).join("\n");
  const assetRows = assets.nodes.map((node) => `| ${cell(node.type)} | ${cell(node.label)} | ${cell(node.status)} | \`${cell(node.id)}\` |`).join("\n");
  const improvementRows = improvements.length
    ? improvements.map((item) => `| \`${cell(item.id)}\` | ${cell(item.title)} | ${cell(item.status)} | ${cell(item.owner)} | ${cell(item.dueDate || "-")} | ${cell(item.verificationEvidence || "待补充")} |`).join("\n")
    : "| - | 无 | - | - | - | - |";
  return `# ${plan.name} v${plan.version} 质量报告

- 报告时间：${generatedAt.toISOString()}
- 项目 ID：\`${plan.projectId}\`
- 发布批次：${plan.release || "未填写"}
- 质量计划 ID：\`${plan.id}\`
- 计划状态：**${plan.status}**

## 质量目标与范围

${list(plan.objectives)}

范围：

${plan.scope || "未配置"}

质量属性：${plan.qualityCharacteristics.map((item) => `\`${item}\``).join("、") || "未配置"}

## 分层质量指标

| 分类 | 指标 | 当前值 | 分子 / 分母 | 口径或缺失原因 | 证据来源 |
| --- | --- | ---: | ---: | --- | --- |
${catalogRows}

> “暂无数据”表示当前缺少真实分子、分母或证据源，不等于 0%，也不代表质量达标。

### 原始质量事实

| 指标 | 当前值 |
| --- | ---: |
${metricRows}

| 层级 | 指标 | 当前值 |
| --- | --- | ---: |
${layerRows}

## 发布准入结论

${renderGate(latestGate, gateFresh)}

## 可审计质量资产

| 类型 | 资产 | 状态 | 资产 ID |
| --- | --- | --- | --- |
${assetRows}

关系数量：${assets.links.length}。每条关系均由 TestMesh 业务 ID 连接，报告不复制外部 Runner、Phoenix 或 Trace 原始数据。

## 持续改进

| ID | 改进项 | 状态 | 负责人 | 截止时间 | 验证证据 |
| --- | --- | --- | --- | --- | --- |
${improvementRows}

## 审计说明

本报告由冻结质量计划、需求基线、Approved TestCase、自动化 TestRun、Phoenix 评估引用、OPA 准入事实和改进项确定性生成。缺少的证据保持缺失状态，不由 AI 补造。发布结论以保存的 OPA/Rego 决策为准。
`;
}

function list(values: string[]): string {
  return values.length ? values.map((item) => `- ${item}`).join("\n") : "- 未配置";
}

function cell(value: string): string { return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " "); }
function format(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join("、") : "无";
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "-");
}

function renderGate(gate: ReportSnapshot["latestGate"], gateFresh: boolean): string {
  if (!gate) return "尚未执行 OPA 发布准入评估；当前报告不能给出发布结论。";
  const result = gate.result && typeof gate.result === "object" ? gate.result as { reasons?: unknown } : {};
  const reasons = Array.isArray(result.reasons) ? result.reasons.map(String) : [];
  const acceptance = gate.riskAcceptance
    ? `\n- 风险接受：${gate.riskAcceptance.acceptedBy} · ${gate.riskAcceptance.reason} · 失效时间 ${gate.riskAcceptance.expiresAt || "未设置"}`
    : "";
  const freshness = gateFresh ? "当前准入使用的质量事实与本报告一致。" : "⚠️ 质量事实已发生变化，该准入结果已过期，必须重新执行 OPA 评估。";
  return `- 结果：**${gate.status}**
- 评估时间：${gate.evaluatedAt}
- 策略版本：${gate.policyVersion}
- OPA 版本：${gate.opaVersion}
- 有效性：${freshness}
- 原因：${reasons.join("；") || "全部策略检查通过"}${acceptance}`;
}
