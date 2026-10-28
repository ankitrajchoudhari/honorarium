"use client";

import { MdPrint } from "react-icons/md";
import { Button } from "@/components/ui";

export function PrintButton() {
  return (
    <Button onClick={() => window.print()}>
      <MdPrint size={18} aria-hidden /> Print or save as PDF
    </Button>
  );
}
