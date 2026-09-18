import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export interface RepositoryInspection {
  repoPath: string;
  branch: string;
  status: string;
  files: string[];
}

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runProcess(command: string, args: string[], cwd?: string): Promise<ProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: false,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) child.kill();
    }, 30_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      settled = true;
      clearTimeout(timer);
      const result = { stdout, stderr, exitCode: code ?? -1 };
      if (result.exitCode !== 0) {
        reject(new Error(`${command} 执行失败（exit ${result.exitCode}）：${stderr || stdout}`));
        return;
      }
      resolve(result);
    });
  });
}

function normalizedPath(value: string): string {
  return path.resolve(value).replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
}

export async function inspectRepository(repoPathInput: string): Promise<RepositoryInspection> {
  const repoPath = path.resolve(repoPathInput.trim());
  const stat = await fs.stat(repoPath).catch(() => undefined);
  if (!stat?.isDirectory()) throw new Error("所选仓库目录不存在");
  const root = await runProcess("git", ["-C", repoPath, "rev-parse", "--show-toplevel"]);
  const gitRoot = path.resolve(root.stdout.trim());
  if (normalizedPath(gitRoot) !== normalizedPath(repoPath)) {
    throw new Error(`请选择 Git 仓库根目录：${gitRoot}`);
  }
  const [branch, status, files] = await Promise.all([
    runProcess("git", ["-C", repoPath, "branch", "--show-current"]),
    runProcess("git", ["-C", repoPath, "status", "--short", "--branch"]),
    runProcess("git", ["-C", repoPath, "ls-files", "--cached", "--others", "--exclude-standard"]),
  ]);
  return {
    repoPath,
    branch: branch.stdout.trim() || "detached HEAD",
    status: status.stdout.trim(),
    files: files.stdout.split(/\r?\n/).filter(Boolean).slice(0, 1000),
  };
}
