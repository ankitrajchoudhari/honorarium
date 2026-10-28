"use client";

import { MdLock } from "react-icons/md";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { compileRulesAction, lockRulesAction, newRuleVersionAction, saveRulesAction, type RulesActionResult } from "@/app/actions/rules";
import { Button, inputClass, LocalTime, Notice, tableClass, tdClass, thClass } from "@/components/ui";
import { ruleSetSchema, type FieldRef, type Rule, type RuleSet } from "@/engine/dsl";
import { readBack } from "@/engine/readback";
import { describeRef } from "@/engine/rules";

interface Props {
  studyId: string;
  version: number;
  sourceText: string;
  ruleSet: RuleSet | null;
  couldNotCompile: { phrase: string; reason: string }[];
  compiledBy: string | null;
  locked: { at: string; by: string; sha256: string } | null;
  hasData: boolean;
}

const NUMERIC: Partial<Record<Rule["type"], { key: string; label: string }[]>> = {
  min_duration: [{ key: "seconds", label: "Minimum seconds" }],
  attention_check: [{ key: "max_failures", label: "Allowed failures" }],
  eligibility: [
    { key: "min", label: "Min" },
    { key: "max", label: "Max" },
  ],
  age_dob_consistency: [{ key: "tolerance_years", label: "Tolerance (years)" }],
  duplicate_ip: [{ key: "threshold", label: "Responses per IP" }],
  submission_burst: [
    { key: "window_seconds", label: "Window (seconds)" },
    { key: "max_in_window", label: "Max in window" },
  ],
  open_text_min_length: [{ key: "min_chars", label: "Min characters" }],
};

const TYPE_LABEL: Record<Rule["type"], string> = {
  min_duration: "Minimum duration",
  attention_check: "Attention check",
  honeypot: "Hidden field",
  eligibility: "Eligibility",
  age_dob_consistency: "Age vs date of birth",
  one_payment_per_identity: "One payment per identity",
  duplicate_ip: "Shared IP",
  submission_burst: "Submission burst",
  required_fields: "Required fields",
  open_text_min_length: "Open-text length",
  ip_country_mismatch: "IP country mismatch",
};

const REVIEW_AT_MOST = new Set<Rule["type"]>(["duplicate_ip", "ip_country_mismatch"]);

function fieldsOf(rule: Rule): FieldRef[] {
  switch (rule.type) {
    case "attention_check":
      return rule.params.checks.map((check) => check.field);
    case "honeypot":
    case "eligibility":
    case "open_text_min_length":
      return [rule.params.field];
    case "age_dob_consistency":
      return [rule.params.age_field, rule.params.dob_field];
    case "required_fields":
      return rule.params.fields;
    case "ip_country_mismatch":
      return [rule.params.ip_country_field, rule.params.country_field];
    default:
      return [];
  }
}

function setParam(rule: Rule, key: string, value: number | undefined): Rule {
  const params = { ...(rule.params as Record<string, unknown>) };
  if (value === undefined) {
    delete params[key];
  } else {
    params[key] = value;
  }
  return { ...rule, params } as Rule;
}

