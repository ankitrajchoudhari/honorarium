"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MdOutlineAccountBalanceWallet,
  MdOutlineDescription,
  MdOutlineFactCheck,
  MdOutlineFileUpload,
  MdOutlinePayments,
  MdOutlineRateReview,
  MdOutlineRuleFolder,
} from "react-icons/md";

const TABS = [
  { segment: "rules", label: "Rules", Icon: MdOutlineRuleFolder },
  { segment: "import", label: "Import", Icon: MdOutlineFileUpload },
  { segment: "verify", label: "Verification", Icon: MdOutlineFactCheck },
  { segment: "review", label: "Review", Icon: MdOutlineRateReview },
  { segment: "payouts", label: "Payouts", Icon: MdOutlinePayments },
  { segment: "ledger", label: "Ledger", Icon: MdOutlineAccountBalanceWallet },
  { segment: "report", label: "Ethics report", Icon: MdOutlineDescription },
];

export function StudyTabs({ studyId }: { studyId: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Study" className="no-print -mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1">
        {TABS.map((tab) => {
          const href = `/studies/${studyId}/${tab.segment}`;
          const active = pathname.startsWith(href);
          return (
            <li key={tab.segment}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`touch-target inline-flex items-center gap-1.5 border-b-[3px] px-3 pb-3 pt-2 text-sm font-semibold transition-colors duration-150 ${active ? "border-primary text-ink" : "border-transparent text-muted hover:text-ink"}`}
              >
                <tab.Icon size={18} aria-hidden />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
