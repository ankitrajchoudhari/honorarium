import { notFound } from "next/navigation";
import { MoneyStrip } from "@/components/money-strip";
import { Shell } from "@/components/shell";
import { RuleStamp } from "@/components/ui";
import { db } from "@/db/client";
import { getStudy, ruleSetVersions } from "@/db/queries";
import { ledgerStatus } from "@/ledger/ledger";
import { formatCents } from "@/lib/money";
import { currentWorkspace } from "@/lib/session";
import { StudyTabs } from "./study-tabs";

export default async function StudyLayout({ children, params }: LayoutProps<"/studies/[studyId]">) {
  const { studyId } = await params;
  const workspace = await currentWorkspace();
  const study = workspace ? await getStudy(workspace.id, studyId) : null;
  if (!study) {
    notFound();
  }
  const [versions, ledger] = await Promise.all([ruleSetVersions(study.id), ledgerStatus(db(), study.id, study.budgetCents)]);
  const latest = versions[0];
  const locked = versions.find((version) => version.lockedAt);
  const stampSource = locked ?? latest;

  return (
    <Shell>
      <header className="border-b border-rule bg-surface px-4 pt-6">
        <div className="mx-auto max-w-[1280px] space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">{study.title}</h1>
              <p className="mt-1 text-sm text-muted">
                <span className="font-mono font-semibold text-primary">{study.shortCode}</span>
                {study.protocolNumber ? ` · ${study.protocolNumber}` : ""} · PI {study.piName} · {formatCents(study.amountPerParticipantCents)} per participant
                {study.twoReviewerMode ? " · two-reviewer mode" : ""}
              </p>
            </div>
            {stampSource && <RuleStamp version={stampSource.version} sha256={stampSource.sha256} lockedAt={stampSource.lockedAt} />}
          </div>
          <MoneyStrip balances={ledger.balances} budgetCents={study.budgetCents} />
          {!ledger.invariant.balanced && (
            <div role="alert" className="rounded-md border border-dont-pay/30 bg-dont-pay-soft px-4 py-3 font-semibold text-dont-pay">
              Ledger out of balance by {formatCents(ledger.invariant.difference)}. All payout actions are blocked until this is investigated.
            </div>
          )}
          <StudyTabs studyId={study.id} />
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[1280px] px-4 py-6">
        {children}
      </main>
    </Shell>
  );
}
