import { parse } from "yaml";
import { z } from "zod";
import { validateHurlScenario } from "../hurl.js";

export const API_YAML_FORMAT = "testmesh-hurl/v1";
export const MAX_API_YAML_BYTES = 512 * 1024;

const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const FlatValues = z.record(z.string().trim().min(1).max(100), ScalarSchema);
const FlatValuesSchema = FlatValues.default({});
const VariableNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "变量名只能使用字母、数字和下划线，且不能以数字开头");
const DurationSchema = z.string().trim().regex(/^\d+(?:\.\d+)?\s*(?:ms|s|m|h)$/, "时间格式示例：500 ms、2 s、1 m");

const RequestSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
  path: z.string().trim().min(1).max(2_000).superRefine((value, context) => {
    if (!value.startsWith("/")) context.addIssue({ code: "custom", message: "请求 path 必须以 / 开头" });
    if (value.includes("://") || value.includes("{{baseUrl}}")) {
      context.addIssue({ code: "custom", message: "YAML 不能写 Base URL；目标地址必须来自项目环境配置" });
    }
  }),
  headers: FlatValuesSchema,
  query: FlatValuesSchema,
  json: z.unknown().optional(),
  form: FlatValues.optional(),
  text: z.string().max(256 * 1024).optional(),
}).strict().superRefine((request, context) => {
  const bodies = [request.json !== undefined, request.form !== undefined, request.text !== undefined].filter(Boolean).length;
  if (bodies > 1) context.addIssue({ code: "custom", message: "json、form、text 请求体只能选择一种" });
});

const CaptureSchema = z.object({
  name: VariableNameSchema,
  type: z.enum(["jsonpath", "header", "regex", "body", "status"]),
  expression: z.string().trim().max(2_000).optional(),
}).strict().superRefine((capture, context) => {
  if (["jsonpath", "header", "regex"].includes(capture.type) && !capture.expression) {
    context.addIssue({ code: "custom", message: `${capture.type} 捕获必须填写 expression` });
  }
  if (["body", "status"].includes(capture.type) && capture.expression) {
    context.addIssue({ code: "custom", message: `${capture.type} 捕获不需要 expression` });
  }
});

const AssertionSchema = z.object({
  type: z.enum(["jsonpath", "header", "regex", "body", "status", "duration"]),
  expression: z.string().trim().max(2_000).optional(),
  operator: z.enum(["==", "!=", ">", ">=", "<", "<=", "contains", "startsWith", "endsWith", "matches", "exists", "not exists"]),
  expected: ScalarSchema.optional(),
}).strict().superRefine((assertion, context) => {
  if (["jsonpath", "header", "regex"].includes(assertion.type) && !assertion.expression) {
    context.addIssue({ code: "custom", message: `${assertion.type} 断言必须填写 expression` });
  }
  if (["body", "status", "duration"].includes(assertion.type) && assertion.expression) {
    context.addIssue({ code: "custom", message: `${assertion.type} 断言不需要 expression` });
  }
  const unary = assertion.operator === "exists" || assertion.operator === "not exists";
  if (!unary && assertion.expected === undefined) context.addIssue({ code: "custom", message: `${assertion.operator} 断言必须填写 expected` });
  if (unary && assertion.expected !== undefined) context.addIssue({ code: "custom", message: `${assertion.operator} 断言不能填写 expected` });
});

const OptionsSchema = z.object({
  delay: DurationSchema.optional(),
  repeat: z.number().int().min(1).max(100).optional(),
  retry: z.number().int().min(0).max(10).optional(),
  retryInterval: DurationSchema.optional(),
}).strict();

const StepSchema = z.object({
  name: z.string().trim().min(1).max(120),
  request: RequestSchema,
  expectedStatus: z.number().int().min(100).max(599),
  captures: z.array(CaptureSchema).max(50).default([]),
  assertions: z.array(AssertionSchema).max(100).default([]),
  options: OptionsSchema.optional(),
}).strict();

export const ApiYamlScenarioSchema = z.object({
  format: z.literal(API_YAML_FORMAT),
  name: z.string().trim().min(1).max(120),
  steps: z.array(StepSchema).min(1, "至少需要一个请求步骤").max(100),
}).strict();

export type ApiYamlScenario = z.infer<typeof ApiYamlScenarioSchema>;

export interface CompiledApiYamlScenario {
  name: string;
  stepCount: number;
  yamlContent: string;
  hurlContent: string;
}

