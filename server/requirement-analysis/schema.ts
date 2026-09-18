import { z } from "zod";
import { PDF_PAGE_LOCATOR_PATTERN, type SourceFile } from "./sources.js";

export const AnalysisItemSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  origin: z.enum(["explicit", "inferred"]),
  source_refs: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
}).strict();

export const OpenQuestionSchema = AnalysisItemSchema.extend({
  issue_type: z.enum(["missing", "ambiguity", "conflict"]),
}).strict();

export const ModelSourceSchema = AnalysisItemSchema.extend({
  source_file_id: z.string().min(1),
  locator_type: z.enum(["page", "paragraph", "image", "limited"]),
  locator: z.string(),
  excerpt: z.string(),
}).strict();

const modelSourceFields = {
  ...AnalysisItemSchema.shape,
  excerpt: z.string(),
};

export function createModelRequirementAnalysisSchema(sources: readonly SourceFile[]) {
  if (sources.length === 0) throw new Error("至少需要一个来源才能构建 RequirementAnalysis Schema");
  const variants: z.ZodType[] = [];
  for (const source of sources) {
    const base = {
      ...modelSourceFields,
      source_file_id: z.literal(source.id),
    };
    if (source.capability === "page") {
      const locator = z.string().regex(
        PDF_PAGE_LOCATOR_PATTERN,
        "PDF 页码或图片定位需要包含可核对页码，例如“第 3 页”",
      );
      variants.push(
        z.object({ ...base, locator_type: z.literal("page"), locator }).strict(),
        z.object({ ...base, locator_type: z.literal("image"), locator }).strict(),
      );
    } else if (source.capability === "paragraph") {
      variants.push(z.object({
        ...base,
        locator_type: z.literal("paragraph"),
        locator: z.string().min(1),
      }).strict());
    } else if (source.capability === "image") {
      variants.push(z.object({
        ...base,
        locator_type: z.literal("image"),
        locator: z.string().min(1),
      }).strict());
    } else {
      variants.push(z.object({
        ...base,
        locator_type: z.literal("limited"),
        locator: z.string(),
      }).strict());
    }
  }
  const sourceSchema = variants.length === 1
    ? variants[0]
    : z.union(variants as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  return z.object({
    ...documentFields,
    sources: z.array(sourceSchema),
  }).strict();
}

const documentFields = {
  summary: AnalysisItemSchema.nullable(),
  requirements: z.array(AnalysisItemSchema.extend({ acceptance_criteria: z.array(z.string()) })),
  actors: z.array(AnalysisItemSchema),
  business_rules: z.array(AnalysisItemSchema),
  flows: z.array(AnalysisItemSchema),
  states: z.array(AnalysisItemSchema),
  constraints: z.array(AnalysisItemSchema),
  exceptions: z.array(AnalysisItemSchema),
  open_questions: z.array(OpenQuestionSchema),
};

export const ModelRequirementAnalysisSchema = z.object({
  ...documentFields,
  sources: z.array(ModelSourceSchema),
}).strict();

export const RequirementAnalysisSchema = z.object({
  ...documentFields,
  sources: z.array(ModelSourceSchema.extend({ source_file_name: z.string().min(1) })),
}).strict();

export type ModelRequirementAnalysis = z.infer<typeof ModelRequirementAnalysisSchema>;
export type RequirementAnalysis = z.infer<typeof RequirementAnalysisSchema>;
