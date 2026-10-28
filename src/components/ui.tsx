import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { IconType } from "react-icons";
import { MdBlock, MdCancel, MdCheckCircle, MdErrorOutline, MdInfoOutline, MdPauseCircle, MdWarningAmber } from "react-icons/md";
import { LogoMark } from "@/components/brand";
import { LocalTimeText } from "@/components/local-time";
import type { Decision } from "@/engine/types";

export const ICON = { size: 18, "aria-hidden": true } as const;

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover border-2 border-transparent",
  secondary: "bg-surface text-ink border-2 border-ink hover:bg-subtle",
  danger: "bg-surface text-dont-pay border-2 border-dont-pay hover:bg-dont-pay-soft",
  ghost: "text-primary hover:bg-primary-soft border border-transparent",
};

/** Soft, fully rounded buttons with a gentle lift on hover. */
export function buttonClass(variant: Variant = "secondary", extra = ""): string {
  return `touch-target inline-flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${extra}`;
}

export function Button({ variant = "secondary", className = "", ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

export function LinkButton({ variant = "secondary", className = "", ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

const NOTICE_STYLE = {
  info: { box: "border-primary/20 bg-primary-soft", icon: <MdInfoOutline {...ICON} className="mt-0.5 shrink-0 text-primary" /> },
  warning: { box: "border-hold/30 bg-hold-soft", icon: <MdWarningAmber {...ICON} className="mt-0.5 shrink-0 text-hold" /> },
  error: { box: "border-dont-pay/30 bg-dont-pay-soft", icon: <MdErrorOutline {...ICON} className="mt-0.5 shrink-0 text-dont-pay" /> },
};

export function Notice({ tone = "info", title, children, role }: { tone?: keyof typeof NOTICE_STYLE; title?: string; children?: ReactNode; role?: "alert" | "status" }) {
  const style = NOTICE_STYLE[tone];
  return (
    <div role={role ?? (tone === "error" ? "alert" : undefined)} className={`flex gap-2.5 rounded-md border px-4 py-3 ${style.box}`}>
      {style.icon}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-muted">{children}</div>}
      </div>
    </div>
  );
}

export function PageTitle({ children, description }: { children: ReactNode; description?: ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="text-xl font-extrabold tracking-tight">{children}</h2>
      {description && <p className="mt-1 max-w-3xl text-md text-muted">{description}</p>}
    </div>
  );
}

/** `level` 2 for pages without a PageTitle, so headings never skip a level. */
export function Section({ title, children, aside, level = 3 }: { title: string; children: ReactNode; aside?: ReactNode; level?: 2 | 3 }) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className="rounded-lg border border-rule bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-6 py-4">
        <Heading className="text-md font-bold">{title}</Heading>
        {aside}
      </div>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

export const DECISION_META: Record<Decision, { label: string; color: string; soft: string; Icon: IconType }> = {
  pay: { label: "Pay", color: "text-pay", soft: "bg-pay-soft", Icon: MdCheckCircle },
  hold: { label: "Hold for review", color: "text-hold", soft: "bg-hold-soft", Icon: MdPauseCircle },
  dont_pay: { label: "Don't pay", color: "text-dont-pay", soft: "bg-dont-pay-soft", Icon: MdCancel },
};

/** A plain white card with an optional heading row, the base for every panel. */
export function Card({
  title,
  description,
  aside,
  children,
  className = "",
  level = 3,
}: {
  title?: string;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className={`min-w-0 rounded-lg border border-rule bg-surface p-6 ${className}`}>
      {(title || aside) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <Heading className="text-md font-bold">{title}</Heading>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/** Decorative EMV chip for the payment card. */
function CardChip() {
  return (
    <svg width="44" height="34" viewBox="0 0 44 34" aria-hidden>
      <defs>
        <linearGradient id="chip-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6dd9a" />
          <stop offset="0.5" stopColor="#d8b45a" />
          <stop offset="1" stopColor="#b48a2c" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="43" height="33" rx="6" fill="url(#chip-gold)" stroke="#8a6a1f" strokeOpacity="0.5" />
      <path d="M0.5 12H14M0.5 22H14M30 12H43.5M30 22H43.5M14 0.5V33.5M30 0.5V33.5M14 17H30" stroke="#8a6a1f" strokeOpacity="0.55" fill="none" />
    </svg>
  );
}

/**
 * A credit-card style summary: one large amount, two labelled facts underneath and the Honorarium wordmark.
 * Every number on it is real data passed in; the chip and guilloché lines are decoration only.
 */
export function PaymentCard({ label, amount, facts, tag = "Sandbox" }: { label: string; amount: ReactNode; facts: { label: string; value: ReactNode }[]; tag?: string }) {
  return (
    <section className="relative aspect-[1.586] w-full max-w-[420px] overflow-hidden rounded-[22px] bg-[linear-gradient(135deg,#001c64_0%,#0a3a9e_55%,#2f7bff_100%)] p-6 text-white shadow-[0_18px_40px_-12px_rgb(0_28_100/0.55)]">
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.16]" viewBox="0 0 420 265" preserveAspectRatio="none">
        {Array.from({ length: 9 }, (_, index) => (
          <path key={index} d={`M-20 ${190 + index * 9} C 90 ${120 + index * 9}, 230 ${250 + index * 9}, 440 ${150 + index * 9}`} fill="none" stroke="white" strokeWidth="1" />
        ))}
      </svg>
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-white/10 blur-2xl" />
      <div className="relative flex h-full flex-col">
        <div className="flex items-start justify-between">
          <span className="inline-flex items-center gap-2 text-md font-extrabold tracking-tight">
            <LogoMark size={24} /> Honorarium
          </span>
          <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider">{tag}</span>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <CardChip />
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden className="opacity-80">
            <path d="M8 6a9 9 0 0 1 0 12M12 4a12 12 0 0 1 0 16M16 2a15 15 0 0 1 0 20" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>
        <div className="mt-auto">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/70">{label}</p>
          <p className="font-mono text-[30px] font-semibold leading-tight tracking-tight tabular">{amount}</p>
          <dl className="mt-2 flex gap-6">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt className="text-[10px] font-bold uppercase tracking-wider text-white/60">{fact.label}</dt>
                <dd className="font-mono text-sm font-semibold tabular">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

export function DecisionChip({ decision }: { decision: Decision | null }) {
  if (!decision) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-subtle px-2.5 py-0.5 text-xs font-semibold text-muted">
        <MdBlock size={14} aria-hidden />
        Not decided
      </span>
    );
  }
  const meta = DECISION_META[decision];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${meta.color} ${meta.soft}`}>
      <meta.Icon size={14} aria-hidden />
      {meta.label}
    </span>
  );
}

const OUTCOME_STYLE: Record<string, string> = {
  pass: "bg-subtle text-muted",
  note: "bg-subtle text-ink",
  review: "bg-hold-soft text-hold",
  exclude: "bg-dont-pay-soft text-dont-pay",
};

export function EvidenceChip({ outcome, children }: { outcome: string; children: ReactNode }) {
  return <span className={`inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${OUTCOME_STYLE[outcome] ?? "bg-subtle"}`}>{children}</span>;
}

export function RuleStamp({ version, sha256, lockedAt }: { version: number; sha256: string | null; lockedAt: Date | null }) {
  if (!sha256 || !lockedAt) {
    return <span className="rounded-full bg-hold-soft px-3 py-1 font-mono text-xs text-hold">Rules v{version} · not locked</span>;
  }
  return (
    <span className="rounded-full bg-subtle px-3 py-1 font-mono text-xs text-muted" title={`SHA-256 ${sha256}`}>
      Rules v{version} · {sha256.slice(0, 12)} · locked <LocalTime date={lockedAt} />
    </span>
  );
}

/** A time in the viewer's zone (UTC until the browser takes over), with the zone named. */
export function LocalTime({ date, withSeconds = false }: { date: Date | string; withSeconds?: boolean }) {
  return <LocalTimeText iso={typeof date === "string" ? date : date.toISOString()} withSeconds={withSeconds} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[6px] border border-b-2 border-rule bg-surface px-1.5 font-mono text-xs">{children}</kbd>;
}

export const inputClass =
  "w-full rounded-sm border-2 border-rule bg-surface px-3 py-2 text-base text-ink transition-colors placeholder:text-muted hover:border-muted/50 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 disabled:opacity-60";

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block font-bold">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && (
        <p className="text-xs text-dont-pay" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const tableClass = "w-full border-collapse text-sm";
export const thClass = "border-b border-rule bg-subtle px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-muted";
export const tdClass = "border-b border-rule px-3 py-2.5 align-top";

