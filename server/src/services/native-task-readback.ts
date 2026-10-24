import { forbidden, notFound } from "../errors.js";

type Actor = {
  type: string;
  source?: string;
  agentId?: string;
  companyId?: string;
  keyScope?: { kind: string; issueId?: string };
};
type Issue = {
  id: string; companyId: string; status: string;
  assigneeAgentId: string | null; assigneeUserId: string | null;
  executionRunId: string | null; checkoutRunId: string | null;
};
type Run = {
  id: string; companyId: string; agentId: string; status: string;
  contextSnapshot: unknown;
};
type Agent = { id: string; companyId: string; status: string };

export async function nativeTaskReadback(input: {
  actor: Actor;
  issueId: string;
  loadIssue: (id: string) => Promise<Issue | null>;
  loadRun: (id: string) => Promise<Run | null>;
  loadAgent: (id: string) => Promise<Agent | null>;
  authorizeIssue: (issue: Issue) => Promise<boolean>;
  loadBlocker: (company: string, issue: string) => Promise<unknown>;
  loadRecovery: (company: string, issue: string) => Promise<unknown>;
}) {
  const { actor, issueId } = input;
  // This read exception is narrower than company telemetry. It accepts no
  // caller-selected run/agent, and never returns configs, logs or tools.
  if (actor.type !== "agent" || actor.source !== "agent_key" || !actor.agentId ||
      actor.keyScope?.kind !== "skill_test" || actor.keyScope.issueId !== issueId) {
    throw forbidden("An exact task-scoped agent key is required");
  }
  const issue = await input.loadIssue(issueId);
  if (!issue || issue.companyId !== actor.companyId) throw notFound("Task not found");
  if (!(await input.authorizeIssue(issue)) || issue.assigneeAgentId !== actor.agentId ||
      issue.assigneeUserId !== null || !issue.executionRunId) {
    throw forbidden("The task must be assigned to this agent with a current run");
  }
  const [run, agent, blocker, recovery] = await Promise.all([
    input.loadRun(issue.executionRunId), input.loadAgent(actor.agentId),
    input.loadBlocker(issue.companyId, issue.id), input.loadRecovery(issue.companyId, issue.id),
  ]);
  const context = run?.contextSnapshot;
  const ids = context && typeof context === "object" && !Array.isArray(context)
    ? context as Record<string, unknown> : {};
  const taskIds = [ids.taskId, ids.issueId].filter(value => value !== undefined);
  if (!run || run.id !== issue.executionRunId || run.companyId !== issue.companyId ||
      run.agentId !== actor.agentId || !agent || agent.id !== actor.agentId ||
      agent.companyId !== issue.companyId || taskIds.length === 0 ||
      taskIds.some(value => value !== issue.id)) {
    throw forbidden("Stored task, run and agent identities must agree");
  }
  return {
    issue: {
      id: issue.id, companyId: issue.companyId, status: issue.status,
      assigneeAgentId: issue.assigneeAgentId, assigneeUserId: issue.assigneeUserId,
      executionRunId: issue.executionRunId, checkoutRunId: issue.checkoutRunId,
      executionBlocker: blocker ? { present: true } : null,
      activeRecoveryAction: recovery ? { present: true } : null,
    },
    run: { id: run.id, companyId: run.companyId, agentId: run.agentId,
      status: run.status, contextSnapshot: { taskId: issue.id } },
    agent: { id: agent.id, companyId: agent.companyId, status: agent.status },
  };
}
