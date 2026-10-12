import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import type {
  ApiScenarioRunItemInput,
  ApiScenarioRunRecord,
  DomainStore,
} from "./store.js";
import type { RunnerAuth } from "./schemathesis.js";

export const HURL_VERSION = "8.0.1";
export const MAX_HURL_BYTES = 512 * 1024;
const MAX_RUNNER_OUTPUT_BYTES = 2 * 1024 * 1024;
const PROCESS_TIMEOUT_MS = 5 * 60 * 1000;
const METHODS = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT|TRACE";
const REQUEST_LINE = new RegExp(`^\\s*(?:${METHODS})\\s+(\\S+)`, "i");
const SENSITIVE_HEADER = /^\s*([A-Za-z0-9-]*(?:authorization|cookie|token|secret|password|api-key|apikey)[A-Za-z0-9-]*)\s*:\s*(.*)$/i;

type XmlNode = Record<string, unknown>;

function array<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function value(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function detail(valueToRead: unknown): string {
  if (typeof valueToRead === "string") return valueToRead.trim();
  if (!valueToRead || typeof valueToRead !== "object") return "";
  const node = valueToRead as XmlNode;
  return value(node["#text"] || node.message).trim();
}

export function validateHurlScenario(content: string): void {
  if (!content.trim()) throw new Error("Hurl 场景文件不能为空");
  if (content.includes("\uFFFD")) throw new Error("Hurl 场景文件不是有效的 UTF-8 文本");
  if (Buffer.byteLength(content, "utf8") > MAX_HURL_BYTES) {
    throw new Error("Hurl 场景文件不能超过 512 KB");
  }
  const requestLines = content.split(/\r?\n/).map((line) => ({ line, match: REQUEST_LINE.exec(line) }))
    .filter((item) => item.match);
  if (requestLines.length === 0) throw new Error("Hurl 场景没有可执行的 HTTP 请求");
  for (const { line, match } of requestLines) {
    const url = match?.[1] ?? "";
    if (!url.startsWith("{{baseUrl}}")) {
      throw new Error(`请求必须使用项目环境变量 {{baseUrl}}，不能写死目标地址：${line.trim()}`);
    }
  }
  for (const line of content.split(/\r?\n/)) {
    const match = SENSITIVE_HEADER.exec(line);
    if (match && !/\{\{[A-Za-z_][A-Za-z0-9_]*\}\}/.test(match[2])) {
      throw new Error(`敏感 Header ${match[1]} 必须引用运行时变量，不能保存明文`);
    }
  }
  if (/\bfile\s*,/i.test(content)) {
    throw new Error("Hurl 场景不能引用本机文件；请求体请直接写入场景文件");
  }
}

export function parseHurlJUnit(xml: string): {
  passed: number;
  failed: number;
  items: ApiScenarioRunItemInput[];
} {
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false,
    trimValues: false,
  }).parse(xml) as XmlNode;
  const rootSuites = parsed.testsuites as XmlNode | undefined;
  const suites = rootSuites
    ? array(rootSuites.testsuite as XmlNode | XmlNode[] | undefined)
    : array(parsed.testsuite as XmlNode | XmlNode[] | undefined);
  if (suites.length === 0) throw new Error("Hurl JUnit 缺少 testsuite");
  const items: ApiScenarioRunItemInput[] = [];
  for (const suite of suites) {
    for (const testCase of array(suite.testcase as XmlNode | XmlNode[] | undefined)) {
      const failures = array(testCase.failure as unknown | unknown[] | undefined);
      const errors = array(testCase.error as unknown | unknown[] | undefined);
      const problem = errors[0] ?? failures[0];
      items.push({
        name: value(testCase.name) || value(suite.name) || "Hurl scenario",
        classname: value(testCase.classname) || value(suite.name),
        status: errors.length > 0 ? "error" : failures.length > 0 ? "failed" : "passed",
        durationMs: Number(value(testCase.time) || 0) * 1000,
        detail: detail(problem),
      });
    }
  }
  return {
    passed: items.filter((item) => item.status === "passed").length,
    failed: items.filter((item) => item.status !== "passed").length,
    items,
  };
}

function resolveBinary(): string {
  const filename = process.platform === "win32" ? "hurl.exe" : "hurl";
  const binary = path.resolve(".hurl", HURL_VERSION, filename);
  if (!fs.existsSync(binary)) {
    throw new Error(`Hurl ${HURL_VERSION} 未安装，请先运行 npm run setup:hurl`);
  }
  return binary;
}

