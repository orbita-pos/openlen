"use client";

// Workspace-only wrapper: fetches account analytics client-side (GET
// /api/analytics) and renders the SAME AnalyticsView in the editor center.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ALL_BUSINESSES } from "@/components/workspace-v2/business-switcher";
import { AnalyticsView } from "./analytics-view";

interface PageStat {
  id: string;
  title: string;
  subdomain: string | null;
  views: number;
  clicks: number;
  leads: number;
}
interface Totals {
  views: number;
  clicks: number;
  leads: number;
}

export function AnalyticsSection({
  activeBusinessId,
}: {
  activeBusinessId?: string;
}) {
  const [state, setState] = useState<{ totals: Totals; perPage: PageStat[] } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    setState(null);
    const qs =
      activeBusinessId && activeBusinessId !== ALL_BUSINESSES
        ? `?business=${encodeURIComponent(activeBusinessId)}`
        : "";
    void fetch(`/api/analytics${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { totals?: Totals; perPage?: PageStat[] } | null) => {
        if (cancelled || !d?.totals) return;
        setState({ totals: d.totals, perPage: d.perPage ?? [] });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeBusinessId]);

  return (
    <div className="flex-1 min-w-0 overflow-y-auto flex flex-col bg-app">
      {state ? (
        <AnalyticsView totals={state.totals} perPage={state.perPage} />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        </div>
      )}
    </div>
  );
}
