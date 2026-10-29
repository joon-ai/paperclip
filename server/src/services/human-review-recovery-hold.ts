import { and, eq, or, sql } from "drizzle-orm";
import { heartbeatRuns, issueThreadInteractions, type Db } from "@paperclipai/db";

/** A pending human handoff is not evidence that its source work is stranded.
 * Match the exact source run so an older review cannot hold unrelated work.
 * This predicate only denies automatic recovery; it never authorizes a wake.
 */
export async function hasPendingHumanReviewRecoveryHold(
  db: Db,
  binding: { companyId: string; issueId: string; agentId: string; sourceRunId: string },
): Promise<boolean> {
  const [review] = await db
    .select({ id: issueThreadInteractions.id })
    .from(issueThreadInteractions)
    .innerJoin(heartbeatRuns, eq(heartbeatRuns.id, issueThreadInteractions.sourceRunId))
    .where(and(
      eq(issueThreadInteractions.companyId, binding.companyId),
      eq(issueThreadInteractions.issueId, binding.issueId),
      eq(issueThreadInteractions.sourceRunId, binding.sourceRunId),
      eq(issueThreadInteractions.kind, "request_confirmation"),
      eq(issueThreadInteractions.status, "pending"),
      eq(issueThreadInteractions.effectiveResolverPolicy, "human_only"),
      eq(issueThreadInteractions.continuationPolicy, "none"),
      eq(heartbeatRuns.companyId, binding.companyId),
      eq(heartbeatRuns.agentId, binding.agentId),
      or(
        sql`${heartbeatRuns.contextSnapshot}->>'issueId' = ${binding.issueId}`,
        sql`${heartbeatRuns.contextSnapshot}->>'taskId' = ${binding.issueId}`,
      ),
    ))
    .limit(1);
  return Boolean(review);
}
