import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  DomainStore,
  PerformanceTestRunRecord,
  PerformanceThresholdInput,
} from "./store.js";
import { inspectRepository } from "./repository.js";

export const K6_VERSION = "2.2.0";
export const K6_PATH = "D:\\TestHome\\k6\\2.2.0\\k6.exe";
export const K6_CONFIG_PATH = "D:\\TestHome\\k6\\config.json";
export const K6_TEMP_PATH = "D:\\TestHome\\k6\\temp";
const MAX_OUTPUT_CHARS = 200_000;
let activeRunId: string | undefined;

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface SummaryMetric {
  count?: number;
  value?: number;
  passes?: number;
  fails?: number;
  avg?: number;
  max?: number;
  "p(90)"?: number;
  "p(95)"?: number;
  thresholds?: Record<string, boolean>;
}

interface K6Summary {
  metrics?: Record<string, SummaryMetric>;
}

export interface ParsedK6Summary {
  httpRequests: number;
  requestFailedRate: number;
  iterations: number;
  checksPassed: number;
  checksFailed: number;
  durationAvgMs: number;
  durationP90Ms: number;
  durationP95Ms: number;
  durationMaxMs: number;
  thresholds: PerformanceThresholdInput[];
}

function trimOutput(value: string): string {
  return value.length > MAX_OUTPUT_CHARS
    ? `${value.slice(0, MAX_OUTPUT_CHARS)}\n…输出已按 P04-C 上限截断`
    : value;
}

async function runProcess(command: string, args: string[], cwd: string): Promise<ProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, TEMP: K6_TEMP_PATH, TMP: K6_TEMP_PATH },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout: trimOutput(stdout), stderr: trimOutput(stderr), exitCode: code ?? -1 });
    });
  });
}

