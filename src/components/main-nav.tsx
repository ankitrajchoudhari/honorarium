"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Studies", match: (path: string) => path === "/" || (path.startsWith("/studies/") && path !== "/studies/new") },
  { href: "/studies/new", label: "New study", match: (path: string) => path === "/studies/new" },
  { href: "/help", label: "Help", match: (path: string) => path.startsWith("/help") },
  { href: "/workspace", label: "About", match: (path: string) => path.startsWith("/workspace") },
];

/** Top-level links with an underline on the current section. */
export function MainNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex h-full items-stretch gap-1 overflow-x-auto">
      {NAV.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`touch-target inline-flex shrink-0 items-center border-b-[3px] px-3 text-sm font-semibold transition-colors duration-150 ${active ? "border-primary text-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
