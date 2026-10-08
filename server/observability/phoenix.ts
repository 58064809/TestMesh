import * as CallbackManagerModule from "@langchain/core/callbacks/manager";
import { LangChainInstrumentation } from "@arizeai/openinference-instrumentation-langchain";
import { OpenAIInstrumentation } from "@arizeai/openinference-instrumentation-openai";
import { register, type NodeTracerProvider } from "@arizeai/phoenix-otel";
import { createClient } from "@arizeai/phoenix-client";
import { getProjects } from "@arizeai/phoenix-client/projects";
import { trace } from "@opentelemetry/api";
import OpenAI from "openai";

let instrumentation: LangChainInstrumentation | undefined;
let openAIInstrumentation: OpenAIInstrumentation | undefined;
let provider: NodeTracerProvider | undefined;

export interface PhoenixTraceReference {
  provider: "phoenix";
  projectName: string;
  traceId: string;
}

export function currentPhoenixTraceReference(): PhoenixTraceReference | undefined {
  if (process.env.PHOENIX_ENABLED !== "true") return undefined;
  const traceId = trace.getActiveSpan()?.spanContext().traceId;
  if (!traceId || /^0+$/.test(traceId)) return undefined;
  return {
    provider: "phoenix",
    projectName: process.env.PHOENIX_PROJECT_NAME ?? "testmesh-requirement-analysis",
    traceId,
  };
}

export async function resolvePhoenixTraceUrl(reference: PhoenixTraceReference): Promise<string> {
  const endpoint = (process.env.PHOENIX_ENDPOINT ?? "http://127.0.0.1:6006").replace(/\/$/, "");
  try {
    const client = createClient({ options: { baseUrl: endpoint } });
    const projects = await getProjects({ client, nameContains: reference.projectName });
    const project = projects.find((item) => item.name === reference.projectName);
    if (project) return `${endpoint}/projects/${encodeURIComponent(project.id)}/spans/${reference.traceId}`;
  } catch {
    // The analysis remains valid when the optional local viewer is unavailable.
  }
  return `${endpoint}/projects`;
}

export function instrumentLangChainForPhoenix(): void {
  if (instrumentation) return;
  instrumentation = new LangChainInstrumentation();
  instrumentation.manuallyInstrument(CallbackManagerModule);
  openAIInstrumentation = new OpenAIInstrumentation();
  openAIInstrumentation.manuallyInstrument(OpenAI);
}

export function refreshPhoenixInstrumentationProvider(): void {
  const tracerProvider = trace.getTracerProvider();
  instrumentation?.setTracerProvider(tracerProvider);
  openAIInstrumentation?.setTracerProvider(tracerProvider);
}

export function initializePhoenixTracing(): NodeTracerProvider | undefined {
  if (process.env.PHOENIX_ENABLED !== "true") return undefined;
  if (provider) return provider;

  provider = register({
    projectName: process.env.PHOENIX_PROJECT_NAME ?? "testmesh-requirement-analysis",
    url: process.env.PHOENIX_ENDPOINT ?? "http://127.0.0.1:6006",
    batch: process.env.NODE_ENV === "production",
  });
  instrumentLangChainForPhoenix();
  instrumentation?.setTracerProvider(provider);
  openAIInstrumentation?.setTracerProvider(provider);
  return provider;
}
