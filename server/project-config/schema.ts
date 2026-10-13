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
}).strict();

export const ProjectAutomationConfigInputSchema = z.object({
  defaultApiEnvironmentId: z.string().trim().default(""),
  defaultUiEnvironmentId: z.string().trim().default(""),
  uiRepositoryPath: z.string().trim().max(1_000).default(""),
}).strict();

export type ProjectInput = z.infer<typeof ProjectInputSchema>;
export type ProjectEnvironmentInput = z.infer<typeof ProjectEnvironmentInputSchema>;
export type ProjectAutomationConfigInput = z.infer<typeof ProjectAutomationConfigInputSchema>;

