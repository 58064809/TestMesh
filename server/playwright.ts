import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { DomainStore, UiTestResultInput, UiTestRunRecord } from "./store.js";
import { inspectRepository } from "./repository.js";

export const PLAYWRIGHT_VERSION = "1.62.1";
export const PLAYWRIGHT_IMAGE = "mcr.microsoft.com/playwright:v1.62.1-noble";
const MAX_OUTPUT_CHARS = 200_000;
let activeRunId: string | undefined;

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface JsonResult {
  status?: string;
  duration?: number;
  error?: { message?: string; stack?: string };
  errors?: Array<{ message?: string; stack?: string }>;
}

interface JsonTest {
  projectName?: string;
  results?: JsonResult[];
}

interface JsonSpec {
  title?: string;
  tests?: JsonTest[];
}

interface JsonSuite {
  title?: string;
  suites?: JsonSuite[];
  specs?: JsonSpec[];
}

interface JsonReport {
  suites?: JsonSuite[];
}

function trimOutput(value: string): string {
  return value.length > MAX_OUTPUT_CHARS
    ? `${value.slice(0, MAX_OUTPUT_CHARS)}\n…输出已按 P04-A 上限截断`
    : value;
}

async function runDocker(args: string[]): Promise<ProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn("docker", args, { shell: false, windowsHide: true, env: process.env });
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

function assertWithinRepo(repoPath: string, candidate: string): void {
  const root = `${path.resolve(repoPath).toLowerCase()}${path.sep}`;
  const resolved = path.resolve(candidate).toLowerCase();
  if (!resolved.startsWith(root)) throw new Error("测试文件超出所选仓库边界");
}

async function validateProject(repoPath: string, testFile: string): Promise<string> {
  const packagePath = path.join(repoPath, "package.json");
  const installedPath = path.join(repoPath, "node_modules", "@playwright", "test", "package.json");
  const packageJson = JSON.parse(await fs.readFile(packagePath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const declared = packageJson.devDependencies?.["@playwright/test"] ?? packageJson.dependencies?.["@playwright/test"];
  if (declared !== PLAYWRIGHT_VERSION) {
    throw new Error(`目标项目必须精确声明 @playwright/test@${PLAYWRIGHT_VERSION}，当前为 ${declared || "未声明"}`);
  }
  const installed = JSON.parse(await fs.readFile(installedPath, "utf8")) as { version?: string };
  if (installed.version !== PLAYWRIGHT_VERSION) {
    throw new Error(`目标项目已安装 Playwright 版本为 ${installed.version || "未知"}，要求 ${PLAYWRIGHT_VERSION}`);
  }
  const absoluteTestFile = path.resolve(repoPath, testFile);
  assertWithinRepo(repoPath, absoluteTestFile);
  if (!(await fs.stat(absoluteTestFile)).isFile()) throw new Error("所选 Playwright 测试文件不存在");
  return path.relative(repoPath, absoluteTestFile).replaceAll("\\", "/");
}

function resultError(result: JsonResult): string {
  const errors = result.errors?.length ? result.errors : result.error ? [result.error] : [];
  return errors.map((item) => item.stack || item.message || "Playwright 测试失败").join("\n\n");
}

export function parsePlaywrightReport(report: JsonReport): UiTestResultInput[] {
  const output: UiTestResultInput[] = [];
  const visit = (suite: JsonSuite, parents: string[]) => {
    const titles = suite.title ? [...parents, suite.title] : parents;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const result = test.results?.at(-1);
        if (!result) continue;
        const status = result.status;
        if (status !== "passed" && status !== "failed" && status !== "skipped" && status !== "timedOut" && status !== "interrupted") {
          throw new Error(`Playwright JSON Reporter 返回未支持状态：${status || "空"}`);
        }
        output.push({
          title: [...titles, spec.title || "未命名测试"].filter(Boolean).join(" > "),
          projectName: test.projectName || "",
          status,
          durationMs: result.duration ?? 0,
          error: resultError(result),
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child, titles);
  };
  for (const suite of report.suites ?? []) visit(suite, []);
  if (output.length === 0) throw new Error("Playwright JSON Reporter 没有可持久化的测试结果");
  return output;
}

async function findTraceFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (directory: string) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile() && entry.name === "trace.zip") output.push(candidate);
    }
  };
  await visit(root);
  return output;
}

