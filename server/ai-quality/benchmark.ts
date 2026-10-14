import { z } from "zod";

const ControlledCaseSchema = z.object({
  id: z.string().regex(/^(MISSING|AMBIGUITY|CONFLICT)(?:-[A-Z]+)+-\d{3}$/),
  title: z.string().min(1),
  documentText: z.string().min(20),
  expected: z.object({
    issueType: z.enum(["missing", "ambiguity", "conflict"]),
    terms: z.array(z.string().min(1)).min(2),
    paragraphs: z.array(z.number().int().positive()).min(1),
    summary: z.string().min(1),
  }).strict(),
  mutation: z.object({
    kind: z.string().min(1),
    description: z.string().min(1),
  }).strict(),
}).strict();

export const ControlledBenchmarkSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  status: z.literal("controlled-synthetic"),
  description: z.string().min(1),
  limitations: z.array(z.string().min(1)).min(1),
  cases: z.array(ControlledCaseSchema).min(20),
}).strict().superRefine((benchmark, context) => {
  const ids = new Set<string>();
  const mutationKinds = new Set<string>();
  const counts = { missing: 0, ambiguity: 0, conflict: 0 };
  for (const [index, item] of benchmark.cases.entries()) {
    if (ids.has(item.id)) {
      context.addIssue({ code: "custom", path: ["cases", index, "id"], message: `样本 ID 重复：${item.id}` });
    }
    ids.add(item.id);
    if (mutationKinds.has(item.mutation.kind)) {
      context.addIssue({ code: "custom", path: ["cases", index, "mutation", "kind"], message: `变异类型重复：${item.mutation.kind}` });
    }
    mutationKinds.add(item.mutation.kind);
    counts[item.expected.issueType] += 1;
  }
  for (const [issueType, count] of Object.entries(counts)) {
    if (count < 6) {
      context.addIssue({ code: "custom", path: ["cases"], message: `${issueType} 样本至少需要 6 条，当前 ${count} 条` });
    }
  }
});

export type ControlledBenchmark = z.infer<typeof ControlledBenchmarkSchema>;

export function benchmarkSummary(benchmark: ControlledBenchmark) {
  const issueTypes = { missing: 0, ambiguity: 0, conflict: 0 };
  for (const item of benchmark.cases) issueTypes[item.expected.issueType] += 1;
  return {
    total: benchmark.cases.length,
    issueTypes,
    mutationKinds: new Set(benchmark.cases.map((item) => item.mutation.kind)).size,
  };
}
