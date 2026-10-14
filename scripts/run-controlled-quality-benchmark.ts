import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@arizeai/phoenix-client";
import { asEvaluator, runExperiment } from "@arizeai/phoenix-client/experiments";
import { ControlledBenchmarkSchema } from "../server/ai-quality/benchmark.js";
import { instrumentLangChainForPhoenix, refreshPhoenixInstrumentationProvider } from "../server/observability/phoenix.js";
import { MODEL } from "../server/requirement-analysis/config.js";
import { RequirementAnalysisSchema, type RequirementAnalysis } from "../server/requirement-analysis/schema.js";
import { createSources } from "../server/requirement-analysis/sources.js";

interface BenchmarkInput {
  message: string;
  sourceFilename: string;
  documentText: string;
}

interface BenchmarkExpected {
  issueType: "missing" | "ambiguity" | "conflict";
  terms: string[];
  paragraphs: number[];
  summary: string;
}

interface BenchmarkExample {
  input: BenchmarkInput;
}

interface BenchmarkOutput {
  analysis: RequirementAnalysis;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  agentLatencyMs: number;
  taskId: string;
}

if (!process.env.OPENAI_API_KEY) throw new Error("缺少 OPENAI_API_KEY，受控质量实验已停止");

const projectRoot = path.resolve(import.meta.dirname, "..");
const benchmark = ControlledBenchmarkSchema.parse(JSON.parse(await readFile(
  path.join(projectRoot, "evaluation", "requirement-analysis-controlled-v0.json"),
  "utf8",
)));
const phoenixEndpoint = process.env.PHOENIX_ENDPOINT ?? "http://127.0.0.1:6006";
process.env.PHOENIX_ENDPOINT = phoenixEndpoint;
process.env.PHOENIX_COLLECTOR_ENDPOINT = phoenixEndpoint;

instrumentLangChainForPhoenix();
const client = createClient({ options: { baseUrl: phoenixEndpoint } });

function targetQuestions(output: BenchmarkOutput, expected: BenchmarkExpected) {
  return output.analysis.open_questions.filter((item) => {
    if (item.issue_type !== expected.issueType) return false;
    const searchable = item.description.toLowerCase();
    return expected.terms.some((term) => searchable.includes(term.toLowerCase()));
  });
}

const experiment = await runExperiment({
  client,
  dataset: { datasetName: "testmesh-requirement-analysis-controlled" },
  experimentName: `controlled-recall-${MODEL}-${benchmark.version}`,
  experimentDescription: "在 20 条单缺陷受控中文需求上验证缺失、歧义、冲突检出能力；结果不代表真实业务泛化质量。",
  experimentMetadata: {
    model: MODEL,
    benchmarkVersion: benchmark.version,
    dataClass: benchmark.status,
  },
  concurrency: 2,
  useBatchSpanProcessor: false,
  task: async (example: BenchmarkExample): Promise<BenchmarkOutput> => {
    const input = example.input;
    refreshPhoenixInstrumentationProvider();
    const sources = createSources([{
      originalname: input.sourceFilename,
      mimetype: "text/markdown",
      buffer: Buffer.from(input.documentText, "utf8"),
    }], []);
    const startedAt = performance.now();
    const { createOpenAIRequirementAnalysisModel, runRequirementAnalysisAgent } = await import("../server/requirement-analysis/agent.js");
    const result = await runRequirementAnalysisAgent({
      message: input.message,
      sources,
      model: createOpenAIRequirementAnalysisModel(process.env.OPENAI_API_KEY!),
      requestedBy: "phoenix-controlled-quality-benchmark",
    });
    return {
      analysis: result.result,
      usage: result.usage,
      agentLatencyMs: Math.round(performance.now() - startedAt),
      taskId: result.taskId,
    };
  },
  evaluators: [
    asEvaluator({
      name: "production-schema",
      kind: "CODE",
      evaluate: ({ output }) => {
        const parsed = RequirementAnalysisSchema.safeParse((output as BenchmarkOutput | undefined)?.analysis);
        return {
          score: parsed.success ? 1 : 0,
          label: parsed.success ? "pass" : "fail",
          explanation: parsed.success ? "通过生产结构协议。" : parsed.error.message,
        };
      },
    }),
    asEvaluator({
      name: "controlled-defect-detected",
      kind: "CODE",
      evaluate: ({ output, expected }) => {
        if (!output || !expected) return { score: 0, label: "fail", explanation: "缺少输出或预期结果。" };
        const matches = targetQuestions(output as BenchmarkOutput, expected as unknown as BenchmarkExpected);
        return {
          score: matches.length > 0 ? 1 : 0,
          label: matches.length > 0 ? "detected" : "missed",
          explanation: matches.length > 0
            ? `命中 ${matches.map((item) => item.id).join("、")}。`
            : `未命中预期缺陷：${(expected as unknown as BenchmarkExpected).summary}`,
          metadata: { matchedQuestionIds: matches.map((item) => item.id) },
        };
      },
    }),
    asEvaluator({
      name: "controlled-evidence-located",
      kind: "CODE",
      evaluate: ({ output, expected }) => {
        if (!output || !expected) return { score: 0, label: "fail", explanation: "缺少输出或预期结果。" };
        const candidate = output as BenchmarkOutput;
        const target = expected as unknown as BenchmarkExpected;
        const matches = targetQuestions(candidate, target);
        const refs = new Set(matches.flatMap((item) => item.source_refs));
        const locators = candidate.analysis.sources.filter((source) => refs.has(source.id)).map((source) => source.locator);
        const located = target.issueType === "missing" || target.paragraphs.every((paragraph) => (
          locators.some((locator) => locator.includes(String(paragraph)))
        ));
        return {
          score: matches.length > 0 && located ? 1 : 0,
          label: matches.length > 0 && located ? "pass" : "review",
          explanation: matches.length === 0
            ? "目标缺陷未检出，无法核对证据。"
            : located ? `证据定位满足预期段落：${target.paragraphs.join("、")}。` : `证据定位 ${locators.join("、") || "为空"} 与预期不一致。`,
        };
      },
    }),
    asEvaluator({
      name: "controlled-overreporting",
      kind: "CODE",
      evaluate: ({ output }) => {
        if (!output) return { score: 0, label: "fail", explanation: "Agent 未返回结果。" };
        const count = (output as BenchmarkOutput).analysis.open_questions.length;
        return {
          score: count <= 3 ? 1 : 0,
          label: count <= 3 ? "pass" : "review",
          explanation: `单缺陷样本共报告 ${count} 个问题；超过 3 个需人工检查是否过度报告。`,
        };
      },
    }),
  ],
});

console.log(JSON.stringify({
  datasetName: "testmesh-requirement-analysis-controlled",
  experimentId: experiment.id,
  projectName: experiment.projectName,
  successfulRuns: experiment.successfulRunCount,
  failedRuns: experiment.failedRunCount,
  benchmarkVersion: benchmark.version,
  dataClass: benchmark.status,
}, null, 2));
