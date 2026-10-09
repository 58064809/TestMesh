import { MODEL } from "../requirement-analysis/config.js";
import type { RequirementAnalysisPostgresStore } from "../requirement-analysis/postgres-store.js";
import { resolvePhoenixTraceUrl } from "../observability/phoenix.js";
import { createOpenAITestDesignModel, runTestDesignAgent } from "./agent.js";
import type { TestDesignPostgresStore } from "./postgres-store.js";
import { BaselineSnapshotSchema } from "./schema.js";

export class TestDesignService {
  constructor(
    private readonly requirementStore: RequirementAnalysisPostgresStore,
    private readonly testDesignStore: TestDesignPostgresStore,
  ) {}

  async generate(input: { baselineId: string; apiKey: string; requestedBy?: string }) {
    const existing = await this.testDesignStore.findByBaseline(input.baselineId);
    if (existing) return { record: existing, reused: true };
    const { snapshot } = await this.requirementStore.getBaseline(input.baselineId);
    const baseline = BaselineSnapshotSchema.parse(snapshot);
    const candidate = await runTestDesignAgent({
      baselineId: input.baselineId,
      baseline,
      model: createOpenAITestDesignModel(input.apiKey),
      requestedBy: input.requestedBy,
    });
    const record = await this.testDesignStore.createDesign({
      baselineId: input.baselineId,
      model: MODEL,
      document: candidate.result,
      trace: candidate.observability,
    });
    return {
      record,
      reused: false,
      usage: candidate.usage,
      skillActivations: candidate.skillActivations,
      traceUrl: candidate.observability ? await resolvePhoenixTraceUrl(candidate.observability) : "",
    };
  }
}
