import { parse } from "yaml";
import { z } from "zod";

const VariableFieldSchema = z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/, "字段名不合法");
const JsonPathSchema = z.string().trim().regex(/^\$(?:\.|\[)/, "必须是以 $. 或 $[ 开头的 JSONPath");

export const AgentExecutionContractSchema = z.object({
  format: z.literal("testmesh-agent-contract/v1"),
  target_id: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/),
  target_version: z.string().trim().min(1).max(100),
  interaction: z.enum(["single_turn", "multi_turn", "agent"]),
  openapi_sha256: z.string().regex(/^[0-9a-f]{64}$/i, "必须引用完整 OpenAPI 原文件 SHA-256"),
  operation_id: z.string().trim().min(1).max(200),
  request: z.object({
    message_field: VariableFieldSchema,
    session_field: VariableFieldSchema.optional(),
  }).strict(),
  response: z.object({
    answer_jsonpath: JsonPathSchema,
    session_jsonpath: JsonPathSchema.optional(),
    trace_id_jsonpath: JsonPathSchema,
  }).strict(),
  observability_standard: z.literal("openinference"),
  evaluation_provider: z.literal("phoenix"),
}).strict().superRefine((contract, context) => {
  if (contract.interaction !== "single_turn") {
    if (!contract.request.session_field) context.addIssue({ code: "custom", path: ["request", "session_field"], message: "多轮/Agent 契约必须声明请求会话字段" });
    if (!contract.response.session_jsonpath) context.addIssue({ code: "custom", path: ["response", "session_jsonpath"], message: "多轮/Agent 契约必须声明响应会话 JSONPath" });
  }
});

export type AgentExecutionContract = z.infer<typeof AgentExecutionContractSchema>;

export function parseAgentExecutionContract(content: string): AgentExecutionContract {
  let document: unknown;
  try { document = parse(content); } catch (error) {
    throw new Error(`Agent 契约 YAML/JSON 解析失败：${error instanceof Error ? error.message : "无法解析"}`, { cause: error });
  }
  const result = AgentExecutionContractSchema.safeParse(document);
  if (!result.success) throw new Error(result.error.issues.map((issue) => `${issue.path.join(".") || "root"}：${issue.message}`).join("；"));
  return result.data;
}
