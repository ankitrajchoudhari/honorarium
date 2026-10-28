"use client";

import { useId, type ReactNode } from "react";

export interface Ring {
  label: string;
  value: number;
  /** The whole the ring is measured against (e.g. all responses, or the budget). */
  max: number;
  /** A CSS colour or variable, e.g. "var(--pay)". */
  color: string;
  /** Display text for the value, e.g. "48" or "$480.00". */
  display: string;
}

function share(ring: Ring): number {
  return ring.max > 0 ? Math.min(1, Math.max(0, ring.value / ring.max)) : 0;
}

/**
 * Concentric progress rings drawn as shaded tubes: a recessed track, a gradient arc with a soft shadow and a
 * gloss line along its top edge. Each ring shows one value as a share of its whole; the legend repeats the numbers.
 */
export function Rings({ rings, size = 220, thickness = 18, center, label }: { rings: Ring[]; size?: number; thickness?: number; center?: ReactNode; label: string }) {
  const id = useId().replace(/:/g, "");
  const gap = Math.max(4, thickness * 0.28);
  const summary = `${label}: ${rings.map((ring) => `${ring.label} ${ring.display} (${Math.round(share(ring) * 100)}%)`).join(", ")}`;
  return (
    <figure className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6" role="img" aria-label={summary}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="overflow-visible">
          <defs>
            <filter id={`${id}-lift`} x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2.5" stdDeviation="2.5" floodColor="#0e1a2b" floodOpacity="0.28" />
            </filter>
            {rings.map((ring, index) => (
              <linearGradient key={ring.label} id={`${id}-g${index}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" style={{ stopColor: `color-mix(in srgb, ${ring.color} 62%, white)` }} />
                <stop offset="0.55" style={{ stopColor: ring.color }} />
                <stop offset="1" style={{ stopColor: `color-mix(in srgb, ${ring.color} 78%, black)` }} />
              </linearGradient>
            ))}
          </defs>
          {rings.map((ring, index) => {
            const radius = size / 2 - thickness / 2 - index * (thickness + gap);
            if (radius <= thickness / 2) {
              return null;
            }
            const circumference = 2 * Math.PI * radius;
            const length = share(ring) * circumference;
            const transform = `rotate(-90 ${size / 2} ${size / 2})`;
            return (
              <g key={ring.label}>
                <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--subtle)" strokeWidth={thickness} />
                <circle cx={size / 2} cy={size / 2} r={radius - thickness / 2 + 1} fill="none" stroke="#0e1a2b" strokeOpacity="0.06" strokeWidth="2" />
                {length > 0 && (
                  <>
                    <circle
                      cx={size / 2}
                      cy={size / 2}
                      r={radius}
                      fill="none"
                      stroke={`url(#${id}-g${index})`}
                      strokeWidth={thickness}
                      strokeLinecap="round"
                      strokeDasharray={`${length} ${circumference}`}
                      transform={transform}
                      filter={`url(#${id}-lift)`}
                      className="ring-arc"
                    />
                    <circle
                      cx={size / 2}
                      cy={size / 2}
                      r={radius + thickness * 0.22}
                      fill="none"
                      stroke="white"
                      strokeOpacity="0.38"
                      strokeWidth={Math.max(1.5, thickness * 0.16)}
                      strokeLinecap="round"
                      strokeDasharray={`${Math.max(0, length - thickness)} ${circumference}`}
                      transform={`rotate(${-90 + (thickness / 2 / circumference) * 360} ${size / 2} ${size / 2})`}
                    />
                  </>
                )}
              </g>
            );
          })}
        </svg>
        {center && <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">{center}</div>}
      </div>
      <ul className="w-full min-w-0 space-y-2.5 text-sm" aria-hidden>
        {rings.map((ring) => (
          <li key={ring.label} className="flex items-center gap-2.5">
            <span className="h-3 w-3 shrink-0 rounded-full shadow-[inset_0_-2px_0_rgb(0_0_0/0.2)]" style={{ background: ring.color }} />
            <span className="min-w-0 flex-1 truncate text-muted">{ring.label}</span>
            <span className="font-mono font-semibold tabular">{ring.display}</span>
            <span className="w-10 text-right font-mono text-xs text-muted tabular">{Math.round(share(ring) * 100)}%</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** A single small ring for list rows. */
export function MiniRing({ value, max, color, size = 36 }: { value: number; max: number; color: string; size?: number }) {
  const id = useId().replace(/:/g, "");
  const thickness = size * 0.18;
  const radius = size / 2 - thickness / 2 - 1;
  const circumference = 2 * Math.PI * radius;
  const fraction = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={`${id}-m`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: `color-mix(in srgb, ${color} 60%, white)` }} />
          <stop offset="1" style={{ stopColor: color }} />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--subtle)" strokeWidth={thickness} />
      {fraction > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${id}-m)`}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${fraction * circumference} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
    </svg>
  );
}
