"use client";

// AN INSTALLED `rail` TOOL IN THE CENTER (spec local 2026-11-04-herramientas-hechas-por-len, §4.3): DeepSeek's global
// page — the tool fills the center with the app's frame kept around it. It has no conversation (§4.4: `sendPrompt`
// is only inside a project), so it answers `unavailable` there. When it can't open, it says why.
import { useTranslations } from "next-intl";

import type { InstalledToolView } from "@/lib/tools/types";

import { ToolFrame } from "./tool-frame";

export function ToolView({ tool, person, locale }: { tool: InstalledToolView | null; person: { name: string }; locale: string }) {
  const t = useTranslations("wsChrome");
  if (!tool || tool.status !== "ok" || !tool.frameUrl || !tool.frameOrigin) {
    const why = tool?.status === "plan_required" ? t("tools.planRequired") : t("tools.unavailable");
    return (
      <div className="flex-1 min-w-0 flex items-center justify-center bg-app" data-tool-view="unavailable">
        <p className="text-[13px] fg-muted">{why}</p>
      </div>
    );
  }
  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-app" data-tool-view={tool.id}>
      <ToolFrame
        key={tool.frameUrl}
        src={tool.frameUrl}
        frameOrigin={tool.frameOrigin}
        caller={{ installationId: tool.id }}
        context={{ person: { name: person.name, locale }, project: null, tool: { id: tool.id, version: tool.releaseSha }, environment: "installed" }}
        onPrompt={null}
        title={tool.title}
      />
    </div>
  );
}
