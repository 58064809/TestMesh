import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@arizeai/phoenix-client";
import { createDataset, getDataset } from "@arizeai/phoenix-client/datasets";
import { ControlledBenchmarkSchema, benchmarkSummary } from "../server/ai-quality/benchmark.js";

const projectRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(projectRoot, "evaluation", "requirement-analysis-controlled-v0.json");
const benchmark = ControlledBenchmarkSchema.parse(JSON.parse(await readFile(sourcePath, "utf8")));
const endpoint = process.env.PHOENIX_ENDPOINT ?? "http://127.0.0.1:6006";
const client = createClient({ options: { baseUrl: endpoint } });
const datasetName = "testmesh-requirement-analysis-controlled";

const examples = benchmark.cases.map((item) => ({
  id: item.id,
  input: {
    message: "请找出这份需求中存在的缺失、歧义或冲突，并提供可核验的段落引用。",
    sourceFilename: `${item.id}.md`,
    documentText: item.documentText,
  },
  output: item.expected,
  metadata: {
    benchmarkVersion: benchmark.version,
    dataClass: benchmark.status,
    mutationKind: item.mutation.kind,
    mutationDescription: item.mutation.description,
    limitation: "受控合成样本，不代表真实业务分布",
  },
  splits: ["controlled", item.expected.issueType, benchmark.version],
}));

const { datasetId } = await createDataset({
  client,
  name: datasetName,
  description: `${benchmark.description} ${benchmark.limitations.join(" ")}`,
  examples,
});
const { versionId } = await getDataset({ client, dataset: { datasetId } });

console.log(JSON.stringify({
  endpoint,
  datasetName,
  datasetId,
  versionId,
  ...benchmarkSummary(benchmark),
}, null, 2));
