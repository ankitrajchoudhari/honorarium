"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { finishWithoutAiAction, resumeJobAction, startVerificationAction } from "@/app/actions/verify";
import { MdAutoAwesome } from "react-icons/md";
import { StatusPanel } from "@/components/ai-animation";
import { Button, Notice } from "@/components/ui";
import type { JobState } from "@/jobs/verify";

const PHASES: { key: JobState["phase"]; label: string }[] = [
  { key: "rules", label: "Rules" },
  { key: "similarity", label: "Similarity" },
  { key: "ai", label: "AI review" },
  { key: "decide", label: "Decisions" },
];

function phaseIndex(phase: JobState["phase"]): number {
  return phase === "done" ? PHASES.length : PHASES.findIndex((entry) => entry.key === phase);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Drives a resumable verification job from the browser, one chunk per request. Safe to leave and come back. */
export function JobRunner({ studyId, initial, autoStart }: { studyId: string; initial: JobState | null; autoStart: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<JobState | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const loop = useCallback(
    async (jobId: string) => {
      if (running.current) {
        return;
      }
      running.current = true;
      try {
        for (;;) {
          const response = await fetch(`/api/jobs/${jobId}/step`, { method: "POST" });
          if (!response.ok) {
            setError(`The verification step failed (HTTP ${response.status}). Reload the page to resume.`);
            return;
          }
          const next = (await response.json()) as JobState;
          setState(next);
          if (next.status !== "running") {
            router.refresh();
            return;
          }
          await wait(Math.max(next.waitMs, 150));
        }
      } catch {
        setError("Lost connection while verifying. Reload the page to resume from where it stopped.");
      } finally {
        running.current = false;
      }
    },
    [router],
  );

  const start = useCallback(async () => {
    setError(null);
    const result = await startVerificationAction(studyId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setState(result.state);
    void loop(result.state.jobId);
  }, [studyId, loop]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (initial?.status === "running") {
        void loop(initial.jobId);
      } else if (!initial && autoStart) {
        void start();
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initial, autoStart, loop, start]);

  if (!state) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => void start()}>
          Run verification
        </Button>
        {error && <span className="text-dont-pay">{error}</span>}
      </div>
    );
  }

  const current = phaseIndex(state.phase);
  const aiRange = state.aiTotal > 0 ? `${Math.min(state.aiDone + 1, state.aiTotal)}–${Math.min(state.aiDone + 20, state.aiTotal)} of ${state.aiTotal}` : "";

  return (
    <section aria-labelledby="progress-heading" className="space-y-3 rounded-lg border border-rule bg-surface p-5">
      <h2 id="progress-heading" className="sr-only">
        Verification progress
      </h2>
      <ol className="grid gap-2 sm:grid-cols-4">
        {PHASES.map((phase, index) => {
          const done = index < current || state.status === "done";
          const active = index === current && state.status === "running";
          let detail = "Waiting";
          if (phase.key === "rules") {
            detail = `${state.rulesDone} of ${state.respondents} responses`;
          } else if (phase.key === "ai") {
            detail = state.aiTotal === 0 && done ? "No answers needed review" : `${state.aiDone} of ${state.aiTotal} answers${state.aiNotRun ? ` · ${state.aiNotRun} not run` : ""}`;
          } else if (done) {
            detail = "Done";
          }
          return (
            <li key={phase.key} className={`rounded-md border px-3 py-2.5 ${active ? "border-primary bg-primary-soft" : "border-rule"}`}>
              <div className="flex items-center justify-between text-sm font-semibold">
                <span className="inline-flex items-center gap-1.5">
                  {phase.key === "ai" && <MdAutoAwesome size={16} aria-hidden className="text-primary" />}
                  {phase.label}
                </span>
                <span className={`text-xs ${done ? "text-pay" : active ? "text-primary" : "text-muted"}`}>{done ? "Done" : active ? "Running" : "Waiting"}</span>
              </div>
              <div className="font-mono text-xs text-muted tabular">{detail}</div>
            </li>
          );
        })}
      </ol>
      <div aria-live="polite">
        {state.status === "running" && state.phase === "ai" && (
          <StatusPanel kind="thinking" title={`Gemini is reviewing answers ${aiRange}`}>
            It flags answers that are off topic, contradict the respondent&apos;s own choices, are gibberish or read like a generic template. Flags only send a response to a
            person; they never deny payment. About 4 seconds per group of 20.
          </StatusPanel>
        )}
        {state.status === "running" && state.phase !== "ai" && <p className="text-sm text-muted">Working. You can leave this page; verification resumes where it stopped.</p>}
        {state.status === "done" && (
          <StatusPanel kind="success" title="Verification finished">
            {state.aiTotal > 0 ? `Gemini reviewed ${state.aiDone - state.aiNotRun} of ${state.aiTotal} open-text answers.` : "No open-text answers needed AI review."} Counts and decisions
            below are from this run.
          </StatusPanel>
        )}
      </div>
      {state.status === "paused" && state.paused && (
        <div className="space-y-2">
          <StatusPanel kind="failed" title={state.paused.kind === "cap_reached" ? "AI review is paused for today" : "AI review is paused"}>
            {state.paused.message} Rule checks and similarity already ran. Answers not yet reviewed are held, not paid.
          </StatusPanel>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              onClick={async () => {
                const next = await resumeJobAction(state.jobId);
                if (next) {
                  setState(next);
                  void loop(next.jobId);
                }
              }}
            >
              Try again
            </Button>
            <Button
              onClick={async () => {
                const next = await finishWithoutAiAction(studyId, state.jobId);
                if (next) {
                  setState(next);
                  void loop(next.jobId);
                }
              }}
            >
              Finish without AI review
            </Button>
          </div>
        </div>
      )}
      {state.status === "failed" && (
        <StatusPanel kind="failed" title="Verification stopped after repeated errors">
          {state.lastError ?? "Unknown error."} Run it again to retry.
        </StatusPanel>
      )}
      {(state.status === "done" || state.status === "failed") && (
        <Button onClick={() => void start()} variant="ghost">
          Run verification again
        </Button>
      )}
      {error && <Notice tone="error" title="Verification could not continue">{error}</Notice>}
    </section>
  );
}