export function compileApiYamlScenario(content: string): CompiledApiYamlScenario {
  if (!content.trim()) throw new Error("YAML 场景不能为空");
  if (content.includes("\uFFFD")) throw new Error("YAML 场景不是有效的 UTF-8 文本");
  if (Buffer.byteLength(content, "utf8") > MAX_API_YAML_BYTES) throw new Error("YAML 场景不能超过 512 KB");
  let document: unknown;
  try { document = parse(content); } catch (error) {
    throw new Error(`YAML 语法错误：${error instanceof Error ? error.message : "无法解析"}`, { cause: error });
  }
  const parsed = ApiYamlScenarioSchema.safeParse(document);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}：${issue.message}`).join("；");
    throw new Error(`YAML 场景校验失败：${details}`);
  }
  const hurlContent = `${parsed.data.steps.map(compileStep).join("\n\n")}\n`;
  validateHurlScenario(hurlContent);
  return { name: parsed.data.name, stepCount: parsed.data.steps.length, yamlContent: content, hurlContent };
}

function compileStep(step: z.infer<typeof StepSchema>): string {
  const lines = [`# ${safeComment(step.name)}`, `${step.request.method} {{baseUrl}}${template(step.request.path)}`];
  for (const [name, value] of Object.entries(step.request.headers)) lines.push(`${singleLine(name)}: ${requestValue(value)}`);
  if (Object.keys(step.request.query).length > 0) {
    lines.push("[Query]");
    for (const [name, value] of Object.entries(step.request.query)) lines.push(`${singleLine(name)}: ${requestValue(value)}`);
  }
  if (step.request.form && Object.keys(step.request.form).length > 0) {
    lines.push("[Form]");
    for (const [name, value] of Object.entries(step.request.form)) lines.push(`${singleLine(name)}: ${requestValue(value)}`);
  }
  if (step.options) {
    lines.push("[Options]");
    if (step.options.delay) lines.push(`delay: ${normalizeDuration(step.options.delay)}`);
    if (step.options.repeat !== undefined) lines.push(`repeat: ${step.options.repeat}`);
    if (step.options.retry !== undefined) lines.push(`retry: ${step.options.retry}`);
    if (step.options.retryInterval) lines.push(`retry-interval: ${normalizeDuration(step.options.retryInterval)}`);
  }
  if (step.request.json !== undefined) lines.push(renderJson(step.request.json));
  if (step.request.text !== undefined) lines.push("```", template(step.request.text), "```");
  lines.push(`HTTP ${step.expectedStatus}`);
  if (step.captures.length > 0) {
    lines.push("[Captures]");
    for (const capture of step.captures) lines.push(`${capture.name}: ${query(capture.type, capture.expression)}`);
  }
  if (step.assertions.length > 0) {
    lines.push("[Asserts]");
    for (const assertion of step.assertions) {
      const expected = assertion.expected === undefined ? "" : ` ${assertValue(assertion.expected)}`;
      lines.push(`${query(assertion.type, assertion.expression)} ${assertion.operator}${expected}`);
    }
  }
  return lines.join("\n");
}

function query(type: string, expression?: string): string { return expression === undefined ? type : `${type} ${JSON.stringify(expression)}`; }
function requestValue(value: z.infer<typeof ScalarSchema>): string {
  if (typeof value === "string") return template(singleLine(value));
  if (value === null) return "null";
  return String(value);
}
function assertValue(value: z.infer<typeof ScalarSchema>): string {
  if (typeof value === "string") {
    const exact = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
    return exact ? `{{${exact[1]}}}` : JSON.stringify(template(value));
  }
  if (value === null) return "null";
  return String(value);
}
function renderJson(value: unknown): string {
  ensureJsonValue(value, "json");
  const markers = new Map<string, string>();
  const prepared = replaceJsonVariables(value, markers);
  let serialized = JSON.stringify(prepared, null, 2);
  for (const [marker, variable] of markers) serialized = serialized.replace(JSON.stringify(marker), `{{${variable}}}`);
  return serialized;
}
function replaceJsonVariables(value: unknown, markers: Map<string, string>): unknown {
  if (typeof value === "string") {
    const exact = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
    if (exact) {
      const marker = `__TESTMESH_RAW_VARIABLE_${markers.size}__`;
      markers.set(marker, exact[1]);
      return marker;
    }
    return template(value);
  }
  if (Array.isArray(value)) return value.map((item) => replaceJsonVariables(item, markers));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceJsonVariables(item, markers)]));
  return value;
}
function ensureJsonValue(value: unknown, path: string): void {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) { value.forEach((item, index) => ensureJsonValue(item, `${path}[${index}]`)); return; }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) { Object.entries(value).forEach(([key, item]) => ensureJsonValue(item, `${path}.${key}`)); return; }
  throw new Error(`${path} 只能包含 JSON 字符串、数字、布尔值、null、数组或对象`);
}
function template(value: string): string {
  if (/\$\{__/.test(value)) throw new Error("YAML 不执行自定义函数；随机/边界数据请交给 Schemathesis，确定值请写入场景或项目配置");
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "{{$1}}");
}
function singleLine(value: string): string { if (/\r|\n/.test(value)) throw new Error("Header、Query 和 Form 的名称/值不能包含换行"); return value; }
function safeComment(value: string): string { return value.replace(/[\r\n]+/g, " "); }
function normalizeDuration(value: string): string { return value.replace(/\s+/g, " "); }
