"use client";

// THE ASSISTANT'S PLACE (spec local 2026-11-06-asistente-propio, §4.6.2): /<locale>/assistant/<name>, a clean page —
// Len's chat panel as the assistant, without the workshop around it. It never writes the project: the canvas update is
// a no-op, and the turn's session is read-only on the server. Phase 2A adds «Conversaciones» (what the page's visitors
// said to her) and «En mi página»; phase 3, «Pedidos» (what visitors asked for and couldn't be done, joined into cards
// only the owner's press turns into Len's work). Each tab after the first mounts the first time it opens. Phase 4: the
// projects she serves, beside her home's «En mi página», where she is taken off one or deleted.
//
// Its frame (11/11, Jesús, on the reference he sent: «la tabla de arriba no me gusta»): no bar across the top. The
// three views are icons in a slim rail at the left, and what is set about her (name, figure, morning summary, her
// pages) waits in a menu behind one button, so her place is her and the conversation.
import { Inbox, MessageCircle, MoreHorizontal, Users, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import type { AssistantView } from "@/lib/assistants/view";
import type { StoredChatTurn } from "@/lib/projects/types";

import { NewChatPanel } from "../chat/new-chat-panel";
import { ToastProvider } from "../toast";
import { ChangeFigure } from "./change-figure";
import { HerProjects } from "./her-projects";
import { MorningSummarySwitch } from "./morning-summary-switch";
import { RenameHer } from "./rename-her";
import { VisitorConversations } from "./visitor-conversations";
import { VisitorRequests } from "./visitor-requests";

const noCanvas = () => {};

type Tab = "talk" | "conversations" | "requests";

const TAB_LABEL: Record<Tab, string> = {
  talk: "ownAssistant.place.talk",
  conversations: "ownAssistant.place.conversations",
  requests: "ownAssistant.requests.tab",
};
const TAB_ICON: Record<Tab, LucideIcon> = { talk: MessageCircle, conversations: Users, requests: Inbox };

export function AssistantHome({
  assistant,
  projectHtml,
  initialChat,
  onPage,
  needsPublish,
  nothingToKnow,
}: {
  assistant: AssistantView;
  projectHtml: string;
  initialChat: StoredChatTurn[];
  /** Whether her bubble is on the page (`assistantProjects.onPage`). */
  onPage: boolean;
  /** On, but not yet published with her (lib/assistants/visitor/on-page.ts). */
  needsPublish: boolean;
  /** Published with her, and nothing for her to know: no text, no public data. */
  nothingToKnow: boolean;
}) {
  const tc = useTranslations("common");
  const t = useTranslations("panelsChat");
  const [tab, setTab] = useState<Tab>("talk");
  // Her figure can be changed here (phase 6): her place wears the new one at once.
  const [look, setLook] = useState(assistant.look);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const her = { ...assistant, look, color: look.color };
  const [seen, setSeen] = useState<ReadonlySet<Tab>>(new Set(["talk"]));
  const tabs: readonly Tab[] = ["talk", "conversations", "requests"];
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    // A dialog one of its rows opened (the creator, a confirmation) is outside the menu: pressing in it is not leaving.
    const away = (e: PointerEvent) => {
      const at = e.target as Element | null;
      if (menu.current && at && !menu.current.contains(at) && !at.closest('[role="dialog"]')) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector('[role="dialog"]') && setMenuOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => (document.removeEventListener("pointerdown", away), document.removeEventListener("keydown", esc));
  }, [menuOpen]);
  return (
    <ToastProvider dismissLabel={tc("close")}>
      <div className="workspace-v2 flex h-dvh bg-side">
        <div role="tablist" aria-orientation="vertical" className="flex w-12 shrink-0 flex-col items-center gap-1 py-3" data-assistant-rail="">
          {tabs.map((k) => {
            const Icon = TAB_ICON[k];
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                title={t(TAB_LABEL[k])}
                onClick={() => (setTab(k), setSeen((s) => (s.has(k) ? s : new Set(s).add(k))))}
                className={`flex h-9 w-9 items-center justify-center rounded-xl ${tab === k ? "seg-active fg" : "fg-faint hover:fg"}`}
              >
                <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                <span className="sr-only">{t(TAB_LABEL[k])}</span>
              </button>
            );
          })}
        </div>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div ref={menu} className="absolute right-3 top-3 z-20 flex flex-col items-end gap-2">
          <button
            type="button"
            data-assistant-menu=""
            aria-expanded={menuOpen}
            aria-label={t("ownAssistant.place.settings")}
            title={t("ownAssistant.place.settings")}
            onClick={() => setMenuOpen((o) => !o)}
            className={`flex h-8 w-8 items-center justify-center rounded-full ${menuOpen ? "seg-active fg" : "fg-muted hover:fg"}`}
          >
            <MoreHorizontal size={17} aria-hidden="true" />
          </button>
          {/* Closed it is hidden, not unmounted: a rename half written or a switch in flight is not lost. */}
          <div className={menuOpen ? "flex w-[min(20rem,calc(100vw-5rem))] flex-col items-stretch gap-3 rounded-2xl border bd bg-elev p-3 shadow-xl" : "hidden"} data-assistant-controls="">
            <RenameHer assistantId={assistant.id} name={assistant.name} onPage={onPage} />
            <ChangeFigure assistant={her} onPage={onPage} onChanged={setLook} onOpenChange={setCreatorOpen} />
            <MorningSummarySwitch assistantId={assistant.id} initial={assistant.morningSummary === true} />
            <HerProjects assistantId={assistant.id} name={assistant.name} homeOnPage={onPage} homeNeedsPublish={needsPublish} homeNothingToKnow={nothingToKnow} />
          </div>
        </div>
        {/* The conversation stays mounted while she reads the visitors': a turn in flight isn't lost. */}
        <div className={tab === "talk" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <NewChatPanel flatProjectId={assistant.projectId} flatProjectHtml={projectHtml} onFlatHtmlUpdate={noCanvas} flatProjectChat={initialChat} assistant={her} figurePaused={creatorOpen || tab !== "talk"} centered />
        </div>
        {seen.has("conversations") && (
          <div className={tab === "conversations" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
            <VisitorConversations assistantId={assistant.id} name={assistant.name} />
          </div>
        )}
        {seen.has("requests") && (
          <div className={tab === "requests" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
            <VisitorRequests assistantId={assistant.id} name={assistant.name} />
          </div>
        )}
        </div>
      </div>
    </ToastProvider>
  );
}
