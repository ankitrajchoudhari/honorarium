"use client";

import { useEffect, useRef } from "react";
import { MdDarkMode, MdLightMode } from "react-icons/md";
import { THEME_COOKIE } from "@/lib/theme";

type Theme = "light" | "dark";

/** The theme on screen: an explicit choice (data-theme, set by the server from the cookie), else the system setting. */
function currentTheme(): Theme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "dark" || chosen === "light") {
    return chosen;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * A sliding switch. The choice is kept in a cookie so the server renders the right theme in the first paint, with no
 * script to run beforehand; its look comes from CSS, so React never re-renders it after hydration.
 */
export function ThemeToggle() {
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    button.current?.setAttribute("aria-checked", String(currentTheme() === "dark"));
  }, []);

  const toggle = () => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    button.current?.setAttribute("aria-checked", String(next === "dark"));
  };

  return (
    <button ref={button} type="button" role="switch" aria-checked={false} aria-label="Dark theme" onClick={toggle} className="touch-target group inline-flex items-center rounded-full p-1">
      <span className="relative inline-flex h-7 w-13 items-center rounded-full bg-rule transition-colors duration-150 dark:bg-primary">
        <span className="absolute grid h-5.5 w-5.5 translate-x-1 place-items-center rounded-full bg-white text-navy shadow-card transition-transform duration-150 ease-out dark:translate-x-6.5">
          <MdLightMode size={14} aria-hidden className="dark:hidden" />
          <MdDarkMode size={14} aria-hidden className="hidden dark:block" />
        </span>
      </span>
    </button>
  );
}
