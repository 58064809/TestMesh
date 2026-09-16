import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import type {
  DomainStore,
  SecurityFindingInput,
  SecurityRisk,
  SecurityTestRunRecord,
} from "./store.js";

export const ZAP_VERSION = "2.17.0";
export const ZAP_ROOT = "D:\\TestHome\\ZAP\\2.17.0";
export const ZAP_JAR_PATH = path.join(ZAP_ROOT, `zap-${ZAP_VERSION}.jar`);
export const ZAP_JAVA_PATH =
  "D:\\TestHome\\Android\\jdk\\jdk-17.0.20.1+1\\bin\\java.exe";
export const ZAP_HOME_ROOT = "D:\\TestHome\\ZAP\\home";
export const ZAP_TEMP_PATH = "D:\\TestHome\\ZAP\\temp";
const ZAP_PORT = "8090";
const MAX_OUTPUT_CHARS = 200_000;
const PROCESS_TIMEOUT_MS = 5 * 60 * 1000;
let activeRunId: string | undefined;

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

interface ZapInstance {
  uri?: unknown;
  method?: unknown;
  param?: unknown;
  evidence?: unknown;
}

interface ZapAlert {
  pluginid?: unknown;
  alertRef?: unknown;
  alert?: unknown;
  name?: unknown;
  riskcode?: unknown;
  riskdesc?: unknown;
  confidence?: unknown;
  desc?: unknown;
  solution?: unknown;
  reference?: unknown;
  instances?: unknown;
}

interface ZapSite {
  alerts?: unknown;
}

export interface ParsedZapReport {
  findings: SecurityFindingInput[];
  high: number;
  medium: number;
  low: number;
  informational: number;
}

function trimOutput(value: string): string {
  return value.length > MAX_OUTPUT_CHARS
    ? `${value.slice(0, MAX_OUTPUT_CHARS)}\n…输出已按 P04-D 上限截断`
    : value;
}

async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = PROCESS_TIMEOUT_MS,
): Promise<ProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        JAVA_HOME: path.dirname(path.dirname(ZAP_JAVA_PATH)),
        TEMP: ZAP_TEMP_PATH,
        TMP: ZAP_TEMP_PATH,
      },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        stdout: trimOutput(stdout),
        stderr: trimOutput(stderr),
        exitCode: code ?? -1,
        timedOut,
      });
    });
  });
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function riskFromAlert(alert: ZapAlert): SecurityRisk {
  const code = textValue(alert.riskcode).trim();
  if (code === "3") return "high";
  if (code === "2") return "medium";
  if (code === "1") return "low";
  if (code === "0") return "informational";
  const description = textValue(alert.riskdesc).toLowerCase();
  if (description.startsWith("high")) return "high";
  if (description.startsWith("medium")) return "medium";
  if (description.startsWith("low")) return "low";
  if (description.startsWith("informational")) return "informational";
  return "unknown";
}

export function validateZapTargetUrl(value: string): string {
  let target: URL;
  try {
    target = new URL(value.trim());
  } catch {
    throw new Error("请输入有效的 Target URL");
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Target URL 只支持 http 或 https");
  }
  if (target.username || target.password) {
    throw new Error("P04-D 不支持在 Target URL 中携带认证信息");
  }
  target.hash = "";
  return target.toString();
}

export function createZapPlan(targetUrl: string, reportDir: string): string {
  const target = validateZapTargetUrl(targetUrl);
  return stringify({
    env: {
      contexts: [{ name: "TestMesh", urls: [target] }],
      parameters: {
        failOnError: true,
        failOnWarning: false,
        progressToStdout: true,
      },
    },
    jobs: [
      {
        type: "spider",
        parameters: {
          context: "TestMesh",
          url: target,
          maxDuration: 1,
          maxDepth: 5,
          threadCount: 1,
          postForm: false,
          processForm: false,
        },
      },
      { type: "passiveScan-wait", parameters: { maxDuration: 2 } },
      {
        type: "report",
        parameters: {
          template: "traditional-json",
          reportDir,
          reportFile: "report.json",
          reportTitle: "TestMesh P04-D Passive Baseline",
          displayReport: false,
        },
      },
    ],
  });
}

export function parseZapReport(report: unknown): ParsedZapReport {
  if (!report || typeof report !== "object" || !Array.isArray((report as { site?: unknown }).site)) {
    throw new Error("ZAP Traditional JSON 报告缺少 site，无法作为 TestRun 结构化结果");
  }
  const findings: SecurityFindingInput[] = [];
  const alertsByRisk: Record<Exclude<SecurityRisk, "unknown">, number> = {
    high: 0,
    medium: 0,
    low: 0,
    informational: 0,
  };
  for (const site of (report as { site: ZapSite[] }).site) {
    if (site.alerts === undefined) continue;
    if (!Array.isArray(site.alerts)) {
      throw new Error("ZAP Traditional JSON 报告的 alerts 结构无效");
    }
    for (const alert of site.alerts as ZapAlert[]) {
      if (!alert || typeof alert !== "object") {
        throw new Error("ZAP Traditional JSON 报告包含无效 alert");
      }
      const risk = riskFromAlert(alert);
      if (risk !== "unknown") alertsByRisk[risk] += 1;
      const rawInstances = alert.instances;
      if (rawInstances !== undefined && !Array.isArray(rawInstances)) {
        throw new Error("ZAP Traditional JSON 报告的 instances 结构无效");
      }
      const instances: ZapInstance[] = Array.isArray(rawInstances) && rawInstances.length
        ? rawInstances
        : [{}];
      for (const instance of instances) {
        findings.push({
          pluginId: textValue(alert.pluginid) || textValue(alert.alertRef),
          name: textValue(alert.alert) || textValue(alert.name) || "未命名告警",
          risk,
          confidence: textValue(alert.confidence),
          url: textValue(instance.uri),
          method: textValue(instance.method),
          parameter: textValue(instance.param),
          evidence: textValue(instance.evidence),
          description: textValue(alert.desc),
          solution: textValue(alert.solution),
          reference: textValue(alert.reference),
        });
      }
    }
  }
  return {
    findings,
    high: alertsByRisk.high,
    medium: alertsByRisk.medium,
    low: alertsByRisk.low,
    informational: alertsByRisk.informational,
  };
}