export function RulesEditor({ studyId, version, sourceText, ruleSet, couldNotCompile, compiledBy, locked, hasData }: Props) {
  const router = useRouter();
  const [text, setText] = useState(sourceText);
  const [rules, setRules] = useState<Rule[]>(ruleSet?.rules ?? []);
  const [dirty, setDirty] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [changeNote, setChangeNote] = useState("");
  const [result, setResult] = useState<RulesActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const validation = ruleSetSchema.safeParse({ rules });
  const run = (label: string, action: () => Promise<RulesActionResult>) => {
    setBusy(label);
    startTransition(async () => {
      const outcome = await action();
      setResult(outcome);
      setBusy(null);
      if (outcome.ok) {
        setDirty(false);
        router.refresh();
      }
    });
  };

  const update = (index: number, next: Rule) => {
    setRules((current) => current.map((rule, position) => (position === index ? next : rule)));
    setDirty(true);
  };

  const readOnly = locked !== null;

  return (
    <div className="space-y-4">
      {result && (
        <div aria-live="polite">
          {result.ok ? <Notice title={result.message ?? "Done."} role="status" /> : <Notice tone="error" title="Not saved">{result.error}</Notice>}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="space-y-2 rounded-lg border border-rule bg-surface p-5">
          <label htmlFor="rules-text" className="block font-semibold">
            Rules in plain English
          </label>
          <textarea
            id="rules-text"
            rows={12}
            className={inputClass}
            value={text}
            readOnly={readOnly}
            onChange={(event) => {
              setText(event.target.value);
              setDirty(true);
            }}
            placeholder="Don't pay responses finished in under 4 minutes. Send for review if more than 25 responses arrive within one minute."
          />
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={pending || text.trim().length < 10} onClick={() => run("compile", () => compileRulesAction(studyId, text))}>
                {busy === "compile" ? "Compiling with Gemini…" : "Compile rules"}
              </Button>
              <span className="text-xs text-muted">Sends only this text to Gemini. No response data exists yet.</span>
            </div>
          )}
          {compiledBy && <p className="text-xs text-muted">Compiled by {compiledBy.replace("gemini:", "Gemini ")}</p>}
        </section>

        <section className="min-w-0 space-y-3 rounded-lg border border-rule bg-surface p-5">
          <h3 className="font-semibold">Compiled rules</h3>
          {rules.length === 0 ? (
            <p className="text-muted">No rules yet. Write them on the left and compile.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th scope="col" className={thClass}>Rule</th>
                    <th scope="col" className={thClass}>Parameters</th>
                    <th scope="col" className={thClass}>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule, index) => (
                    <tr key={rule.id}>
                      <td className={`${tdClass} min-w-[220px]`}>
                        <div className="font-semibold">
                          <span className="font-mono text-xs text-muted">{rule.id}</span> {TYPE_LABEL[rule.type]}
                        </div>
                        <p className="mt-1 text-muted">{readBack(rule)}</p>
                      </td>
                      <td className={`${tdClass} min-w-[180px] space-y-1`}>
                        {fieldsOf(rule).length > 0 && <div className="text-xs text-muted">Uses {fieldsOf(rule).map(describeRef).join(", ")}</div>}
                        {(NUMERIC[rule.type] ?? []).map((param) => {
                          const value = (rule.params as Record<string, unknown>)[param.key];
                          return (
                            <label key={param.key} className="flex items-center gap-2 text-xs">
                              <span className="w-28 text-muted">{param.label}</span>
                              <input
                                type="number"
                                inputMode="numeric"
                                className={`${inputClass} w-24 font-mono`}
                                value={typeof value === "number" ? value : ""}
                                readOnly={readOnly}
                                onChange={(event) => update(index, setParam(rule, param.key, event.target.value === "" ? undefined : Number(event.target.value)))}
                              />
                            </label>
                          );
                        })}
                        {rule.type === "attention_check" &&
                          rule.params.checks.map((check, checkIndex) => (
                            <label key={checkIndex} className="flex items-center gap-2 text-xs">
                              <span className="w-28 text-muted">Expected</span>
                              <input
                                className={`${inputClass} w-40`}
                                value={check.expected}
                                readOnly={readOnly}
                                onChange={(event) =>
                                  update(index, {
                                    ...rule,
                                    params: { ...rule.params, checks: rule.params.checks.map((entry, position) => (position === checkIndex ? { ...entry, expected: event.target.value } : entry)) },
                                  })
                                }
                              />
                            </label>
                          ))}
                      </td>
                      <td className={tdClass}>
                        <select
                          aria-label={`Outcome for ${rule.id}`}
                          className={`${inputClass} w-32`}
                          value={rule.outcome_on_fail}
                          disabled={readOnly}
                          onChange={(event) => update(index, { ...rule, outcome_on_fail: event.target.value } as Rule)}
                        >
                          {!REVIEW_AT_MOST.has(rule.type) && <option value="exclude">Don&apos;t pay</option>}
                          <option value="review">Hold for review</option>
                          <option value="note">Note only</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!validation.success && rules.length > 0 && (
            <Notice tone="error" title="These rules need fixing before they can be saved">
              {validation.error.issues.map((issue) => issue.message).join(" ")}
            </Notice>
          )}
          {couldNotCompile.length > 0 && (
            <div>
              <h4 className="font-semibold">Could not turn into a rule</h4>
              <p className="text-xs text-muted">Rewrite these phrases and compile again. Nothing was invented for them.</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {couldNotCompile.map((item) => (
                  <li key={item.phrase}>
                    <q>{item.phrase}</q> <span className="text-muted">{item.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!readOnly && dirty && rules.length > 0 && (
            <Button disabled={pending || !validation.success} onClick={() => run("save", () => saveRulesAction(studyId, text, { rules }))}>
              {busy === "save" ? "Saving…" : "Save changes"}
            </Button>
          )}
        </section>
      </div>

      {readOnly ? (
        <section className="space-y-3 rounded-lg border border-rule bg-surface p-5">
          <p className="flex items-center gap-2 font-semibold">
            <MdLock size={18} aria-hidden /> Rules v{version} are locked
          </p>
          <p className="font-mono text-xs text-muted">
            SHA-256 {locked.sha256} · locked <LocalTime date={new Date(locked.at)} /> by {locked.by}
          </p>
          {hasData && (
            <div className="space-y-2 border-t border-rule pt-3">
              <label htmlFor="change-note" className="block font-semibold">
                Create a new version
              </label>
              <p className="text-xs text-muted">Changing rules after seeing data is recorded with your reason and shown in the ethics report.</p>
              <textarea id="change-note" rows={2} className={inputClass} value={changeNote} onChange={(event) => setChangeNote(event.target.value)} placeholder="Why the rules need to change" />
              <Button disabled={pending} onClick={() => run("version", () => newRuleVersionAction(studyId, changeNote))}>
                {busy === "version" ? "Creating…" : "Create new version"}
              </Button>
            </div>
          )}
        </section>
      ) : (
        <section className="space-y-3 rounded-lg border border-rule bg-surface p-5">
          <h3 className="font-semibold">Lock these rules</h3>
          <p className="text-muted">Locking stores a SHA-256 hash of the exact rules. After that they cannot be edited, only replaced by a new, recorded version.</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--primary)]" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>These rules were decided before looking at the responses.</span>
          </label>
          <Button variant="primary" disabled={pending || !confirmed || dirty || rules.length === 0 || !validation.success} onClick={() => run("lock", () => lockRulesAction(studyId, confirmed))}>
            {busy === "lock" ? "Locking…" : `Lock rules v${version}`}
          </Button>
          {dirty && <p className="text-xs text-muted">Save or compile your changes before locking.</p>}
        </section>
      )}
    </div>
  );
}
