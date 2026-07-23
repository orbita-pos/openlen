// Resultados — one rail entry, three tabs: Página (per-project Insights),
// Sitio (account-wide AnalyticsSection, passed in as a slot — it lives under
// app/[locale]/ and can't be imported from components/), Leads (cross-project
// forms inbox). Replaces the standalone Insights sidebar panel + the Task-2
// temporary AnalyticsSection-only mount.

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { InsightsPanel } from "./panels/insights-panel";
import { InboxForms } from "@/components/inbox/inbox-forms";
import { useInboxBadge } from "@/components/inbox/use-inbox-badge";

type Tab = "page" | "site" | "leads";

export function ResultadosView({
  currentProjectId,
  onApplyTip,
  siteSlot,
}: {
  currentProjectId: string | null;
  onApplyTip?: (instruction: string) => void;
  /** AnalyticsSection lives under app/[locale]/ — the page passes it in as a
   *  slot so this component stays importable from components/. */
  siteSlot: React.ReactNode;
}) {
  const t = useTranslations("wsChrome");
  const [tab, setTab] = useState<Tab>("site");

  const { markLeadsSeen } = useInboxBadge();
  // Opening the Leads tab IS the "seen" action — same semantics as InboxHub's
  // Formularios tab (spec: timestamp — everything up to now counts as seen).
  useEffect(() => {
    if (tab === "leads") void markLeadsSeen();
  }, [tab, markLeadsSeen]);

  return (
    <section className="flex-1 min-w-0 min-h-0 flex flex-col bg-app">
      <div className="shrink-0 flex items-center gap-1 px-4 pt-3">
        {(["page", "site", "leads"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? "page" : undefined}
            className={`h-8 px-3.5 rounded-full text-[12.5px] font-medium transition ${
              tab === id ? "bg-elev fg shadow-card border bd" : "fg-muted hover:fg hover:bg-hover"
            }`}
          >
            {t(`resultadosTabs.${id}`)}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto nice-scroll">
        {tab === "page" ? (
          <div className="max-w-[560px] mx-auto px-4 py-4">
            <InsightsPanel currentProjectId={currentProjectId} onApplyTip={onApplyTip} />
          </div>
        ) : tab === "leads" ? (
          <InboxForms />
        ) : (
          siteSlot
        )}
      </div>
    </section>
  );
}