async function assertZapInstallation(): Promise<void> {
  await Promise.all([
    fs.access(ZAP_JAVA_PATH),
    fs.access(ZAP_JAR_PATH),
    fs.mkdir(ZAP_HOME_ROOT, { recursive: true }),
    fs.mkdir(ZAP_TEMP_PATH, { recursive: true }),
  ]);
  const version = await runProcess(ZAP_JAVA_PATH, ["-jar", ZAP_JAR_PATH, "-version"], ZAP_ROOT, 60_000);
  const output = `${version.stdout}\n${version.stderr}`;
  if (version.exitCode !== 0 || !output.includes(ZAP_VERSION)) {
    throw new Error(`ZAP 版本不匹配：要求 ${ZAP_VERSION}，实际输出 ${output.trim() || "为空"}`);
  }
}

export async function runZapBaseline(
  input: { targetUrl: string; authorized: boolean },
  store: DomainStore,
): Promise<SecurityTestRunRecord> {
  if (!input.authorized) {
    throw new Error("必须确认你有权扫描该目标，并明确授权本次无认证被动基线扫描");
  }
  if (activeRunId) throw new Error(`安全 TestRun ${activeRunId} 正在执行，P04-D 只允许单 ZAP 进程`);
  const targetUrl = validateZapTargetUrl(input.targetUrl);
  await assertZapInstallation();
  const run = store.createSecurityTestRun(targetUrl, ZAP_VERSION);
  activeRunId = run.id;
  const artifactRoot = path.resolve(process.cwd(), "data", "zap", run.id);
  const runHome = path.join(ZAP_HOME_ROOT, run.id);
  const planPath = path.join(artifactRoot, "plan.yaml");
  const reportPath = path.join(artifactRoot, "report.json");
  const terminalPath = path.join(artifactRoot, "terminal-output.txt");
  await Promise.all([
    fs.mkdir(artifactRoot, { recursive: true }),
    fs.mkdir(runHome, { recursive: true }),
  ]);
  await fs.writeFile(planPath, createZapPlan(targetUrl, artifactRoot), "utf8");
  let processResult: ProcessResult = { stdout: "", stderr: "", exitCode: -1, timedOut: false };
  let runnerOutput = "";
  let reportAvailable = false;
  try {
    processResult = await runProcess(
      ZAP_JAVA_PATH,
      [
        "-Xmx512m",
        "-jar",
        ZAP_JAR_PATH,
        "-cmd",
        "-dir",
        runHome,
        "-host",
        "127.0.0.1",
        "-port",
        ZAP_PORT,
        "-config",
        "autoupdate.checkOnStart=false",
        "-config",
        "autoupdate.downloadNewRelease=false",
        "-config",
        "autoupdate.installAddonUpdates=false",
        "-autorun",
        planPath,
      ],
      ZAP_ROOT,
    );
    runnerOutput = trimOutput([processResult.stdout, processResult.stderr].filter(Boolean).join("\n"));
    await fs.writeFile(terminalPath, runnerOutput, "utf8");
    if (processResult.timedOut) {
      throw new Error("ZAP 超过 5 分钟仍未结束，已停止本次单进程扫描");
    }
    let reportText: string;
    try {
      reportText = await fs.readFile(reportPath, "utf8");
      reportAvailable = true;
    } catch {
      throw new Error("ZAP 未生成 Traditional JSON 报告，不能从终端输出补建 TestRun");
    }
    const parsed = parseZapReport(JSON.parse(reportText) as unknown);
    if (processResult.exitCode !== 0) {
      throw new Error(`ZAP 退出码异常：${processResult.exitCode}`);
    }
    return store.finishSecurityTestRun({
      id: run.id,
      status: "completed",
      exitCode: processResult.exitCode,
      ...parsed,
      runnerOutput,
      error: "",
      artifacts: [
        { name: "report.json", kind: "report", path: reportPath },
        { name: "terminal-output.txt", kind: "terminal_output", path: terminalPath },
      ],
    });
  } catch (error) {
    runnerOutput ||= trimOutput([processResult.stdout, processResult.stderr].filter(Boolean).join("\n"));
    await fs.writeFile(terminalPath, runnerOutput, "utf8");
    if (!reportAvailable) {
      reportAvailable = await fs.access(reportPath).then(() => true, () => false);
    }
    return store.finishSecurityTestRun({
      id: run.id,
      status: "error",
      exitCode: processResult.exitCode,
      high: 0,
      medium: 0,
      low: 0,
      informational: 0,
      findings: [],
      runnerOutput,
      error: error instanceof Error ? error.message : "ZAP 安全测试执行失败",
      artifacts: [
        ...(reportAvailable
          ? [{ name: "report.json", kind: "report" as const, path: reportPath }]
          : []),
        { name: "terminal-output.txt", kind: "terminal_output", path: terminalPath },
      ],
    });
  } finally {
    activeRunId = undefined;
    await fs.rm(runHome, { recursive: true, force: true });
  }
}
