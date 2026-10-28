"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState, useSyncExternalStore } from "react";
import { MdAutoAwesome, MdBlock, MdCheck } from "react-icons/md";
import { AiAnimation } from "@/components/ai-animation";
import { Button } from "@/components/ui";

const SEEN_KEY = "hon-ai-intro-seen";

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

const noSubscribe = () => () => {};

const DOES = [
  "Turns your plain-English exclusion rules into exact checks you review and lock.",
  "Reads open-text answers and flags ones that are off topic, contradict the respondent's own choices, are gibberish or read like a generic template.",
  "Quotes the words behind every flag and explains it in one sentence.",
];

const NEVER = [
  "Deny payment. Only your locked rules can say Don't pay; an AI flag only sends a response to a person.",
  "See names, emails, phone numbers or IP addresses. It gets pseudonymous refs and answer text only.",
  "Call anything “AI-written”. Detectors are unreliable, so it describes what it sees instead.",
];

/** Shown once per browser on the first visit to a study's results, and on demand from the button. */
export function AiIntro() {
  const seen = useSyncExternalStore(noSubscribe, readSeen, () => true);
  const [dismissed, setDismissed] = useState(false);
  const [requested, setRequested] = useState(false);
  const open = requested || (!seen && !dismissed);

  const close = () => {
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Without storage the intro may show again next visit; nothing else depends on it.
    }
    setDismissed(true);
    setRequested(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? setRequested(true) : close())}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" className="px-3">
          <MdAutoAwesome size={18} aria-hidden /> How AI is used
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-navy/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(94vw,560px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-rule bg-surface p-6 shadow-pop focus:outline-none">
          <div className="flex items-center gap-4">
            <AiAnimation kind="thinking" size={88} />
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-primary">Your AI assistant · Gemini</p>
              <Dialog.Title className="text-xl font-extrabold tracking-tight">It flags. People decide.</Dialog.Title>
            </div>
          </div>
          <Dialog.Description className="mt-3 text-muted">Here is exactly what the AI does in Honorarium, and what it is not allowed to do.</Dialog.Description>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <section>
              <h3 className="mb-2 text-sm font-bold text-pay">What it does</h3>
              <ul className="space-y-2 text-sm">
                {DOES.map((item) => (
                  <li key={item} className="flex gap-2">
                    <MdCheck size={18} aria-hidden className="mt-0.5 shrink-0 text-pay" />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="mb-2 text-sm font-bold text-dont-pay">What it never does</h3>
              <ul className="space-y-2 text-sm">
                {NEVER.map((item) => (
                  <li key={item} className="flex gap-2">
                    <MdBlock size={18} aria-hidden className="mt-0.5 shrink-0 text-dont-pay" />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <div className="mt-6 flex justify-end">
            <Button variant="primary" onClick={close}>
              Got it
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
