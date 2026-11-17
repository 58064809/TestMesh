import { spawn } from "node:child_process";
import path from "node:path";

export const OPA_VERSION = "1.21.2";
export const RELEASE_POLICY_VERSION = "qm01-v4";

function projectRoot(): string {
  return path.resolve(process.env.TESTMESH_PROJECT_ROOT?.trim() || process.cwd());
}

export function opaBinaryPath(): string {
  return process.env.OPA_BINARY?.trim() || path.join(projectRoot(), ".opa", `v${OPA_VERSION}`, "opa.exe");
}

export function releasePolicyPath(): string {
  return path.join(projectRoot(), "server", "quality-management", "release.rego");
}

export async function evaluateReleasePolicy(input: unknown): Promise<{ status: "allow" | "review" | "deny"; reasons: string[]; checks: Array<{ id: string; passed: boolean }> }> {
  const output = await runOpa(["eval", "--format=json", "--data", releasePolicyPath(), "--stdin-input", "data.testmesh.release.decision"], JSON.stringify(input));
  const parsed = JSON.parse(output) as { result?: Array<{ expressions?: Array<{ value?: unknown }> }> };
  const value = parsed.result?.[0]?.expressions?.[0]?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("OPA 未返回有效的发布准入决策");
  const decision = value as { status?: unknown; reasons?: unknown; checks?: unknown };
  if (!(["allow", "review", "deny"] as const).includes(decision.status as "allow" | "review" | "deny")) {
    throw new Error("OPA 发布准入状态无效");
  }
  return {
    status: decision.status as "allow" | "review" | "deny",
    reasons: Array.isArray(decision.reasons) ? decision.reasons.map(String) : [],
    checks: Array.isArray(decision.checks) ? decision.checks as Array<{ id: string; passed: boolean }> : [],
  };
}

export async function verifyOpa(): Promise<string> {
  const output = await runOpa(["version"], "");
  if (!output.includes(OPA_VERSION)) throw new Error(`OPA 版本不匹配，要求 ${OPA_VERSION}`);
  return OPA_VERSION;
}

export async function testReleasePolicy(): Promise<void> {
  await runOpa(["test", releasePolicyPath(), path.join(path.dirname(releasePolicyPath()), "release_test.rego")], "");
}

function runOpa(args: string[], stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(opaBinaryPath(), args, { cwd: projectRoot(), shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("OPA 执行超过 15 秒，发布准入已停止")); }, 15_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(new Error(`OPA 不可用：${error.message}。请先运行 npm run setup:opa`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`OPA 执行失败（exit ${code}）：${stderr.trim() || stdout.trim()}`));
      else resolve(stdout);
    });
    child.stdin.end(stdin);
  });
}
