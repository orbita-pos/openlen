"use client";

// «INSTALAR» IN THE TOP BAR (spec local 2026-11-04-herramientas-hechas-por-len, §4.2): in a tool project installing
// takes publishing's place. The bar's coral button opens the same card Len's `publish` leaves in the chat — the same
// route, the same gates, nothing installed until the person taps «Instalar» in it.
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { InstallConfirmCard } from "./install-confirm-card";

export function ToolInstallButton({ projectId, title }: { projectId: string; title: string }) {
  const t = useTranslations("panelsChat");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative ml-0.5" ref={ref}>
      <button
        type="button"
        data-tool-install
        onClick={() => setOpen((o) => !o)}
        aria-label={t("installCard.install")}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-md bg-[var(--accent-strong)] text-white text-[12px] font-medium hover:brightness-105 active:brightness-95 shadow-coral transition"
      >
        <span className="hidden sm:inline">{t("installCard.install")}</span>
        <ChevronDown size={11} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="absolute right-0 mt-2 w-80 rounded-xl bg-elev border bd shadow-elev p-1.5 z-50 slide-down">
          <InstallConfirmCard projectId={projectId} install={{ title }} onInstalled={() => {}} onCancelled={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
