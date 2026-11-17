import { parseOpenApi } from "../openapi.js";
import type { KnowledgePostgresStore } from "../knowledge/postgres-store.js";
import type { ProjectConfigPostgresStore } from "../project-config/postgres-store.js";
import { parseAgentExecutionContract } from "./agent-contract.js";

export interface ProjectContractReadiness {
  projectId: string;
  ready: boolean;
  openApiContracts: Array<{ documentId: string; filename: string; sha256: string; valid: boolean; name: string; version: string; operationCount: number; operationIds: string[]; error: string }>;
  agentContracts: Array<{ documentId: string; filename: string; sha256: string; valid: boolean; targetId: string; targetVersion: string; interaction: string; operationId: string; openApiSha256: string; error: string }>;
  blockers: string[];
}

export class ProjectContractReadinessService {
  constructor(private readonly projects: ProjectConfigPostgresStore, private readonly knowledge: KnowledgePostgresStore) {}

  async inspect(projectId: string): Promise<ProjectContractReadiness> {
    const bindings = await this.projects.listKnowledgeBindings(projectId);
    const openApiContracts = await Promise.all(bindings.filter((item) => item.role === "openapi").map(async (binding) => {
      try {
        const file = await this.knowledge.getFile(binding.documentId);
        const parsed = parseOpenApi(file.bytes.toString("utf8"));
        return { documentId: binding.documentId, filename: binding.filename, sha256: binding.sha256, valid: true, name: parsed.name, version: parsed.version, operationCount: parsed.operations.length, operationIds: parsed.operations.map((item) => item.operationId), error: "" };
      } catch (error) {
        return { documentId: binding.documentId, filename: binding.filename, sha256: binding.sha256, valid: false, name: "", version: "", operationCount: 0, operationIds: [], error: error instanceof Error ? error.message : "OpenAPI 解析失败" };
      }
    }));
    const agentContracts = await Promise.all(bindings.filter((item) => item.role === "agent_contract").map(async (binding) => {
      try {
        const file = await this.knowledge.getFile(binding.documentId);
        const parsed = parseAgentExecutionContract(file.bytes.toString("utf8"));
        return { documentId: binding.documentId, filename: binding.filename, sha256: binding.sha256, valid: true, targetId: parsed.target_id, targetVersion: parsed.target_version, interaction: parsed.interaction, operationId: parsed.operation_id, openApiSha256: parsed.openapi_sha256, error: "" };
      } catch (error) {
        return { documentId: binding.documentId, filename: binding.filename, sha256: binding.sha256, valid: false, targetId: "", targetVersion: "", interaction: "", operationId: "", openApiSha256: "", error: error instanceof Error ? error.message : "Agent 契约解析失败" };
      }
    }));
    const validOpenApi = openApiContracts.filter((item) => item.valid);
    const openApiBySha = new Map(validOpenApi.map((item) => [item.sha256, item]));
    const crossCheckedAgentContracts = agentContracts.map((item) => {
      if (!item.valid) return item;
      const openapi = openApiBySha.get(item.openApiSha256);
      if (!openapi) return { ...item, valid: false, error: "引用的 OpenAPI SHA-256 未绑定到当前项目或未通过校验" };
      if (!openapi.operationIds.includes(item.operationId)) return { ...item, valid: false, error: `OpenAPI 中不存在 operationId ${item.operationId}` };
      return item;
    });
    const validAgents = crossCheckedAgentContracts.filter((item) => item.valid);
    const blockers = [
      ...(validOpenApi.length ? [] : ["项目尚未绑定可通过完整原文件校验的 OpenAPI 契约"]),
      ...(validAgents.length ? [] : ["项目尚未绑定可通过结构及 OpenAPI 引用校验的 Agent 会话/Trace 契约"]),
      ...openApiContracts.filter((item) => !item.valid).map((item) => `${item.filename}：${item.error}`),
      ...crossCheckedAgentContracts.filter((item) => !item.valid).map((item) => `${item.filename}：${item.error}`),
    ];
    return { projectId, ready: blockers.length === 0, openApiContracts, agentContracts: crossCheckedAgentContracts, blockers };
  }
}
