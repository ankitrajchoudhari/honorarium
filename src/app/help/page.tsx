import type { Metadata } from "next";
import Link from "next/link";
import { MdArrowForward, MdExpandMore } from "react-icons/md";
import { CopyButton } from "@/components/copy-button";
import { Shell } from "@/components/shell";

export const metadata: Metadata = { title: "Help" };

const STEPS = [
  { title: "Create the study", text: "Title, PI, budget and the amount per participant. Honorarium reserves money for every response that may be paid, so the budget can never be overspent.", href: "/studies/new", link: "New study" },
  { title: "Write and lock the rules", text: "Write exclusion rules the way you would in your protocol. Gemini turns them into exact checks; you read each one back, adjust thresholds and lock them before importing any data." },
  { title: "Import responses", text: "Upload the CSV export from Qualtrics, Google Forms or REDCap and tell Honorarium what each column is. Nothing is checked until the rules are locked." },
  { title: "Verify and review", text: "Every response becomes Pay, Hold for review or Don't pay, with the evidence. You decide every hold yourself, with a reason." },
  { title: "Approve the payout", text: "Check the pre-flight list, type the study code and send one PayPal batch. Statuses come back from PayPal by verified webhook." },
  { title: "Export the ethics report", text: "Rules, hash, exclusions by rule, overrides and the money trail, ready to print or save as PDF for your IRB." },
];

const FAQ = [
  {
    q: "Can the AI stop someone from being paid?",
    a: "No. Only the deterministic rules you locked can produce Don't pay. Gemini can only flag an answer, which sends the respondent to a person. If Gemini is unavailable or the daily cap is reached, unreviewed answers are held, never paid automatically.",
  },
  {
    q: "What does the AI see?",
    a: "The question wording, the open-text answer with emails, phone numbers and IP addresses removed, up to four closed answers you mapped, and a pseudonymous ref such as R-0147. It never sees payout emails, names or IP addresses. A last check refuses to send anything that still contains an identifier.",
  },
  {
    q: "Several students share one campus IP address. Will they be excluded?",
    a: "No. A shared IP address can at most send responses to review, because campus Wi-Fi and mobile networks put many real people behind one address.",
  },
  {
    q: "Two people used the same payout email. What happens?",
    a: "Without a rule, both go to review and are linked to each other, because siblings and shared family accounts happen. With a locked “one payment per email” rule, the earliest submission is kept and later ones are excluded. Gmail dot and +tag variants count as the same inbox.",
  },
  {
    q: "A payout shows UNCLAIMED. Is the money lost?",
    a: "No. The recipient has no PayPal account yet and PayPal emailed them a link. If nobody claims it within 30 days, PayPal returns it. You can also cancel it from the Payouts page; the money goes back to the budget once PayPal confirms.",
  },
  {
    q: "A payout failed because of a typo in the email.",
    a: "Open the respondent, correct the payout email with a reason (it is kept in the audit log), decide Pay again, and prepare a new payout. Only corrected, failed items are sent again; successful ones never are.",
  },
  {
    q: "I need to change the rules after seeing the data.",
    a: "Create a new rules version with a written reason. The old version stays locked with its hash, and the change and its reason appear in the ethics report, so reviewers can see exactly what changed and when.",
  },
  {
    q: "Is any of this real money?",
    a: "Not in this deployment. Honorarium refuses to start unless PayPal is in sandbox mode, so every payment is PayPal test money.",
  },
];

const CONSENT = "Payment of $[amount] will be made through PayPal after your responses have been checked. If responses cannot be verified, compensation may not be issued. Responses are checked against criteria decided before data collection, and every decision not to pay is reviewed by a member of the research team.";

const PROTOCOL = "Responses will be screened with Honorarium against exclusion criteria fixed and time-stamped (SHA-256) before data collection. An AI model (Gemini) flags open-text answers for human review only; it cannot exclude participants. Shared IP addresses alone are never grounds for exclusion. Every exclusion, override and payment is recorded in an append-only audit log and summarised in an ethics report.";

function Template({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-rule bg-surface p-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-bold">{title}</h3>
        <CopyButton text={text} />
      </div>
      <p className="rounded-md bg-subtle p-3 text-sm">{text}</p>
    </div>
  );
}

export default function HelpPage() {
  return (
    <Shell>
      <main id="main" className="mx-auto max-w-[1080px] space-y-10 px-4 py-8">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Help for researchers</h1>
          <p className="mt-1 max-w-2xl text-md text-muted">How to run a paid online study with open recruitment, keep bots out, and give your ethics board a clear record.</p>
        </div>

        <section aria-labelledby="start-heading">
          <h2 id="start-heading" className="mb-4 text-lg font-bold">
            From setup to payment
          </h2>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="rounded-lg border border-rule bg-surface p-5">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-navy font-mono text-sm font-bold text-on-navy">{index + 1}</span>
                <p className="mt-3 font-bold">{step.title}</p>
                <p className="mt-1 text-sm text-muted">{step.text}</p>
                {step.href && (
                  <Link href={step.href} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
                    {step.link} <MdArrowForward size={16} aria-hidden />
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="templates-heading" className="space-y-4">
          <div>
            <h2 id="templates-heading" className="text-lg font-bold">
              Wording you can copy
            </h2>
            <p className="text-sm text-muted">State the verification step up front: it is what makes withholding payment from fraudulent responses defensible.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Template title="Consent form" text={CONSENT} />
            <Template title="Protocol / IRB application" text={PROTOCOL} />
          </div>
        </section>

        <section aria-labelledby="faq-heading">
          <h2 id="faq-heading" className="mb-4 text-lg font-bold">
            Questions researchers ask
          </h2>
          <div className="divide-y divide-rule rounded-lg border border-rule bg-surface">
            {FAQ.map((item) => (
              <details key={item.q} className="group px-6 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold">
                  {item.q}
                  <MdExpandMore size={22} aria-hidden className="shrink-0 text-muted transition-transform duration-150 group-open:rotate-180" />
                </summary>
                <p className="mt-2 text-muted">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
    </Shell>
  );
}
