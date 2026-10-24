import { describe, expect, it, vi } from "vitest";
import { nativeTaskReadback } from "../services/native-task-readback.js";

function fixture() {
  const issue = { id: "task", companyId: "company", status: "in_progress",
    assigneeAgentId: "agent", assigneeUserId: null, executionRunId: "run", checkoutRunId: null };
  const run = { id: "run", companyId: "company", agentId: "agent", status: "running",
    contextSnapshot: { taskId: "task", toolToken: "must-not-return" },
    resultJson: { key: "must-not-return" } };
  const agent = { id: "agent", companyId: "company", status: "running",
    adapterConfig: { key: "must-not-return" } };
  const actor = { type: "agent", source: "agent_key", agentId: "agent", companyId: "company",
    keyScope: { kind: "skill_test", issueId: "task" } };
  const input = { actor, issueId: "task", loadIssue: vi.fn(async () => issue),
    loadRun: vi.fn(async () => run), loadAgent: vi.fn(async () => agent),
    authorizeIssue: vi.fn(async () => true), loadBlocker: vi.fn(async () => null as unknown),
    loadRecovery: vi.fn(async () => null as unknown) };
  return { input, issue, run, agent };
}

describe("native task readback", () => {
  it("returns only the server-selected task/run/agent projection", async () => {
    const { input } = fixture();
    const result = await nativeTaskReadback(input);
    expect(input.loadRun).toHaveBeenCalledWith("run");
    expect(input.loadAgent).toHaveBeenCalledWith("agent");
    expect(result.run.contextSnapshot).toEqual({ taskId: "task" });
    expect(JSON.stringify(result)).not.toContain("must-not-return");
    expect(Object.keys(result.agent).sort()).toEqual(["companyId", "id", "status"]);
  });
  it.each(["standard", "task_bridge", "other"])("denies %s keys before resource reads", async kind => {
    const { input } = fixture(); input.actor.keyScope.kind = kind;
    await expect(nativeTaskReadback(input)).rejects.toMatchObject({ status: 403 });
    expect(input.loadIssue).not.toHaveBeenCalled();
  });
  it("denies another task or agent and preserves issue authorization", async () => {
    for (const change of ["task", "agent", "access"]) {
      const { input, issue } = fixture();
      if (change === "task") input.issueId = "other";
      if (change === "agent") issue.assigneeAgentId = "other";
      if (change === "access") input.authorizeIssue.mockResolvedValue(false);
      await expect(nativeTaskReadback(input)).rejects.toMatchObject({ status: 403 });
      expect(input.loadRun).not.toHaveBeenCalled();
    }
  });
  it("uses the same not-found response for missing and cross-company tasks", async () => {
    const { input, issue } = fixture(); issue.companyId = "other";
    await expect(nativeTaskReadback(input)).rejects.toMatchObject({ status: 404, message: "Task not found" });
  });
  it("denies conflicting persisted context and cross-company run/agent rows", async () => {
    for (const change of ["context", "run", "agent"]) {
      const { input, run, agent } = fixture();
      if (change === "context") run.contextSnapshot.taskId = "other";
      if (change === "run") run.companyId = "other";
      if (change === "agent") agent.companyId = "other";
      await expect(nativeTaskReadback(input)).rejects.toMatchObject({ status: 403 });
    }
  });
  it("reports paused/terminal/recovery facts without granting execution", async () => {
    const { input, run, agent } = fixture();
    run.status = "cancelled"; agent.status = "paused";
    input.loadRecovery.mockResolvedValue({ secretDetail: "must-not-return" });
    const result = await nativeTaskReadback(input);
    expect(result.run.status).toBe("cancelled");
    expect(result.agent.status).toBe("paused");
    expect(result.issue.activeRecoveryAction).toEqual({ present: true });
    expect(JSON.stringify(result)).not.toContain("must-not-return");
  });
});
