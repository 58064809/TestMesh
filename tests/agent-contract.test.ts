import { describe, expect, it } from "vitest";
import { parseAgentExecutionContract } from "../server/ai-quality/agent-contract.js";

const valid = `format: testmesh-agent-contract/v1
target_id: after-sales-agent
target_version: candidate-v1
interaction: agent
openapi_sha256: ${"a".repeat(64)}
operation_id: chatWithAgent
request:
  message_field: message
  session_field: sessionId
response:
  answer_jsonpath: $.data.answer
  session_jsonpath: $.data.sessionId
  trace_id_jsonpath: $.meta.traceId
observability_standard: openinference
evaluation_provider: phoenix
`;

describe("AIAT04 Agent execution contract", () => {
  it("accepts an explicit OpenAPI-linked multi-turn/OpenInference contract", () => {
    expect(parseAgentExecutionContract(valid)).toMatchObject({ operation_id: "chatWithAgent", interaction: "agent" });
  });

  it("rejects multi-turn contracts without request and response session fields", () => {
    expect(() => parseAgentExecutionContract(valid.replace("  session_field: sessionId\n", "").replace("  session_jsonpath: $.data.sessionId\n", ""))).toThrow("会话");
  });

  it("rejects unversioned OpenAPI references and non-Phoenix evaluation providers", () => {
    expect(() => parseAgentExecutionContract(valid.replace("a".repeat(64), "latest"))).toThrow("SHA-256");
    expect(() => parseAgentExecutionContract(valid.replace("evaluation_provider: phoenix", "evaluation_provider: custom"))).toThrow("phoenix");
  });
});