function metricNumber(metric: SummaryMetric | undefined, field: keyof SummaryMetric): number {
  const value = metric?.[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function parseK6Summary(summary: K6Summary): ParsedK6Summary {
  if (!summary.metrics || typeof summary.metrics !== "object") {
    throw new Error("k6 summary JSON 缺少 metrics，无法作为 TestRun 结构化结果");
  }
  const thresholds: PerformanceThresholdInput[] = [];
  for (const [metric, values] of Object.entries(summary.metrics)) {
    for (const [expression, crossed] of Object.entries(values.thresholds ?? {})) {
      if (typeof crossed !== "boolean") {
        throw new Error(`k6 summary 的 threshold 状态无效：${metric} / ${expression}`);
      }
      thresholds.push({ metric, expression, failed: crossed });
    }
  }
  const duration = summary.metrics.http_req_duration;
  const checks = summary.metrics.checks;
  return {
    httpRequests: metricNumber(summary.metrics.http_reqs, "count"),
    requestFailedRate: metricNumber(summary.metrics.http_req_failed, "value"),
    iterations: metricNumber(summary.metrics.iterations, "count"),
    checksPassed: metricNumber(checks, "passes"),
    checksFailed: metricNumber(checks, "fails"),
    durationAvgMs: metricNumber(duration, "avg"),
    durationP90Ms: metricNumber(duration, "p(90)"),
    durationP95Ms: metricNumber(duration, "p(95)"),
    durationMaxMs: metricNumber(duration, "max"),
    thresholds,
  };
}

function assertWithinRepository(repoPath: string, candidate: string): void {
  const root = `${path.resolve(repoPath).toLowerCase()}${path.sep}`;
  if (!path.resolve(candidate).toLowerCase().startsWith(root)) {
    throw new Error("k6 脚本超出所选仓库边界");
  }
}

async function validateScript(repoPath: string, scriptFile: string): Promise<string> {
  if (!scriptFile || !/\.js$/i.test(scriptFile)) {
    throw new Error("请选择一个本地 .js k6 脚本");
  }
  const absolute = path.resolve(repoPath, scriptFile);
  assertWithinRepository(repoPath, absolute);
  const file = await fs.lstat(absolute);
  if (file.isSymbolicLink()) throw new Error("所选 k6 脚本不能是符号链接");
  if (!file.isFile()) throw new Error("所选 k6 脚本不存在");
  return path.relative(repoPath, absolute).replaceAll("\\", "/");
}

async function assertK6Installation(repoPath: string): Promise<void> {
  await fs.access(K6_PATH);
  await fs.access(K6_CONFIG_PATH);
  await fs.mkdir(K6_TEMP_PATH, { recursive: true });
  const version = await runProcess(K6_PATH, ["version"], repoPath);
  if (version.exitCode !== 0 || !version.stdout.startsWith(`k6.exe v${K6_VERSION} `)) {
    throw new Error(`k6 版本不匹配：要求 ${K6_VERSION}，实际输出 ${version.stdout || version.stderr || "为空"}`);
  }
}

export async function runK6Test(
  input: { repoPath: string; scriptFile: string; authorized: boolean },
  store: DomainStore,
): Promise<PerformanceTestRunRecord> {
  if (!input.authorized) throw new Error("必须明确授权以当前用户权限在宿主 Windows 执行所选 k6 脚本");
  if (activeRunId) throw new Error(`性能 TestRun ${activeRunId} 正在执行，P04-C 只允许单进程`);
  const inspection = await inspectRepository(input.repoPath);
  const scriptFile = await validateScript(inspection.repoPath, input.scriptFile);
  await assertK6Installation(inspection.repoPath);
  const run = store.createPerformanceTestRun({
    repoPath: inspection.repoPath,
    scriptFile,
    k6Version: K6_VERSION,
  });
  activeRunId = run.id;
  const artifactRoot = path.resolve(process.cwd(), "data", "k6", run.id);
  const summaryPath = path.join(artifactRoot, "summary.json");
  const terminalPath = path.join(artifactRoot, "terminal-output.txt");
  await fs.mkdir(artifactRoot, { recursive: true });
  let processResult: ProcessResult = { stdout: "", stderr: "", exitCode: -1 };
  let runnerOutput = "";
  let summaryJson = "";
  try {
    processResult = await runProcess(
      K6_PATH,
      [
        "run",
        "--config",
        K6_CONFIG_PATH,
        "--summary-export",
        summaryPath,
        path.resolve(inspection.repoPath, scriptFile),
      ],
      inspection.repoPath,
    );
    runnerOutput = trimOutput(
      [processResult.stdout, processResult.stderr].filter(Boolean).join("\n"),
    );
    await fs.writeFile(terminalPath, runnerOutput, "utf8");
    try {
      summaryJson = await fs.readFile(summaryPath, "utf8");
    } catch {
      throw new Error("k6 未生成 --summary-export JSON，不能从终端文本补建 TestRun");
    }
    const parsed = parseK6Summary(JSON.parse(summaryJson) as K6Summary);
    const thresholdFailed = parsed.thresholds.some((item) => item.failed);
    const status = thresholdFailed ? "failed" : processResult.exitCode === 0 ? "passed" : "error";
    return store.finishPerformanceTestRun({
      id: run.id,
      status,
      exitCode: processResult.exitCode,
      ...parsed,
      runnerOutput,
      summaryJson,
      error: status === "error" ? `k6 退出码异常：${processResult.exitCode}` : "",
      artifacts: [
        { name: "terminal-output.txt", kind: "terminal_output", path: terminalPath },
        { name: "summary.json", kind: "summary", path: summaryPath },
      ],
    });
  } catch (error) {
    runnerOutput ||= trimOutput(
      [processResult.stdout, processResult.stderr].filter(Boolean).join("\n"),
    );
    await fs.writeFile(terminalPath, runnerOutput, "utf8");
    const artifacts: Array<{
      name: string;
      kind: "summary" | "terminal_output";
      path: string;
    }> = [{ name: "terminal-output.txt", kind: "terminal_output", path: terminalPath }];
    if (summaryJson) artifacts.push({ name: "summary.json", kind: "summary", path: summaryPath });
    return store.finishPerformanceTestRun({
      id: run.id,
      status: "error",
      exitCode: processResult.exitCode,
      httpRequests: 0,
      requestFailedRate: 0,
      iterations: 0,
      checksPassed: 0,
      checksFailed: 0,
      durationAvgMs: 0,
      durationP90Ms: 0,
      durationP95Ms: 0,
      durationMaxMs: 0,
      runnerOutput,
      summaryJson,
      error: error instanceof Error ? error.message : "k6 执行失败",
      thresholds: [],
      artifacts,
    });
  } finally {
    activeRunId = undefined;
  }
}
