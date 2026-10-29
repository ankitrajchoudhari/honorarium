"use client";

import { DotLottieReact, setWasmUrl, type DotLottie } from "@lottiefiles/dotlottie-react";
import { useRef, type ReactNode } from "react";
import { useHydrated } from "@/lib/use-hydrated";

// The player's WebAssembly engine is served by this app (see scripts/copy-lottie-wasm.mjs), never from a CDN.
setWasmUrl("/animations/dotlottie-player.wasm");

export type AiAnimationKind = "thinking" | "success" | "failed";

const SOURCES: Record<AiAnimationKind, string> = {
  thinking: "/animations/ai-assistant.lottie",
  success: "/animations/success.lottie",
  failed: "/animations/failed.lottie",
};

/**
 * The AI assistant animation while Gemini is working, and a success or failed animation once it is done.
 * Decorative: the surrounding text always says what happened. With "reduce motion" on, it plays once instead of
 * looping; hovering replays it (motion the viewer asks for).
 */
export function AiAnimation({ kind, size = 48, once = false }: { kind: AiAnimationKind; size?: number; once?: boolean }) {
  // The player draws to a canvas in the browser only; server and hydration render an empty box of the same size.
  const hydrated = useHydrated();
  const reduced = hydrated && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const player = useRef<DotLottie | null>(null);
  const replay = () => {
    player.current?.stop();
    player.current?.play();
  };
  if (!hydrated) {
    return <span aria-hidden className="inline-block shrink-0" style={{ width: size, height: size }} />;
  }
  return (
    <span aria-hidden className="inline-block shrink-0" style={{ width: size, height: size }} onMouseEnter={replay}>
      <DotLottieReact
        key={kind}
        src={SOURCES[kind]}
        autoplay
        loop={kind === "thinking" && !once && !reduced}
        dotLottieRefCallback={(instance) => {
          player.current = instance;
        }}
        style={{ width: size, height: size }}
      />
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
