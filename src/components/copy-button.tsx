"use client";

import { useState } from "react";
import { MdCheck, MdContentCopy } from "react-icons/md";

/** Copies a fixed text to the clipboard and says so. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      className="touch-target inline-flex items-center gap-1.5 rounded-full border border-rule px-3 py-1 text-xs font-semibold hover:bg-subtle"
    >
      {copied ? <MdCheck size={16} aria-hidden className="text-pay" /> : <MdContentCopy size={16} aria-hidden />}
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}
