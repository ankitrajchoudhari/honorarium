"use client";

import { MdVisibility } from "react-icons/md";
import { useCallback, useEffect, useState } from "react";
import { DecisionChip, EvidenceChip, LocalTime } from "@/components/ui";
import type { Decision } from "@/engine/types";
import { formatCents } from "@/lib/money";
import type { RespondentDetail } from "@/respondents/detail";

export function useRespondent(studyId: string, ref: string | null) {
  const [detail, setDetail] = useState<RespondentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!ref) {
      return;
    }
    let cancelled = false;
    fetch(`/api/studies/${studyId}/respondents/${encodeURIComponent(ref)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error((await response.json().catch(() => null))?.error ?? `HTTP ${response.status}`);
        }
        return (await response.json()) as RespondentDetail;
      })
      .then((data) => {
        if (!cancelled) {
          setDetail(data);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Could not load this respondent.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [studyId, ref, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { detail: detail?.ref === ref ? detail : null, error, reload };
}

const LAYER_LABEL: Record<string, string> = { deterministic: "Rules", similarity: "Similarity", ai: "AI review (Gemini)" };

function Highlighted({ text, quote }: { text: string; quote?: string }) {
  if (!quote) {
    return <>{text}</>;
  }
  const index = text.indexOf(quote);
  if (index === -1) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-[2px] bg-hold/25 px-0.5 text-ink">{quote}</mark>
      {text.slice(index + quote.length)}
    </>
  );
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return "unknown";
  }
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${Math.round(seconds % 60)}s` : `${Math.round(seconds)}s`;
}

