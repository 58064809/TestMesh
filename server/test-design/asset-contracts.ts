import { z } from "zod";
import { TestConditionSchema, TestDesignSchema, TestModelDocumentSchema } from "./schema.js";

export const ASSET_SCHEMA_VERSIONS = {
  testModel: "test-model/v2",
  testCondition: "test-condition-set/v1",
  testCase: "test-case-set/v1",
  datasetSample: "dataset-sample/v1",
} as const;

export const PROMPT_VERSIONS = {
  testModel: "test-model-generation/v2",
  testCondition: "test-condition-generation/v1",
  testCase: "test-case-generation/v1",
} as const;

export const TestModelAssetSchema = z.object({
  schemaVersion: z.literal(ASSET_SCHEMA_VERSIONS.testModel),
  baselineId: z.string().min(1),
  promptVersion: z.literal(PROMPT_VERSIONS.testModel),
  document: TestModelDocumentSchema.refine((document) => Boolean(document.behavior_models), "test-model/v2 必须包含 M-01～M-04 四个行为模型"),
}).strict();

export const TestConditionSetDocumentSchema = z.object({
  schemaVersion: z.literal(ASSET_SCHEMA_VERSIONS.testCondition),
  baselineId: z.string().min(1),
  approvedTestModelVersionId: z.string().min(1),
  objective: z.string().min(1),
  conditions: z.array(TestConditionSchema).min(1),
  generation: z.object({
    mode: z.enum(["prompt", "approved_model_projection"]),
    promptVersion: z.literal(PROMPT_VERSIONS.testCondition).nullable(),
    note: z.string(),
  }).strict(),
}).strict();

export const TestCaseSetAssetSchema = z.object({
  schemaVersion: z.literal(ASSET_SCHEMA_VERSIONS.testCase),
  baselineId: z.string().min(1),
  approvedTestModelVersionId: z.string().min(1),
  approvedTestConditionVersionId: z.string().min(1),
  promptVersion: z.literal(PROMPT_VERSIONS.testCase),
  document: TestDesignSchema,
}).strict();

const DatasetConversationTurnSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().min(1),
  name: z.string().min(1).optional(),
}).strict();

export const DatasetSampleAssetSchema = z.object({
  schemaVersion: z.literal(ASSET_SCHEMA_VERSIONS.datasetSample),
  payload: z.object({
    approvedTestCaseId: z.string().regex(/^TC-\d{3}$/),
    input: z.object({
      message: z.string().trim().min(1).optional(),
      conversation: z.array(DatasetConversationTurnSchema).optional(),
      context: z.record(z.string(), z.unknown()).optional(),
    }).strict().refine((value) => Boolean(value.message || value.conversation?.length), "样本必须提供 message 或 conversation"),
    expected: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, "expected 至少需要一个可判定字段"),
    metadata: z.record(z.string(), z.unknown()),
    operator: z.string().trim().min(1).max(100),
  }).strict(),
}).strict();

export type TestConditionSetDocument = z.infer<typeof TestConditionSetDocumentSchema>;

