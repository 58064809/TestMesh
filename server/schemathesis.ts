import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { DomainStore, TestRunItemInput, TestRunRecord } from "./store.js";

export const SCHEMATHESIS_VERSION = "4.24.3";
const MAX_RUNNER_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface RunnerAuth {
  type: "none" | "bearer" | "basic";
  token?: string;
  username?: string;
  password?: string;
}

export interface RunInput {
  specId: string;
  targetBaseUrl: string;
  headers: Array<{ name: string; value: string }>;
  auth: RunnerAuth;
}

type XmlNode = Record<string, unknown>;

function array<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function string(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function nodeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return string((value as XmlNode)["#text"]);
  return "";
}

function extractFailureParts(detail: string): {
  checks: string[];
  request: string;
  response: string;
  reproduction: string;
} {
  const checks = [...detail.matchAll(/^-[ \t]+([^\r\n]+)$/gm)].map((match) => match[1].trim());
  const responseMatch = detail.match(
    /\[(\d{3})\][ \t]+([^\r\n]+):[ \t]*\r?\n[ \t]*\r?\n([\s\S]*?)(?=\r?\nReproduce with:|$)/,
  );
  const response = responseMatch
    ? `[${responseMatch[1]}] ${responseMatch[2]}\n${responseMatch[3].trim()}`
    : "";
  const reproduceMatch = detail.match(/Reproduce with:[ \t]*\r?\n[ \t]*\r?\n([\s\S]+)$/);
  const reproduction = reproduceMatch?.[1].trim() ?? "";
  const request = reproduction
    .split(/\r?\n[ \t]*\r?\n/)
    .find((block) => block.trimStart().startsWith("curl "))
    ?.trim() ?? "";
  return { checks, request, response, reproduction };
}

export function parseJUnitReport(
  xml: string,
  specId: string,
  store: DomainStore,
): { passed: number; failed: number; items: TestRunItemInput[] } {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseAttributeValue: false,
    trimValues: false,
  });
  const parsed = parser.parse(xml) as XmlNode;
  const suitesRoot = parsed.testsuites as XmlNode | undefined;
  if (!suitesRoot) throw new Error("Schemathesis JUnit 缺少 testsuites 根节点");
  const suites = array(suitesRoot.testsuite as XmlNode | XmlNode[] | undefined);
  const items: TestRunItemInput[] = [];

  for (const suite of suites) {
    for (const testCase of array(suite.testcase as XmlNode | XmlNode[] | undefined)) {
      const operation = string(testCase.name);
      const failures = array(testCase.failure as unknown | unknown[] | undefined);
      const errors = array(testCase.error as unknown | unknown[] | undefined);
      const problems = [...failures, ...errors];
      if (problems.length === 0) {
        items.push({
          testCaseId: store.getTestCaseForOperation(specId, operation),
          operation,
          status: "passed",
          durationMs: Number(string(testCase.time) || 0) * 1000,
          failureType: "",
          checks: [],
          request: "",
          response: "",
          reproduction: "",
          detail: "",
        });
        continue;
      }

      for (const problem of problems) {
        const detail = nodeText(problem).trim();
        const parts = extractFailureParts(detail);
        const failureType =
          problem && typeof problem === "object" ? string((problem as XmlNode).type) : "failure";
        items.push({
          testCaseId: store.getTestCaseForOperation(specId, operation),
          operation,
          status: errors.includes(problem) ? "error" : "failed",
          durationMs: Number(string(testCase.time) || 0) * 1000,
          failureType,
          ...parts,
          detail,
        });
      }
    }
  }

  return {
    passed: items.filter((item) => item.status === "passed").length,
    failed: items.filter((item) => item.status !== "passed").length,
    items,
  };
}

function authArguments(auth: RunnerAuth): string[] {
  if (auth.type === "none") return [];
  if (auth.type === "bearer") {
    if (!auth.token?.trim()) throw new Error("Bearer Token 不能为空");
    return ["--header", `Authorization: Bearer ${auth.token.trim()}`];
  }
  if (!auth.username || auth.password === undefined) {
    throw new Error("Basic Auth 用户名和密码不能为空");
  }
  return ["--auth", `${auth.username}:${auth.password}`];
}

async function execute(command: string, args: string[], cwd: string): Promise<{
  exitCode: number;
  output: string;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, NO_PROXY: "127.0.0.1,localhost" },
    });
    let output = "";
    let outputBytes = 0;
    const collect = (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_RUNNER_OUTPUT_BYTES) {
        child.kill();
        reject(new Error("Schemathesis 输出超过 2 MB，运行已停止"));
        return;
      }
      output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code ?? 2, output }));
  });
}

export async function runSchemathesis(
  input: RunInput,
  store: DomainStore,
  dataRoot = path.resolve("data", "runs"),
): Promise<TestRunRecord> {
  store.assertSpecTraceable(input.specId);
  const runId = store.createTestRun(input.specId, input.targetBaseUrl);
  const runDirectory = path.join(dataRoot, runId);
  fs.mkdirSync(runDirectory, { recursive: true });
  const schemaPath = path.join(runDirectory, "openapi.yaml");
  const junitPath = path.join(runDirectory, "junit.xml");
  fs.writeFileSync(schemaPath, store.getOpenApiContent(input.specId), "utf8");

  const args = [
    `schemathesis@${SCHEMATHESIS_VERSION}`,
    "run",
    schemaPath,
    "--url",
    input.targetBaseUrl,
    "--workers",
    "1",
    "--generation-deterministic",
    "--request-retries",
    "0",
    "--max-examples",
    "20",
    "--phases",
    "examples,coverage,fuzzing",
    "--report",
    "junit",
    "--report-junit-path",
    junitPath,
    "--output-sanitize",
    "true",
    "--no-color",
  ];
  for (const header of input.headers) args.push("--header", `${header.name}: ${header.value}`);
  args.push(...authArguments(input.auth));

  const execution = await execute("uvx", args, runDirectory);
  if (!fs.existsSync(junitPath)) {
    return store.finishTestRun({
      id: runId,
      status: "error",
      generatedExamples: 0,
      passed: 0,
      failed: 1,
      exitCode: execution.exitCode,
      runnerOutput: execution.output,
      items: [
        {
          testCaseId: null,
          operation: "Schemathesis Runner",
          status: "error",
          durationMs: 0,
          failureType: "runner_error",
          checks: [],
          request: "",
          response: "",
          reproduction: "",
          detail: "Schemathesis 未生成 JUnit 报告，未启用其他报告格式或 fallback。",
        },
      ],
    });
  }

  const report = parseJUnitReport(fs.readFileSync(junitPath, "utf8"), input.specId, store);
  const generatedMatch = execution.output.match(/Test cases:\s*\r?\n\s*(\d+) generated/);
  const generatedExamples = generatedMatch ? Number(generatedMatch[1]) : 0;
  const status = execution.exitCode === 0 ? "passed" : execution.exitCode === 1 ? "failed" : "error";
  return store.finishTestRun({
    id: runId,
    status,
    generatedExamples,
    passed: report.passed,
    failed: report.failed,
    exitCode: execution.exitCode,
    runnerOutput: execution.output,
    items: report.items,
  });
}
