import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand";
import { MainNav } from "@/components/main-nav";
import { ThemeToggle } from "@/components/theme-toggle";

/** A white top bar with the brand, main navigation, the sandbox notice and the theme switch. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-30 border-b border-rule bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1280px] items-stretch justify-between gap-4 px-4">
          <div className="flex min-w-0 items-stretch gap-6">
            <Link href="/" aria-label="Honorarium home" className="flex items-center">
              <Logo />
            </Link>
            <div className="hidden sm:flex">
              <MainNav />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-xs font-semibold text-muted md:inline-flex">
              <span aria-hidden className="h-2 w-2 rounded-full bg-hold" />
              Sandbox · test money only
            </span>
            <ThemeToggle />
          </div>
        </div>
        <div className="flex h-11 border-t border-rule px-2 sm:hidden">
          <MainNav />
        </div>
      </header>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