function runtimeVariables(targetBaseUrl: string, auth: RunnerAuth): Record<string, string> {
  const variables: Record<string, string> = { HURL_VARIABLE_baseUrl: targetBaseUrl.replace(/\/$/, "") };
  if (auth.type === "bearer") {
    if (!auth.token?.trim()) throw new Error("Bearer Token 不能为空");
    variables.HURL_VARIABLE_token = auth.token.trim();
  } else if (auth.type === "basic") {
    if (!auth.username || auth.password === undefined) throw new Error("Basic Auth 用户名和密码不能为空");
    variables.HURL_VARIABLE_username = auth.username;
    variables.HURL_VARIABLE_password = auth.password;
  }
  return variables;
}

function redact(output: string, auth: RunnerAuth): string {
  const secrets = [auth.token, auth.username, auth.password].filter((item): item is string => Boolean(item));
  return secrets.reduce((current, secret) => current.split(secret).join("[REDACTED]"), output);
}

async function execute(
  command: string,
  args: string[],
  cwd: string,
  environment: Record<string, string>,
): Promise<{ exitCode: number; output: string }> {
  return await new Promise((resolve, reject) => {
    const inheritedEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith("HURL_VARIABLE_")),
    );
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: { ...inheritedEnvironment, NO_PROXY: "127.0.0.1,localhost", ...environment },
    });
    let output = "";
    let outputBytes = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(error);
    };
    const collect = (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_RUNNER_OUTPUT_BYTES) {
        fail(new Error("Hurl 输出超过 2 MB，运行已停止"));
        return;
      }
      output += chunk.toString("utf8");
    };
    const timer = setTimeout(() => fail(new Error("Hurl 运行超过 5 分钟，已停止")), PROCESS_TIMEOUT_MS);
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", fail);
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? 2, output });
    });
  });
}

export async function runHurlScenario(
  input: {
    suiteId: string;
    targetBaseUrl: string;
    headers: Array<{ name: string; value: string }>;
    auth: RunnerAuth;
  },
  store: DomainStore,
  dataRoot = path.resolve("data", "hurl-runs"),
): Promise<ApiScenarioRunRecord> {
  const suite = store.getApiScenarioSuite(input.suiteId);
  const content = store.getApiScenarioContent(input.suiteId);
  validateHurlScenario(content);
  const run = store.createApiScenarioRun({
    suiteId: suite.id,
    projectId: suite.projectId,
    environmentId: suite.environmentId,
    targetBaseUrl: input.targetBaseUrl,
    hurlVersion: HURL_VERSION,
  });
  const runDirectory = path.join(dataRoot, run.id);
  fs.mkdirSync(runDirectory, { recursive: true });
  const scenarioPath = path.join(runDirectory, "scenario.hurl");
  const junitPath = path.join(runDirectory, "junit.xml");
  fs.writeFileSync(scenarioPath, content, "utf8");
  const args = [
    scenarioPath,
    "--test",
    "--jobs", "1",
    "--connect-timeout", "10",
    "--max-time", "60",
    "--report-junit", junitPath,
    "--file-root", runDirectory,
    "--no-output",
    "--no-color",
    "--error-format", "long",
  ];
  for (const header of input.headers) args.push("--header", `${header.name}: ${header.value}`);
  let execution: { exitCode: number; output: string };
  try {
    execution = await execute(resolveBinary(), args, runDirectory, runtimeVariables(input.targetBaseUrl, input.auth));
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : "Hurl Runner 启动失败", input.auth);
    return store.finishApiScenarioRun({
      id: run.id,
      status: "error",
      passed: 0,
      failed: 1,
      exitCode: 2,
      runnerOutput: message,
      items: [{ name: suite.filename, classname: "Hurl Runner", status: "error", durationMs: 0, detail: message }],
    });
  }
  const runnerOutput = redact(execution.output, input.auth);
  if (!fs.existsSync(junitPath)) {
    return store.finishApiScenarioRun({
      id: run.id,
      status: "error",
      passed: 0,
      failed: 1,
      exitCode: execution.exitCode,
      runnerOutput,
      items: [{
        name: suite.filename,
        classname: "Hurl Runner",
        status: "error",
        durationMs: 0,
        detail: "Hurl 未生成 JUnit 报告，未启用其他报告格式或 fallback。",
      }],
    });
  }
  let report: ReturnType<typeof parseHurlJUnit>;
  try {
    report = parseHurlJUnit(fs.readFileSync(junitPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hurl JUnit 无法解析";
    return store.finishApiScenarioRun({
      id: run.id,
      status: "error",
      passed: 0,
      failed: 1,
      exitCode: execution.exitCode,
      runnerOutput,
      items: [{ name: suite.filename, classname: "Hurl Runner", status: "error", durationMs: 0, detail: message }],
    });
  }
  return store.finishApiScenarioRun({
    id: run.id,
    status: execution.exitCode === 0 ? "passed" : execution.exitCode === 1 ? "failed" : "error",
    passed: report.passed,
    failed: report.failed,
    exitCode: execution.exitCode,
    runnerOutput,
    items: report.items,
  });
}
