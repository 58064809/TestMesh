import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import { connect } from "node:net";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { AndroidTestResultInput, AndroidTestRunRecord, DomainStore } from "./store.js";
import { inspectRepository } from "./repository.js";

export const APPIUM_VERSION = "3.7.0";
export const UIAUTOMATOR2_VERSION = "8.5.2";
export const WDIO_VERSION = "9.31.5";
export const WDIO_JUNIT_VERSION = "9.31.2";

const ANDROID_ROOT = "D:\\TestHome\\Android";
const ANDROID_SDK_ROOT = path.join(ANDROID_ROOT, "sdk");
const APPIUM_HOME = path.join(ANDROID_ROOT, "appium-home");
const JAVA_HOME = path.join(ANDROID_ROOT, "jdk", "jdk-17.0.20.1+1");
const ADB_PATH = path.join(ANDROID_SDK_ROOT, "platform-tools", "adb.exe");
const APPIUM_ENTRY = path.join(ANDROID_ROOT, "appium-server", "node_modules", "appium", "index.js");
const APPIUM_HOST = "127.0.0.1";
const APPIUM_PORT = 4723;
const MAX_OUTPUT_CHARS = 200_000;
let activeRunId: string | undefined;

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface JUnitNode {
  "@_name"?: string;
  "@_classname"?: string;
  "@_time"?: string | number;
  failure?: string | { "#text"?: string; "@_message"?: string };
  error?: string | { "#text"?: string; "@_message"?: string };
  skipped?: unknown;
}

interface JUnitSuite {
  "@_name"?: string;
  properties?: {
    property?: { "@_name"?: string; "@_value"?: string } | Array<{ "@_name"?: string; "@_value"?: string }>;
  };
  testcase?: JUnitNode | JUnitNode[];
  testsuite?: JUnitSuite | JUnitSuite[];
}

interface JUnitDocument {
  testsuites?: { testsuite?: JUnitSuite | JUnitSuite[] };
  testsuite?: JUnitSuite | JUnitSuite[];
}

function trimOutput(value: string): string {
  return value.length > MAX_OUTPUT_CHARS
    ? `${value.slice(0, MAX_OUTPUT_CHARS)}\n…输出已按 P04-B 上限截断`
    : value;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function failureText(value: JUnitNode["failure"]): string {
  if (!value) return "";
  if (typeof value === "string") return decodeXmlText(value);
  return [value["@_message"], value["#text"]].filter(Boolean).map((item) => decodeXmlText(String(item))).join("\n");
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

export function parseWdioJUnit(xml: string): AndroidTestResultInput[] {
  const parsed = new XMLParser({ ignoreAttributes: false, trimValues: false }).parse(xml) as JUnitDocument;
  const roots = asArray(parsed.testsuites?.testsuite ?? parsed.testsuite);
  const output: AndroidTestResultInput[] = [];
  const visit = (suite: JUnitSuite, parents: string[]) => {
    const names = suite["@_name"] ? [...parents, suite["@_name"]] : parents;
    const suiteName = asArray(suite.properties?.property)
      .find((property) => property["@_name"] === "suiteName")?.["@_value"];
    for (const item of asArray(suite.testcase)) {
      const failure = failureText(item.failure) || failureText(item.error);
      const status = item.skipped !== undefined ? "skipped" : failure ? "failed" : "passed";
      output.push({
        title: item["@_name"] || suiteName || "未命名测试",
        suite: item["@_classname"] || names.filter(Boolean).join(" > "),
        status,
        durationMs: Number(item["@_time"] || 0) * 1000,
        error: failure,
      });
    }
    for (const child of asArray(suite.testsuite)) visit(child, names);
  };
  for (const suite of roots) visit(suite, []);
  if (output.length === 0) throw new Error("WebdriverIO JUnit Reporter 没有可持久化的测试结果");
  return output;
}

async function runProcess(command: string, args: string[], env = process.env, cwd?: string): Promise<ProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      env,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => resolve({
      stdout: trimOutput(stdout),
      stderr: trimOutput(stderr),
      exitCode: code ?? -1,
    }));
  });
}

async function readExactVersion(packagePath: string, expected: string, label: string): Promise<void> {
  const manifest = JSON.parse(await fs.readFile(packagePath, "utf8")) as { version?: string };
  if (manifest.version !== expected) {
    throw new Error(`${label} 已安装版本为 ${manifest.version || "未知"}，要求 ${expected}`);
  }
}

