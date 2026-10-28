"use client";

import { useEffect, useRef } from "react";
import { MdDarkMode, MdLightMode } from "react-icons/md";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/**
 * A sliding switch. Its look comes from CSS on the `data-theme` attribute (set before first paint by
 * THEME_BOOT_SCRIPT), so React never re-renders it after hydration; only aria-checked is kept in sync here.
 */
export function ThemeToggle() {
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    button.current?.setAttribute("aria-checked", String(currentTheme() === "dark"));
  }, []);

  const toggle = () => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem("hon-theme", next);
    } catch {
      // Storage can be unavailable (private mode); the theme still applies for this page view.
    }
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

/** Runs in <head> before first paint: the saved choice, otherwise the system setting, becomes `data-theme`. */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("hon-theme");if(t!=="dark"&&t!=="light"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){}`;
