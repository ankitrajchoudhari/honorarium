import { and, asc, countDistinct, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { ReviewerNameForm } from "@/components/reviewer-name-form";
import { LinkButton, Notice, PageTitle } from "@/components/ui";
import { db } from "@/db/client";
import { decisions, respondents, reviewVotes } from "@/db/schema";
import { getStudyOr404 } from "@/db/study-page";
import { requireWorkspace, reviewerName } from "@/lib/session";
import { ReviewQueue, type QueueEntry } from "./review-queue";

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage({ params }: PageProps<"/studies/[studyId]/review">) {
  const { studyId } = await params;
  const workspace = await requireWorkspace();
  const study = await getStudyOr404(workspace.id, studyId);
  const reviewer = await reviewerName();

  const held = await db()
    .select({ id: respondents.id, ref: respondents.respondentRef })
    .from(respondents)
    .where(and(eq(respondents.studyId, study.id), eq(respondents.currentDecision, "hold")))
    .orderBy(asc(respondents.rowNumber));
  const votes = await db()
    .select({ respondentId: reviewVotes.respondentId, reviewer: reviewVotes.reviewer, decision: reviewVotes.decision })
    .from(reviewVotes)
    .where(and(eq(reviewVotes.studyId, study.id), isNull(reviewVotes.resolvedDecisionId)));
  const [reviewed] = await db()
    .select({ total: countDistinct(decisions.respondentId) })
    .from(decisions)
    .where(and(eq(decisions.studyId, study.id), eq(decisions.source, "reviewer")));

  const queue: QueueEntry[] = held.map((row) => {
    const own = votes.filter((vote) => vote.respondentId === row.id);
    return {
      ref: row.ref,
      votes: own.map((vote) => ({ reviewer: vote.reviewer, decision: vote.decision })),
      disagree: new Set(own.map((vote) => vote.decision)).size > 1,
    };
  });

  return (
    <div className="space-y-4">
      <PageTitle description="Look at the evidence and decide. Every decision needs a reason and is recorded with your name.">Review queue</PageTitle>
      <ReviewerNameForm current={reviewer} />
      {study.twoReviewerMode && (
        <Notice title="Two-reviewer mode">A held response is resolved only when two different reviewers agree. Disagreements stay in the queue, marked as such.</Notice>
      )}
      {queue.length === 0 ? (
        <div className="space-y-3">
          <Notice title="Nothing is waiting for review." role="status">
            {(reviewed?.total ?? 0) > 0 ? `${reviewed?.total} responses were decided by reviewers.` : "Run verification first, or every response was decided by the rules."}
          </Notice>
          <LinkButton href={`/studies/${study.id}/payouts`} variant="primary">
            Go to payouts
          </LinkButton>
        </div>
      ) : reviewer ? (
        <ReviewQueue studyId={study.id} queue={queue} reviewedBefore={reviewed?.total ?? 0} reviewer={reviewer} twoReviewer={study.twoReviewerMode} />
      ) : (
        <Notice tone="warning" title="Enter your name to start reviewing" />
      )}
    </div>
  );
}