export function RespondentEvidence({ studyId, detail }: { studyId: string; detail: RespondentDetail }) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const quotes = new Map<string, string>();
  for (const check of detail.checks) {
    const column = check.evidence.values?.column;
    if (check.layer === "ai" && typeof column === "string" && check.evidence.quote) {
      quotes.set(column, check.evidence.quote);
    }
  }
  const layers = ["deterministic", "similarity", "ai"].map((layer) => ({ layer, checks: detail.checks.filter((check) => check.layer === layer) }));

  const reveal = async () => {
    const response = await fetch(`/api/studies/${studyId}/respondents/${encodeURIComponent(detail.ref)}/reveal`, { method: "POST" });
    if (response.ok) {
      setRevealed(((await response.json()) as { identity: string | null }).identity);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-mono text-md font-semibold">{detail.ref}</span>
        <DecisionChip decision={detail.decision as Decision | null} />
        <span className="text-sm text-muted">
          Row {detail.rowNumber} · {detail.submittedAt ? <LocalTime date={detail.submittedAt} withSeconds /> : "no submission time"} · {formatDuration(detail.durationSeconds)}
        </span>
      </div>

      <section>
        <h4 className="mb-1 font-semibold">Payout identity</h4>
        {detail.identity ? (
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{revealed ?? detail.identity.masked}</span>
            <span className="text-xs text-muted">{detail.identity.type}</span>
            {!revealed && (
              <button type="button" onClick={() => void reveal()} className="touch-target inline-flex items-center gap-1 text-sm text-primary hover:underline">
                <MdVisibility size={18} aria-hidden /> Reveal (logged)
              </button>
            )}
          </p>
        ) : (
          <p className="text-muted">None given.</p>
        )}
      </section>

      {layers.map(({ layer, checks }) =>
        checks.length === 0 ? null : (
          <section key={layer}>
            <h4 className="mb-1 font-semibold">{LAYER_LABEL[layer]}</h4>
            <ul className="space-y-1.5">
              {checks.map((check) => (
                <li key={check.ruleId} className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted">{check.ruleId}</span>
                    <EvidenceChip outcome={check.outcome}>{check.evidence.summary}</EvidenceChip>
                    <span className="text-xs text-muted">{check.outcome}</span>
                  </div>
                  {typeof check.evidence.values?.explanation === "string" && <p className="text-sm text-muted">{check.evidence.values.explanation}</p>}
                  {check.evidence.linkedRefs && check.evidence.linkedRefs.length > 0 && layer !== "similarity" && (
                    <p className="font-mono text-xs text-muted">Linked: {check.evidence.linkedRefs.slice(0, 12).join(", ")}{check.evidence.linkedRefs.length > 12 ? ` and ${check.evidence.linkedRefs.length - 12} more` : ""}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ),
      )}

      {Object.entries(detail.linkedAnswers).map(([column, others]) => (
        <section key={column}>
          <h4 className="mb-1 font-semibold">Near-identical answers · {column}</h4>
          <div className="grid gap-2 md:grid-cols-2">
            <blockquote className="rounded-sm border border-hold bg-surface p-2 text-sm">
              <div className="mb-1 font-mono text-xs text-muted">{detail.ref} (this respondent)</div>
              {detail.fields.find((field) => field.column === column)?.value}
            </blockquote>
            {others.map((other) => (
              <blockquote key={other.ref} className="rounded-sm border border-rule bg-surface p-2 text-sm">
                <div className="mb-1 font-mono text-xs text-muted">{other.ref}</div>
                {other.text}
              </blockquote>
            ))}
          </div>
        </section>
      ))}

      <section>
        <h4 className="mb-1 font-semibold">Original answers</h4>
        <dl className="divide-y divide-rule rounded-sm border border-rule">
          {detail.fields.map((field) => (
            <div key={field.column} className="grid gap-1 px-2 py-1.5 sm:grid-cols-[180px_minmax(0,1fr)]">
              <dt className="text-xs">
                <span className="font-mono">{field.column}</span>
                {field.role !== "other" && <span className="block text-muted">{field.roleLabel}</span>}
              </dt>
              <dd className="whitespace-pre-wrap break-words text-sm">
                {field.questionText && field.role === "open_text" && <span className="mb-0.5 block text-xs text-muted">{field.questionText}</span>}
                {field.value.length === 0 ? <span className="text-muted">empty</span> : <Highlighted text={field.value} quote={quotes.get(field.column)} />}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {detail.payouts.length > 0 && (
        <section>
          <h4 className="mb-1 font-semibold">Payouts</h4>
          <ul className="space-y-0.5 text-sm">
            {detail.payouts.map((payout) => (
              <li key={payout.senderItemId} className="font-mono text-xs">
                {payout.senderItemId} · {formatCents(payout.amountCents)} · {payout.status}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h4 className="mb-1 font-semibold">Decision history</h4>
        <ol className="space-y-1.5">
          {detail.decisions.map((entry, index) => (
            <li key={`${entry.decidedAt}-${index}`} className={`rounded-sm border px-2 py-1 text-sm ${entry.isOverride ? "border-hold" : "border-rule"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <DecisionChip decision={entry.decision as Decision} />
                <span className="text-xs text-muted">
                  {entry.source} · {entry.decidedBy}
                  {entry.secondReviewer ? ` and ${entry.secondReviewer}` : ""} · <LocalTime date={entry.decidedAt} />
                </span>
                {entry.isOverride && <span className="text-xs font-semibold text-hold">Override of a rules decision</span>}
              </div>
              {entry.justification && <p className="mt-0.5">{entry.justification}</p>}
              {entry.reasons.length > 0 && !entry.justification && <p className="mt-0.5 text-muted">{entry.reasons.map((reason) => reason.summary).join(" · ")}</p>}
            </li>
          ))}
          {detail.votes.map((vote) => (
            <li key={`${vote.reviewer}-${vote.at}`} className="rounded-sm border border-dashed border-rule px-2 py-1 text-sm">
              Vote: <DecisionChip decision={vote.decision as Decision} /> by {vote.reviewer} · {vote.reason}
            </li>
          ))}
          {detail.decisions.length === 0 && detail.votes.length === 0 && <li className="text-muted">No decision yet.</li>}
        </ol>
      </section>
    </div>
  );
}
