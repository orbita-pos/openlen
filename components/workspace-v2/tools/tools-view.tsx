"use client";

// THE HERRAMIENTAS PAGE (spec local 2026-11-04-herramientas-hechas-por-len, §4.11): DeepSeek's Plugins page. Each
// installed tool with its icon, name and line in the person's language, where it goes, a switch, its version and
// date, its project (to change it with Len), and «Quitar» or «Restaurar»; one that can't open says why. On top,
// «Pedir a Len una herramienta» — DeepSeek's «Let the agent create a plugin»: a blank project born as a tool,
// with nothing sent. And «Sugerencias de herramientas» (phase 2, §4.10): the person's own switch for the «Crear» card,
// off until they turn it on, shown only where the card can exist at all.
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { InstalledToolView } from "@/lib/tools/types";

import { KIND_PARAM } from "../chat/nace-como";
import { ToolIcon } from "./tool-icon";

export const NEW_TOOL_HREF = `/new?${KIND_PARAM}=tool`;

export function ToolsView({
  tools,
  paid,
  onChanged,
  suggestions,
}: {
  tools: readonly InstalledToolView[];
  paid: boolean;
  onChanged: () => void;
  /** GET /api/tools's `suggestions`: whether the switch exists here, and the person's state. */
  suggestions?: { available: boolean; on: boolean };
}) {
  const t = useTranslations("wsChrome");
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);

  async function act(id: string, url: string, init: RequestInit) {
    setBusy(id);
    setProblem(null);
    try {
      const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setProblem({ id, text: body.error === "release_gone" ? t("tools.page.releaseGone") : t("tools.page.failed") });
      }
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  return (
    <section className="flex-1 min-w-0 min-h-0 overflow-y-auto nice-scroll bg-app" data-tools-view>
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[22px] font-semibold fg tracking-tight">{t("tools.page.title")}</h2>
            <p className="mt-1 text-[13px] fg-muted">{t("tools.page.subtitle")}</p>
          </div>
          <button
            type="button"
            disabled={!paid}
            title={paid ? undefined : t("tools.planRequired")}
            onClick={() => router.push(NEW_TOOL_HREF)}
            className="shrink-0 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
          >
            {t("tools.page.ask")}
          </button>
        </div>

        {suggestions?.available ? (
          <div className="mt-6 flex items-center gap-4 rounded-lg border bd bg-elev px-4 py-3" data-tool-suggestions="">
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold fg">{t("tools.page.suggestions")}</p>
              <p className="text-[12px] fg-muted">{t("tools.page.suggestionsHint")}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={suggestions.on}
              aria-label={t("tools.page.suggestions")}
              disabled={!paid || busy === "suggestions"}
              title={paid ? undefined : t("tools.planRequired")}
              onClick={() => act("suggestions", "/api/tools/settings", { method: "PATCH", body: JSON.stringify({ suggestions: !suggestions.on }) })}
              className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50 ${suggestions.on ? "bg-[var(--accent)]" : "bg-hover"}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${suggestions.on ? "left-[18px]" : "left-0.5"}`} />
            </button>
          </div>
        ) : null}

        {tools.length === 0 ? (
          <p className="mt-10 text-center text-[13px] fg-faint">{t("tools.page.empty")}</p>
        ) : (
          <ul className="mt-6 flex flex-col gap-2">
            {tools.map((tool) => {
              const removed = tool.status === "removed";
              const why =
                tool.status === "plan_required" ? t("tools.planRequired") : tool.status === "broken" ? t("tools.unavailable") : null;
              return (
                <li key={tool.id} data-tool-row={tool.id} className="flex items-center gap-3 rounded-lg border bd bg-elev px-3 py-2.5">
                  <ToolIcon url={tool.iconUrl} tinted={tool.iconTinted} size={28} className="h-7 w-7 shrink-0 rounded-md fg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] font-semibold fg">{tool.title}</span>
                      <span className="shrink-0 rounded px-1.5 text-[10.5px] fg-faint border bd">
                        {tool.placement === "rail" ? t("tools.page.inRail") : t("tools.page.inProject")}
                      </span>
                    </div>
                    <p className="truncate text-[12px] fg-muted">{tool.description}</p>
                    <p className="text-[11px] fg-faint">
                      {t("tools.page.version", { version: tool.releaseSha.slice(0, 7), date: tool.installedAt.slice(0, 10) })}
                    </p>
                    {why ? <p className="text-[11.5px] text-[var(--nc-warn)]">{why}</p> : null}
                    {problem?.id === tool.id ? <p className="text-[11.5px] text-[var(--nc-warn)]">{problem.text}</p> : null}
                  </div>
                  {!removed ? (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={tool.enabled}
                      aria-label={t("tools.page.switch", { tool: tool.title })}
                      disabled={busy === tool.id}
                      onClick={() => act(tool.id, `/api/tools/${tool.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !tool.enabled }) })}
                      className={`relative h-5 w-9 shrink-0 rounded-full transition ${tool.enabled ? "bg-[var(--accent)]" : "bg-hover"}`}
                    >
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${tool.enabled ? "left-[18px]" : "left-0.5"}`} />
                    </button>
                  ) : null}
                  <button type="button" onClick={() => router.push(`/new?project=${encodeURIComponent(tool.projectId)}`)} className="shrink-0 rounded-md px-2 py-1 text-[12px] fg-muted hover:bg-hover">
                    {t("tools.page.openProject")}
                  </button>
                  {removed ? (
                    <button type="button" disabled={busy === tool.id} onClick={() => act(tool.id, `/api/tools/${tool.id}/restore`, { method: "POST" })} className="shrink-0 rounded-md px-2 py-1 text-[12px] fg hover:bg-hover">
                      {t("tools.page.restore")}
                    </button>
                  ) : (
                    <button type="button" disabled={busy === tool.id} onClick={() => act(tool.id, `/api/tools/${tool.id}`, { method: "DELETE" })} className="shrink-0 rounded-md px-2 py-1 text-[12px] fg-muted hover:bg-hover">
                      {t("tools.page.remove")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
