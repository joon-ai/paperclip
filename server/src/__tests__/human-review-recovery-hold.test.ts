import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns, issues, issueThreadInteractions } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { hasPendingHumanReviewRecoveryHold } from "../services/human-review-recovery-hold.js";

const support = await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("human review recovery hold", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("human-review-recovery-hold-");
    db = createDb(temporary.connectionString);
  }, 30_000);
  afterAll(async () => { await temporary?.cleanup(); });

  async function seed(contextKey = "issueId") {
    const companyId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), sourceRunId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Review hold", issuePrefix: companyId.slice(0, 8) });
    await db.insert(agents).values({ id: agentId, companyId, name: "Worker", adapterType: "http" });
    await db.insert(issues).values({ id: issueId, companyId, title: "Review result", status: "in_progress", assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({ id: sourceRunId, companyId, agentId, status: "succeeded", contextSnapshot: { [contextKey]: issueId } });
    const [card] = await db.insert(issueThreadInteractions).values({
      companyId, issueId, sourceRunId, kind: "request_confirmation", status: "pending",
      effectiveResolverPolicy: "human_only", continuationPolicy: "none",
      payload: { version: 1, prompt: "Review the result." },
    }).returning();
    return { binding: { companyId, agentId, issueId, sourceRunId }, card };
  }

  it.each(["issueId", "taskId"])("holds the exact pending handoff (%s)", async contextKey => {
    const f = await seed(contextKey);
    expect(await hasPendingHumanReviewRecoveryHold(db, f.binding)).toBe(true);
    expect((await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, f.card.id)))[0]).toEqual(f.card);
  });

  it.each(["accepted", "rejected", "expired", "cancelled"])("does not hold a %s card", async status => {
    const f = await seed();
    await db.update(issueThreadInteractions).set({ status }).where(eq(issueThreadInteractions.id, f.card.id));
    expect(await hasPendingHumanReviewRecoveryHold(db, f.binding)).toBe(false);
  });

  it.each(["companyId", "issueId", "agentId", "sourceRunId"] as const)("does not cross the %s boundary", async key => {
    const f = await seed();
    expect(await hasPendingHumanReviewRecoveryHold(db, { ...f.binding, [key]: randomUUID() })).toBe(false);
  });

  it.each([
    { effectiveResolverPolicy: "anyone" as const },
    { continuationPolicy: "wake_assignee" },
    { kind: "ask_user_questions" },
    { sourceRunId: null },
  ])("does not reinterpret an unrelated card (%j)", async change => {
    const f = await seed();
    await db.update(issueThreadInteractions).set(change).where(eq(issueThreadInteractions.id, f.card.id));
    expect(await hasPendingHumanReviewRecoveryHold(db, f.binding)).toBe(false);
  });

  it("rejects a card whose source run belongs to another task", async () => {
    const f = await seed();
    await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: randomUUID() } }).where(eq(heartbeatRuns.id, f.binding.sourceRunId));
    expect(await hasPendingHumanReviewRecoveryHold(db, f.binding)).toBe(false);
  });
});
