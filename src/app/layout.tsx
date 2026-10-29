import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Plus_Jakarta_Sans, Source_Serif_4 } from "next/font/google";
import { cookies } from "next/headers";
import { THEME_COOKIE } from "@/lib/theme";
import { readEnv } from "@/lib/env";
import "./globals.css";

const sans = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin", "latin-ext"], weight: ["400", "500", "600", "700", "800"] });
const serif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"], weight: ["600"] });
const mono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "Honorarium", template: "%s · Honorarium" },
  description: "Verify study responses, then pay real participants through PayPal.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0a2540" },
    { media: "(prefers-color-scheme: dark)", color: "#060d1a" },
  ],
};

function SetupRequired({ problems }: { problems: { variable: string; message: string }[] }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-xl font-extrabold tracking-tight">Honorarium is not configured yet</h1>
      <p className="mt-2 text-muted">Add these environment variables (see .env.example), then restart the server. Values are never shown here.</p>
      <ul className="mt-4 divide-y divide-rule rounded-md border border-dont-pay bg-surface">
        {problems.map((problem) => (
          <li key={problem.variable} className="px-3 py-2">
            <span className="font-mono">{problem.variable}</span> <span className="text-muted">{problem.message}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}

/**
 * The theme comes from a cookie and is rendered on <html>, so the first paint is already right and no script runs
 * before hydration. (An inline script in a hand-written <head> knocked React's hydration cursor into <head> on
 * slowly streamed pages.) Without a saved choice, CSS follows the system setting.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const envResult = readEnv();
  const saved = (await cookies()).get(THEME_COOKIE)?.value;
  const theme = saved === "dark" || saved === "light" ? saved : undefined;
  return (
    <html lang="en" data-theme={theme} className={`${sans.variable} ${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2">
          Skip to content
        </a>
        {envResult.ok ? children : <SetupRequired problems={envResult.problems} />}
      </body>
    </html>
  );
}
