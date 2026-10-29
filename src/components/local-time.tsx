"use client";

import { useHydrated } from "@/lib/use-hydrated";

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

/**
 * A time shown in the viewer's own zone with the zone named. The server (which cannot know the zone) renders UTC;
 * local time replaces it once the page has hydrated.
 */
export function LocalTimeText({ iso, withSeconds = false }: { iso: string; withSeconds?: boolean }) {
  const date = new Date(iso);
  const text = format(date, withSeconds, useHydrated());
  return <time dateTime={iso}>{text}</time>;
}