async function assertFileWithinRepo(repoPath: string, selected: string, label: string): Promise<string> {
  const root = await fs.realpath(repoPath);
  const candidate = await fs.realpath(path.resolve(repoPath, selected));
  const boundary = `${root.toLowerCase()}${path.sep}`;
  if (!candidate.toLowerCase().startsWith(boundary)) throw new Error(`${label}超出所选仓库边界`);
  if (!(await fs.stat(candidate)).isFile()) throw new Error(`${label}不存在`);
  return path.relative(root, candidate).replaceAll("\\", "/");
}

async function validateWdioProject(repoPath: string, configFile: string, testFile: string) {
  const manifest = JSON.parse(await fs.readFile(path.join(repoPath, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const expected: Record<string, string> = {
    webdriverio: WDIO_VERSION,
    "@wdio/cli": WDIO_VERSION,
    "@wdio/local-runner": WDIO_VERSION,
    "@wdio/mocha-framework": WDIO_VERSION,
    "@wdio/junit-reporter": WDIO_JUNIT_VERSION,
  };
  for (const [name, version] of Object.entries(expected)) {
    const declared = manifest.devDependencies?.[name] ?? manifest.dependencies?.[name];
    if (declared !== version) {
      throw new Error(`目标项目必须精确声明 ${name}@${version}，当前为 ${declared || "未声明"}`);
    }
    await readExactVersion(path.join(repoPath, "node_modules", name, "package.json"), version, name);
  }
  return {
    configFile: await assertFileWithinRepo(repoPath, configFile, "WebdriverIO 配置文件"),
    testFile: await assertFileWithinRepo(repoPath, testFile, "Android 测试文件"),
  };
}

async function detectEmulator(): Promise<{ serial: string; platformVersion: string }> {
  await fs.access(ADB_PATH);
  const devices = await runProcess(ADB_PATH, ["devices"]);
  if (devices.exitCode !== 0) throw new Error(`adb devices 失败：${devices.stderr || devices.stdout}`);
  const rows = devices.stdout.split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean);
  if (rows.length !== 1) throw new Error(`P04-B 要求且只允许一个在线 Android Emulator，当前检测到 ${rows.length} 个设备条目`);
  const [serial, state] = rows[0].split(/\s+/);
  if (!/^emulator-\d+$/.test(serial) || state !== "device") {
    throw new Error(`唯一设备必须是已在线 Android Emulator，当前为 ${serial || "未知"} (${state || "未知"})`);
  }
  const boot = await runProcess(ADB_PATH, ["-s", serial, "shell", "getprop", "sys.boot_completed"]);
  if (boot.exitCode !== 0 || boot.stdout.trim() !== "1") throw new Error(`Android Emulator ${serial} 尚未完成启动`);
  const platform = await runProcess(ADB_PATH, ["-s", serial, "shell", "getprop", "ro.build.version.release"]);
  if (platform.exitCode !== 0 || !platform.stdout.trim()) throw new Error("无法读取 Android Emulator 平台版本");
  return { serial, platformVersion: platform.stdout.trim() };
}

async function assertAppiumPortAvailable(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host: APPIUM_HOST, port: APPIUM_PORT });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      reject(new Error(`本机 ${APPIUM_HOST}:${APPIUM_PORT} 已被占用，P04-B 不会复用未知 Appium 服务`));
    });
    socket.once("error", () => resolve());
    socket.once("timeout", () => {
      socket.destroy();
      resolve();
    });
  });
}

function androidEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ANDROID_HOME: ANDROID_SDK_ROOT,
    ANDROID_SDK_ROOT,
    ANDROID_AVD_HOME: path.join(ANDROID_ROOT, "avd"),
    APPIUM_HOME,
    JAVA_HOME,
    ...extra,
  };
}

function startAppium(): { child: ChildProcessWithoutNullStreams; output: () => string } {
  const child = spawn(process.execPath, [
    APPIUM_ENTRY,
    "--address", APPIUM_HOST,
    "--port", String(APPIUM_PORT),
    "--base-path", "/",
    "--log-level", "info",
  ], { shell: false, windowsHide: true, env: androidEnv() });
  let value = "";
  child.stdout.on("data", (chunk: Buffer) => { value += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { value += chunk.toString("utf8"); });
  child.on("error", (error) => { value += `\nAppium Server 启动失败：${error.message}`; });
  return { child, output: () => trimOutput(value) };
}

async function waitForAppium(child: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Appium Server 提前退出，退出码 ${child.exitCode}`);
    try {
      const response = await fetch(`http://${APPIUM_HOST}:${APPIUM_PORT}/status`);
      if (response.ok) {
        const body = await response.json() as { value?: { ready?: boolean } };
        if (body.value?.ready) return;
      }
    } catch {
      // Appium 正在启动；只在固定等待窗口内继续探测同一服务。
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Appium Server 在 30 秒内未就绪");
}

async function stopAppium(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("close", () => { clearTimeout(timer); resolve(); });
  });
}

