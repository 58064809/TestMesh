import {
  StageProfileSchema,
  TaskManifestSchema,
  type StageProfile,
  type TaskManifest,
} from "./contracts.js";

export interface HarnessCapabilityCatalog {
  knowledge: ReadonlySet<string>;
  skills: ReadonlySet<string>;
  tools: ReadonlySet<string>;
}

export interface AssembledStage {
  task: TaskManifest;
  profile: StageProfile;
  context_refs: TaskManifest["input_refs"];
  knowledge_ids: string[];
  skill_ids: string[];
  tool_ids: string[];
  policy_ids: string[];
  output_schema: StageProfile["output_schema"];
  unavailable_optional: Array<{ kind: "context" | "knowledge" | "skill" | "tool"; id: string }>;
}

export function assembleStage(
  taskInput: unknown,
  profileInput: unknown,
  catalog: HarnessCapabilityCatalog,
): AssembledStage {
  const task = TaskManifestSchema.parse(taskInput);
  const profile = StageProfileSchema.parse(profileInput);
  if (task.stage !== profile.id) {
    throw new Error(`任务阶段 ${task.stage} 与 Stage Profile ${profile.id} 不一致`);
  }
  if (task.stage_profile_version !== profile.version) {
    throw new Error(`任务要求 Profile ${task.stage_profile_version}，当前为 ${profile.version}`);
  }

  const unavailableOptional: AssembledStage["unavailable_optional"] = [];
  for (const binding of profile.context) {
    const refs = task.input_refs.filter((item) => item.slot === binding.id);
    if (binding.required && refs.length === 0) throw new Error(`缺少必需 Context：${binding.id}`);
    if (!binding.required && refs.length === 0) unavailableOptional.push({ kind: "context", id: binding.id });
  }

  const select = (
    kind: "knowledge" | "skill" | "tool",
    bindings: Array<{ id: string; required: boolean }>,
    available: ReadonlySet<string>,
  ): string[] => {
    const selected: string[] = [];
    for (const binding of bindings) {
      if (available.has(binding.id)) selected.push(binding.id);
      else if (binding.required) throw new Error(`缺少必需 ${kind}：${binding.id}`);
      else unavailableOptional.push({ kind, id: binding.id });
    }
    return selected;
  };

  const allowedContextSlots = new Set(profile.context.map((item) => item.id));
  const contextRefs = task.input_refs.filter((item) => allowedContextSlots.has(item.slot));
  const undeclared = task.input_refs.filter((item) => !allowedContextSlots.has(item.slot));
  if (undeclared.length > 0) {
    throw new Error(`任务包含 Stage Profile 未声明的 Context：${undeclared.map((item) => item.slot).join("、")}`);
  }

  return {
    task,
    profile,
    context_refs: contextRefs,
    knowledge_ids: select("knowledge", profile.knowledge, catalog.knowledge),
    skill_ids: select("skill", profile.skills, catalog.skills),
    tool_ids: select("tool", profile.tools, catalog.tools),
    policy_ids: profile.policies.map((item) => item.id),
    output_schema: profile.output_schema,
    unavailable_optional: unavailableOptional,
  };
}
