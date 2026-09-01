import { parse as parseYaml } from "yaml";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"] as const;
export const MAX_OPENAPI_BYTES = 2 * 1024 * 1024;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value as UnknownRecord;
}

export interface ParsedOpenApi {
  name: string;
  version: string;
  operations: Array<{ operationId: string; method: string; path: string; summary: string }>;
}

export function parseOpenApi(content: string): ParsedOpenApi {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "无法解析";
    throw new Error(`OpenAPI JSON/YAML 解析失败：${detail}`, { cause: error });
  }

  const document = record(raw, "OpenAPI");
  const version = typeof document.openapi === "string" ? document.openapi : "";
  if (!version.startsWith("3.")) {
    throw new Error("P02 只接受 OpenAPI 3.x 文档");
  }
  const info = record(document.info, "OpenAPI.info");
  const name = typeof info.title === "string" && info.title.trim() ? info.title.trim() : "未命名 API";
  const apiVersion = typeof info.version === "string" ? info.version : "";
  const paths = record(document.paths, "OpenAPI.paths");
  const operations: ParsedOpenApi["operations"] = [];

  for (const [apiPath, pathValue] of Object.entries(paths)) {
    const pathItem = record(pathValue, `OpenAPI.paths.${apiPath}`);
    for (const method of HTTP_METHODS) {
      const value = pathItem[method];
      if (value === undefined) continue;
      const operation = record(value, `${method.toUpperCase()} ${apiPath}`);
      const operationId =
        typeof operation.operationId === "string" && operation.operationId.trim()
          ? operation.operationId.trim()
          : `${method.toUpperCase()} ${apiPath}`;
      operations.push({
        operationId,
        method: method.toUpperCase(),
        path: apiPath,
        summary: typeof operation.summary === "string" ? operation.summary : "",
      });
    }
  }

  if (operations.length === 0) {
    throw new Error("OpenAPI 没有可执行的 API operation");
  }
  return { name, version: apiVersion, operations };
}

export function validateTargetBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Target Base URL 不是有效 URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Target Base URL 只支持 HTTP 或 HTTPS");
  }
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function parseHeaderLines(value: unknown): Array<{ name: string; value: string }> {
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value) || value.length > 12) {
    throw new Error("Header 最多 12 条");
  }
  return value.map((entry) => {
    const item = record(entry, "Header");
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const headerValue = typeof item.value === "string" ? item.value : "";
    if (!name || /[\r\n:]/.test(name) || /[\r\n]/.test(headerValue)) {
      throw new Error("Header 名称或值无效");
    }
    return { name, value: headerValue };
  });
}