export async function runPlaywrightTest(
  input: { repoPath: string; testFile: string; authorized: boolean },
  store: DomainStore,
): Promise<UiTestRunRecord> {
  if (!input.authorized) throw new Error("必须明确授权在一次性 Playwright 容器中执行所选测试");
  if (activeRunId) throw new Error(`UI TestRun ${activeRunId} 正在执行，P04-A 只允许单任务`);
  const inspection = await inspectRepository(input.repoPath);
  const testFile = await validateProject(inspection.repoPath, input.testFile);
  const containerName = `testmesh-playwright-${randomUUID().slice(0, 8)}`;
  const run = store.createUiTestRun({
    repoPath: inspection.repoPath,
    testFile,
    playwrightVersion: PLAYWRIGHT_VERSION,
    image: PLAYWRIGHT_IMAGE,
    containerName,
  });
  activeRunId = run.id;
  const artifactRoot = path.resolve(process.cwd(), "data", "playwright", run.id);
  await fs.mkdir(artifactRoot, { recursive: true });
  let processResult: ProcessResult = { stdout: "", stderr: "", exitCode: -1 };
  try {
    processResult = await runDocker([
      "run",
      "--rm",
      "--name",
      containerName,
      "--init",
      "--ipc=host",
      "--workdir",
      "/workspace",
      "--mount",
      `type=bind,source=${inspection.repoPath},target=/workspace,readonly`,
      "--mount",
      `type=bind,source=${artifactRoot},target=/artifacts`,
      "--env",
      "PLAYWRIGHT_JSON_OUTPUT_FILE=/artifacts/results.json",
      PLAYWRIGHT_IMAGE,
      "node",
      "/workspace/node_modules/@playwright/test/cli.js",
      "test",
      testFile,
      "--project=chromium",
      "--workers=1",
      "--retries=0",
      "--reporter=json",
      "--trace=retain-on-failure",
      "--output=/artifacts/test-results",
    ]);
    const runnerOutput = trimOutput([processResult.stdout, processResult.stderr].filter(Boolean).join("\n"));
    const reportPath = path.join(artifactRoot, "results.json");
    const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as JsonReport;
    const results = parsePlaywrightReport(report);
    const traceFiles = await findTraceFiles(artifactRoot);
    const passed = results.filter((item) => item.status === "passed").length;
    const skipped = results.filter((item) => item.status === "skipped").length;
    const failed = results.length - passed - skipped;
    if (failed > 0 && traceFiles.length === 0) {
      throw new Error("Playwright 测试失败，但 retain-on-failure 未生成 Trace Evidence");
    }
    const status = failed > 0 ? "failed" : processResult.exitCode === 0 ? "passed" : "error";
    return store.finishUiTestRun({
      id: run.id,
      status,
      passed,
      failed,
      skipped,
      exitCode: processResult.exitCode,
      runnerOutput,
      error: status === "error" ? `Playwright 运行器退出码异常：${processResult.exitCode}` : "",
      results,
      artifacts: traceFiles.map((file, index) => ({
        name: `trace-${index + 1}.zip`,
        kind: "trace" as const,
        path: file,
      })),
    });
  } catch (error) {
    const runnerOutput = trimOutput([processResult.stdout, processResult.stderr].filter(Boolean).join("\n"));
    return store.finishUiTestRun({
      id: run.id,
      status: "error",
      passed: 0,
      failed: 0,
      skipped: 0,
      exitCode: processResult.exitCode,
      runnerOutput,
      error: error instanceof Error ? error.message : "Playwright Docker 执行失败",
      results: [],
      artifacts: [],
    });
  } finally {
    await runDocker(["rm", "--force", containerName]).catch(() => undefined);
    activeRunId = undefined;
  }
}
