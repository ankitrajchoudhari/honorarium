"use client";

import { DotLottieReact, setWasmUrl } from "@lottiefiles/dotlottie-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { MdAutoAwesome, MdCancel, MdCheckCircle } from "react-icons/md";

// The player's WebAssembly engine is served by this app (see scripts/copy-lottie-wasm.mjs), never from a CDN.
setWasmUrl("/animations/dotlottie-player.wasm");

export type AiAnimationKind = "thinking" | "success" | "failed";

const SOURCES: Record<AiAnimationKind, string> = {
  thinking: "/animations/ai-assistant.lottie",
  success: "/animations/success.lottie",
  failed: "/animations/failed.lottie",
};

const STILL = {
  thinking: { Icon: MdAutoAwesome, color: "text-primary" },
  success: { Icon: MdCheckCircle, color: "text-pay" },
  failed: { Icon: MdCancel, color: "text-dont-pay" },
};

function subscribe(callback: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

/**
 * The AI assistant animation while Gemini is working, and a success or failed animation once it is done.
 * Decorative: the surrounding text always says what happened. Reduced-motion users see a still icon.
 */
export function AiAnimation({ kind, size = 48, once = false }: { kind: AiAnimationKind; size?: number; once?: boolean }) {
  const reduced = useSyncExternalStore(subscribe, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => true);
  if (reduced) {
    const still = STILL[kind];
    return <still.Icon size={size * 0.6} aria-hidden className={`shrink-0 ${still.color}`} />;
  }
  return (
    <span aria-hidden className="inline-block shrink-0" style={{ width: size, height: size }}>
      <DotLottieReact key={kind} src={SOURCES[kind]} autoplay loop={kind === "thinking" && !once} style={{ width: size, height: size }} />
    </span>
  );
}

const PANEL_TONE: Record<AiAnimationKind, string> = {
  thinking: "border-primary/25 bg-primary-soft",
  success: "border-pay/25 bg-pay-soft",
  failed: "border-dont-pay/25 bg-dont-pay-soft",
};

/** A status panel with an animation: Gemini working, or the success or failure of an AI or payout step. */
export function StatusPanel({ kind, title, children }: { kind: AiAnimationKind; title: string; children?: ReactNode }) {
  return (
    <div role={kind === "failed" ? "alert" : "status"} className={`flex items-center gap-3 rounded-md border px-4 py-3 ${PANEL_TONE[kind]}`}>
      <AiAnimation kind={kind} size={kind === "thinking" ? 56 : 44} />
      <div className="min-w-0">
        <p className="font-bold">{title}</p>
        {children && <div className="text-sm text-muted">{children}</div>}
      </div>
    </div>
  );
}
