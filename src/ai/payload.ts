/**
 * Builds what the AI service sees for open-text assessment. Only pseudonymous refs, the question,
 * the answer (with identifiers redacted) and the mapped closed answers are allowed through.
 */

export interface AssessmentItem {
  respondentRef: string;
  answer: string;
  /** Mapped context columns: question/column label → the respondent's closed answer. */
  closedAnswers: Record<string, string>;
}

export interface AssessmentPayload {
  task: "classify_survey_answers";
  question: string;
  items: { respondent_ref: string; answer: string; closed_answers: Record<string, string> }[];
}

const EMAIL = /[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/gi;
const PHONE = /\+?\(?\d(?:[\s().-]{0,2}\d){6,14}/g;
const REF = /^R-\d{4,6}$/;

export function redactIdentifiers(text: string): string {
  return text.replace(EMAIL, "[email removed]").replace(IPV6, "[address removed]").replace(IPV4, "[address removed]").replace(PHONE, "[number removed]");
}

export class PayloadSafetyError extends Error {}

export function buildAssessmentPayload(question: string, items: readonly AssessmentItem[]): AssessmentPayload {
  for (const item of items) {
    if (!REF.test(item.respondentRef)) {
      throw new PayloadSafetyError(`"${item.respondentRef}" is not a pseudonymous respondent ref.`);
    }
  }
  return {
    task: "classify_survey_answers",
    question,
    items: items.map((item) => ({
      respondent_ref: item.respondentRef,
      answer: redactIdentifiers(item.answer).slice(0, 4_000),
      closed_answers: Object.fromEntries(Object.entries(item.closedAnswers).map(([label, value]) => [label, redactIdentifiers(value).slice(0, 200)])),
    })),
  };
}

/** Last line of defence: refuses to send a payload that contains any of the given identifying values. */
export function assertNoIdentifiers(payload: AssessmentPayload, identifiers: readonly string[]): void {
  const serialized = JSON.stringify(payload).toLowerCase();
  for (const value of identifiers) {
    const needle = value.trim().toLowerCase();
    if (needle.length >= 5 && serialized.includes(needle)) {
      throw new PayloadSafetyError("The AI payload contained an identifying value and was not sent.");
    }
  }
}
