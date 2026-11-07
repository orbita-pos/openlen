"use client";

// THE CARD LEN LEAVES (spec local 2026-11-06-asistente-propio, §4.4): Len's `create_assistant` in a turn shows it under
// his answer, on reload too (it comes from the turn's own tool cards). «Crear a mi asistente» opens the creator; once
// the project has its assistant, the card says so with the way to its place.
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import type { AssistantView } from "@/lib/assistants/view";

import type { AgentAction } from "../agent-action-card";
import { AssistantCreatorDialog } from "./creator-dialog";
import { AssistantFigure } from "./figure";

export const CREATE_ASSISTANT_TOOL = "create_assistant";

export function AssistantCreateCard({ actions, projectId }: { actions: readonly AgentAction[] | undefined; projectId: string }) {
  const offered = (actions ?? []).some((a) => a.tool === CREATE_ASSISTANT_TOOL && a.status === "done");
  if (!offered) return null;
  return <Card projectId={projectId} />;
}

function Card({ projectId }: { projectId: string }) {
  const t = useTranslations("panelsChat");
  const locale = useLocale();
  const [mine, setMine] = useState<AssistantView | null | undefined>(undefined);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/assistants")
      .then((r) => (r.ok ? (r.json() as Promise<{ assistants: AssistantView[] }>) : { assistants: [] }))
      .then((b) => live && setMine(b.assistants.find((a) => a.projectId === projectId) ?? null))
      .catch(() => live && setMine(null));
    return () => {
      live = false;
    };
  }, [projectId]);

  if (mine === undefined) return null;
  return (
    <div className="mt-2 flex items-center gap-3 rounded-xl border bd bg-elev p-3" data-assistant-card="">
      {mine ? (
        <>
          <AssistantFigure shape={mine.shape} color={mine.color} size={40} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium fg">{t("ownAssistant.card.ready", { name: mine.name })}</p>
          </div>
          <a data-assistant-talk="" href={`/${locale}/assistant/${mine.slug}`} className="rounded-full bg-[var(--nc-accent-text)] px-3 py-1.5 text-[12px] font-medium text-white">
            {t("ownAssistant.card.talk", { name: mine.name })}
          </a>
        </>
      ) : (
        <>
          <p className="min-w-0 flex-1 text-[13px] fg">{t("ownAssistant.card.offer")}</p>
          <button
            type="button"
            data-assistant-create=""
            onClick={() => setCreating(true)}
            className="rounded-full bg-[var(--nc-accent-text)] px-3 py-1.5 text-[12px] font-medium text-white"
          >
            {t("ownAssistant.card.create")}
          </button>
          <AssistantCreatorDialog
            open={creating}
            projectId={projectId}
            onClose={() => setCreating(false)}
            onCreated={(c) => {
              setCreating(false);
              void fetch(`/api/assistants/${c.id}`)
                .then((r) => (r.ok ? (r.json() as Promise<AssistantView>) : null))
                .then((a) => setMine(a ?? { id: c.id, slug: c.slug, name: c.name, shape: "blob", color: "#F4A48B", tone: "friendly", projectId }))
                .catch(() => setMine({ id: c.id, slug: c.slug, name: c.name, shape: "blob", color: "#F4A48B", tone: "friendly", projectId }));
            }}
          />
        </>
      )}
    </div>
  );
}
