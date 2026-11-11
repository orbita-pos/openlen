"use client";

// THE CARD LEN LEAVES (spec local 2026-11-06-asistente-propio, §4.4): Len's `create_assistant` in a turn shows it under
// his answer, on reload too (it comes from the turn's own tool cards). «Crear a mi asistente» opens the creator; once
// the project has its assistant, the card says so with the way to its place. When the person already has one elsewhere
// (phase 4, step 2), it offers «Usar a Lucía aquí» — which connects her to this project — and «Crear otro».
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import type { AssistantListItem, AssistantView } from "@/lib/assistants/view";
import { DEFAULT_LOOK } from "@/lib/figure/look";

import type { AgentAction } from "../agent-action-card";
import { AssistantCreatorDialog } from "./creator-dialog";
import { AssistantFigure } from "./figure";

export const CREATE_ASSISTANT_TOOL = "create_assistant";

export function AssistantCreateCard({ actions, projectId }: { actions: readonly AgentAction[] | undefined; projectId: string }) {
  const offered = (actions ?? []).some((a) => a.tool === CREATE_ASSISTANT_TOOL && a.status === "done");
  if (!offered) return null;
  return <Card projectId={projectId} />;
}

const serves = (a: AssistantListItem, projectId: string) => a.projectId === projectId || (a.projectIds ?? []).includes(projectId);

function Card({ projectId }: { projectId: string }) {
  const t = useTranslations("panelsChat");
  const locale = useLocale();
  const [mine, setMine] = useState<AssistantView | null | undefined>(undefined);
  const [others, setOthers] = useState<readonly AssistantListItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [using, setUsing] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/assistants")
      .then((r) => (r.ok ? (r.json() as Promise<{ assistants: AssistantListItem[] }>) : { assistants: [] }))
      .then((b) => {
        if (!live) return;
        setMine(b.assistants.find((a) => serves(a, projectId)) ?? null);
        setOthers(b.assistants.filter((a) => !serves(a, projectId)));
      })
      .catch(() => live && setMine(null));
    return () => {
      live = false;
    };
  }, [projectId]);

  const connectHere = async (a: AssistantListItem) => {
    setUsing(a.id);
    setFailed(null);
    const res = await fetch(`/api/assistants/${encodeURIComponent(a.id)}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId }),
    }).catch(() => null);
    setUsing(null);
    if (res?.ok) return setMine(a);
    setFailed(res?.status === 409 ? t("ownAssistant.errors.projectHas") : res?.status === 403 ? t("ownAssistant.errors.ownerOnly") : t("ownAssistant.card.useFailed"));
  };

  if (mine === undefined) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border bd bg-elev p-3" data-assistant-card="">
      {mine ? (
        <>
          <AssistantFigure look={mine.look} size={40} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium fg">{t("ownAssistant.card.ready", { name: mine.name })}</p>
          </div>
          <a data-assistant-talk="" href={`/${locale}/assistant/${mine.slug}`} className="rounded-full bg-[var(--nc-accent-text)] px-3 py-1.5 text-[12px] font-medium text-white">
            {t("ownAssistant.card.talk", { name: mine.name })}
          </a>
        </>
      ) : (
        <>
          {others.length === 0 && <p className="min-w-0 flex-1 text-[13px] fg">{t("ownAssistant.card.offer")}</p>}
          {others.map((a) => (
            <button
              key={a.id}
              type="button"
              data-assistant-use={a.id}
              disabled={using !== null}
              onClick={() => void connectHere(a)}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--nc-accent-text)] py-1 pl-1 pr-3 text-[12px] font-medium text-white disabled:opacity-50"
            >
              <AssistantFigure look={a.look} size={22} />
              {t("ownAssistant.card.useHere", { name: a.name })}
            </button>
          ))}
          <button
            type="button"
            data-assistant-create=""
            onClick={() => setCreating(true)}
            className={
              others.length
                ? "rounded-full border bd px-3 py-1.5 text-[12px] font-medium fg-muted hover:fg"
                : "rounded-full bg-[var(--nc-accent-text)] px-3 py-1.5 text-[12px] font-medium text-white"
            }
          >
            {others.length ? t("ownAssistant.card.createAnother") : t("ownAssistant.card.create")}
          </button>
          {failed && (
            <p role="alert" className="w-full text-[12px] nc-bad">
              {failed}
            </p>
          )}
          <AssistantCreatorDialog
            open={creating}
            projectId={projectId}
            onClose={() => setCreating(false)}
            onCreated={(c) => {
              setCreating(false);
              void fetch(`/api/assistants/${c.id}`)
                .then((r) => (r.ok ? (r.json() as Promise<AssistantView>) : null))
                .then((a) => setMine(a ?? { id: c.id, slug: c.slug, name: c.name, look: DEFAULT_LOOK, color: DEFAULT_LOOK.color, tone: "friendly", projectId }))
                .catch(() => setMine({ id: c.id, slug: c.slug, name: c.name, look: DEFAULT_LOOK, color: DEFAULT_LOOK.color, tone: "friendly", projectId }));
            }}
          />
        </>
      )}
    </div>
  );
}
