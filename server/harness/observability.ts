import type { HarnessRunStore, HarnessTraceEvent } from "./run-store.js";

type StreamTuple = [string, Record<string, unknown>];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStreamTuple(value: unknown): StreamTuple | null {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" || !isRecord(value[1])) {
    return null;
  }
  return [value[0], value[1]];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function projectLangGraphTraceChunk(chunk: unknown): HarnessTraceEvent | null {
  const tuple = asStreamTuple(chunk);
  if (!tuple) return null;
  const [mode, data] = tuple;

  if (mode === "tasks") {
    const name = typeof data.name === "string" ? data.name : null;
    if (!name) return null;
    if ("input" in data) return { kind: "node_started", name, message: null };
    if ("result" in data) {
      const interrupts = Array.isArray(data.interrupts) ? data.interrupts : [];
      return {
        kind: interrupts.length > 0 ? "node_interrupted" : "node_completed",
        name,
        message: null,
      };
    }
    return null;
  }

  if (mode === "tools") {
    const name = typeof data.name === "string" ? data.name : null;
    if (!name || typeof data.event !== "string") return null;
    if (data.event === "on_tool_start") return { kind: "tool_started", name, message: null };
    if (data.event === "on_tool_end") return { kind: "tool_completed", name, message: null };
    if (data.event === "on_tool_error") {
      return {
        kind: "tool_failed",
        name,
        message: "error" in data ? errorMessage(data.error) : "工具执行失败",
      };
    }
  }

  return null;
}

export async function recordLangGraphTrace(input: {
  runId: string;
  stream: AsyncIterable<unknown>;
  runStore: HarnessRunStore;
}): Promise<void> {
  const activeNodes = new Map<string, number>();
  try {
    for await (const chunk of input.stream) {
      const event = projectLangGraphTraceChunk(chunk);
      if (!event) continue;
      if (event.kind === "node_started") {
        activeNodes.set(event.name, (activeNodes.get(event.name) ?? 0) + 1);
      } else if (event.kind === "node_completed" || event.kind === "node_interrupted") {
        const count = activeNodes.get(event.name) ?? 0;
        if (count <= 1) activeNodes.delete(event.name);
        else activeNodes.set(event.name, count - 1);
      }
      await input.runStore.appendTraceEvent(input.runId, event);
    }
  } catch (error) {
    const activeNames = [...activeNodes.keys()];
    const failureStage = activeNames.length === 1 ? activeNames[0] : "graph";
    await input.runStore.appendTraceEvent(input.runId, {
      kind: "run_failed",
      name: failureStage,
      message: errorMessage(error),
    });
    await input.runStore.update(input.runId, {
      status: "failed",
      failure_stage: failureStage,
      failure_reason: errorMessage(error),
    });
    throw error;
  }
}
