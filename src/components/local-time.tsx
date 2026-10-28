"use client";

import { useSyncExternalStore } from "react";

function format(date: Date, withSeconds: boolean, local: boolean): string {
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  if (withSeconds) {
    options.second = "2-digit";
  }
  if (local) {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZoneName: "short" }).format(date);
  }
  return `${new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(date)} UTC`;
}

const subscribe = () => () => {};

/**
 * A time shown in the viewer's own zone with the zone named. The server (which cannot know the zone) renders UTC;
 * React then swaps in local time after hydration without a mismatch, because the server snapshot is used first.
 */
export function LocalTimeText({ iso, withSeconds = false }: { iso: string; withSeconds?: boolean }) {
  const date = new Date(iso);
  const text = useSyncExternalStore(
    subscribe,
    () => format(date, withSeconds, true),
    () => format(date, withSeconds, false),
  );
  return <time dateTime={iso}>{text}</time>;
}
