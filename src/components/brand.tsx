import type { SVGProps } from "react";

/** Honorarium's mark: a coin carrying a check, for "verified, then paid". Original artwork. */
export function LogoMark({ size = 32, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden {...props}>
      <defs>
        <linearGradient id="hon-coin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2f86ff" />
          <stop offset="1" stopColor="#001c64" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#hon-coin)" />
      <circle cx="16" cy="16" r="11.5" fill="none" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="1.5" />
      <path d="M10.5 16.5l3.6 3.6 7.4-8" fill="none" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark size={28} />
      <span className="text-lg font-extrabold tracking-tight text-ink">Honorarium</span>
    </span>
  );
}
