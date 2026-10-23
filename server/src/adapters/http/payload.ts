import type { AdapterExecutionContext } from "../types.js";
import { parseObject } from "../utils.js";

export type HttpPayloadMode = "agent" | "callback_v1";

export function validateHttpPayloadConfig(config: Record<string, unknown>): HttpPayloadMode {
  const mode = config.payloadMode === undefined ? "agent" : config.payloadMode;
  if (mode !== "agent" && mode !== "callback_v1") {
    throw new Error('HTTP payloadMode must be "agent" or "callback_v1"');
  }
  if (mode === "callback_v1" && config.payloadTemplate !== undefined) {
    const template = config.payloadTemplate;
    if (!template || typeof template !== "object" || Array.isArray(template) || Object.keys(template).length > 0) {
      throw new Error("HTTP callback_v1 does not support payloadTemplate fields");
    }
  }
  return mode;
}

export function buildHttpPayload(ctx: AdapterExecutionContext): Record<string, unknown> {
  const { agent, runId, context, config } = ctx;
  if (validateHttpPayloadConfig(config) === "agent") {
    return {
      ...parseObject(config.payloadTemplate),
      agentId: agent.id,
      runId,
      context,
      connectionInstructions: context.connectionInstructions ?? null,
      ...(ctx.runtimeTools ? { paperclipRuntimeTools: ctx.runtimeTools } : {}),
    };
  }

  // Project a fixed data contract. A denylist could miss future credentials or
  // capabilities added to context by heartbeat execution or a plugin.
  const task: Record<string, string> = {};
  for (const field of ["issueId", "taskId"] as const) {
    const value = context[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
      throw new Error("HTTP callback_v1 requires non-empty task identifier strings");
    }
    task[field] = value;
  }
  if (!task.issueId && !task.taskId) {
    throw new Error("HTTP callback_v1 requires an issueId or taskId");
  }
  if (task.issueId && task.taskId && task.issueId !== task.taskId) {
    throw new Error("HTTP callback_v1 task identifiers must refer to the same task");
  }
  return { agentId: agent.id, runId, context: task, connectionInstructions: null };
}