async function addExistingArtifact(
  artifacts: Array<{ name: string; kind: "screenshot" | "page_source" | "appium_log"; path: string }>,
  file: string,
  kind: "screenshot" | "page_source" | "appium_log",
): Promise<void> {
  await fs.access(file);
  artifacts.push({ name: path.basename(file), kind, path: file });
}

export async function runAndroidTest(
  input: { repoPath: string; configFile: string; testFile: string; authorized: boolean },
  store: DomainStore,
): Promise<AndroidTestRunRecord> {
  if (!input.authorized) throw new Error("必须明确授权 TestMesh 在宿主机连接本机 Android Emulator 并执行所选测试");
  if (activeRunId) throw new Error(`Android TestRun ${activeRunId} 正在执行，P04-B 只允许单任务`);
  const inspection = await inspectRepository(input.repoPath);
  const selected = await validateWdioProject(inspection.repoPath, input.configFile, input.testFile);
  await readExactVersion(path.join(ANDROID_ROOT, "appium-server", "node_modules", "appium", "package.json"), APPIUM_VERSION, "Appium Server");
  await readExactVersion(path.join(APPIUM_HOME, "node_modules", "appium-uiautomator2-driver", "package.json"), UIAUTOMATOR2_VERSION, "UiAutomator2 Driver");
  const emulator = await detectEmulator();
  await assertAppiumPortAvailable();
  const run = store.createAndroidTestRun({
    repoPath: inspection.repoPath,
    configFile: selected.configFile,
    testFile: selected.testFile,
    deviceSerial: emulator.serial,
    platformVersion: emulator.platformVersion,
    appiumVersion: APPIUM_VERSION,
    driverVersion: UIAUTOMATOR2_VERSION,
    wdioVersion: WDIO_VERSION,
  });
  activeRunId = run.id;
  const artifactRoot = path.resolve(process.cwd(), "data", "appium", run.id);
  await fs.mkdir(artifactRoot, { recursive: true });
  const appium = startAppium();
  let processResult: ProcessResult = { stdout: "", stderr: "", exitCode: -1 };
  let status: "passed" | "failed" | "error";
  let results: AndroidTestResultInput[];
  const artifacts: Array<{ name: string; kind: "screenshot" | "page_source" | "appium_log"; path: string }> = [];
  let errorMessage: string;
  try {
    await waitForAppium(appium.child);
    const cli = path.join(inspection.repoPath, "node_modules", "@wdio", "cli", "bin", "wdio.js");
    processResult = await runProcess(process.execPath, [
      cli,
      "run", selected.configFile,
      "--spec", selected.testFile,
      "--hostname", APPIUM_HOST,
      "--port", String(APPIUM_PORT),
      "--path", "/",
      "--maxInstances", "1",
      "--specFileRetries", "0",
      "--connectionRetryCount", "0",
      "--mochaOpts.retries", "0",
    ], androidEnv({
      ANDROID_SERIAL: emulator.serial,
      TESTMESH_APPIUM_ARTIFACT_DIR: artifactRoot,
    }), inspection.repoPath);
    results = parseWdioJUnit(await fs.readFile(path.join(artifactRoot, "junit.xml"), "utf8"));
    const failed = results.filter((item) => item.status === "failed").length;
    if (failed > 0) {
      await addExistingArtifact(artifacts, path.join(artifactRoot, "failure.png"), "screenshot");
      await addExistingArtifact(artifacts, path.join(artifactRoot, "page-source.xml"), "page_source");
    }
    status = failed > 0 ? "failed" : processResult.exitCode === 0 ? "passed" : "error";
    errorMessage = status === "error" ? `WebdriverIO 运行器退出码异常：${processResult.exitCode}` : "";
  } catch (error) {
    status = "error";
    results = [];
    artifacts.length = 0;
    errorMessage = error instanceof Error ? error.message : "Android Emulator 测试执行失败";
  } finally {
    await stopAppium(appium.child);
    const logPath = path.join(artifactRoot, "appium.log");
    await fs.writeFile(logPath, appium.output(), "utf8");
    artifacts.push({ name: "appium.log", kind: "appium_log", path: logPath });
    activeRunId = undefined;
  }
  const passed = results.filter((item) => item.status === "passed").length;
  const failed = results.filter((item) => item.status === "failed").length;
  const skipped = results.filter((item) => item.status === "skipped").length;
  return store.finishAndroidTestRun({
    id: run.id,
    status,
    passed,
    failed,
    skipped,
    exitCode: processResult.exitCode,
    runnerOutput: trimOutput([processResult.stdout, processResult.stderr].filter(Boolean).join("\n")),
    error: errorMessage,
    results,
    artifacts,
  });
}
