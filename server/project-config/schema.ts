import { z } from "zod";
import { validateTargetBaseUrl } from "../openapi.js";

const SENSITIVE_HEADER = /(^authorization$|^cookie$|^set-cookie$|^proxy-authorization$|token|secret|password|api[-_]?key)/i;

export const ProjectInputSchema = z.object({
  name: z.string().trim().min(1, "请填写项目名称").max(80),
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{1,31}$/, "项目标识只能使用 2-32 位小写字母、数字、下划线或短横线"),
  description: z.string().trim().max(500).default(""),
}).strict();

export const EnvironmentHeaderSchema = z.object({
  name: z.string().trim().min(1).max(100),
  value: z.string().trim().max(2_000),
}).strict().superRefine((header, context) => {
  if (SENSITIVE_HEADER.test(header.name)) {
    context.addIssue({
      code: "custom",
      message: `${header.name} 可能包含凭据，不能保存到 TestMesh；请在执行时临时输入，或接入 Infisical`,
    });
  }
});

export const EnvironmentVariableSchema = z.object({
  name: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "变量名只能使用字母、数字和下划线，且不能以数字开头"),
  value: z.string().max(10_000),
}).strict().superRefine((variable, context) => {
  if (variable.name === "baseUrl") {
    context.addIssue({ code: "custom", message: "baseUrl 是 TestMesh 保留变量，由环境 Base URL 自动提供" });
  }
  if (SENSITIVE_HEADER.test(variable.name)) {
    context.addIssue({
      code: "custom",
      message: `${variable.name} 可能包含凭据，不能保存到 TestMesh；请在执行时临时输入，或接入 Infisical`,
    });
  }
});

export const ProjectEnvironmentInputSchema = z.object({
  name: z.string().trim().min(1, "请填写环境名称").max(50),
  baseUrl: z.string().trim().min(1, "请填写 Base URL").transform((value, context) => {
    try {
      return validateTargetBaseUrl(value);
    } catch (error) {
      context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Base URL 不合法" });
      return z.NEVER;
    }
  }),
  headers: z.array(EnvironmentHeaderSchema).max(30).default([]),
  variables: z.array(EnvironmentVariableSchema).max(50).default([]),
}).strict();

export const ProjectAutomationConfigInputSchema = z.object({
  defaultApiEnvironmentId: z.string().trim().default(""),
  defaultUiEnvironmentId: z.string().trim().default(""),
  uiRepositoryPath: z.string().trim().max(1_000).default(""),
}).strict();

export const ProjectKnowledgeBindingInputSchema = z.object({
  documentId: z.string().trim().min(1),
  role: z.enum(["openapi", "agent_contract", "business_rules", "test_data"]),
  boundBy: z.string().trim().min(1).max(100),
}).strict();

export type ProjectInput = z.infer<typeof ProjectInputSchema>;
export type ProjectEnvironmentInput = z.infer<typeof ProjectEnvironmentInputSchema>;
export type ProjectAutomationConfigInput = z.infer<typeof ProjectAutomationConfigInputSchema>;
export type ProjectKnowledgeBindingInput = z.infer<typeof ProjectKnowledgeBindingInputSchema>;

