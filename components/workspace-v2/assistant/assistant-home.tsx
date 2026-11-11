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
import { Inbox, MessageCircle, MoreHorizontal, PanelRight, Users, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { AssistantView } from "@/lib/assistants/view";
import type { StoredChatTurn } from "@/lib/projects/types";

import { NewChatPanel } from "../chat/new-chat-panel";
import { ToastProvider } from "../toast";
import { ChangeFigure } from "./change-figure";
import { HerPage } from "./her-page";
import { HerProjects } from "./her-projects";
import { HerTint } from "./her-sheet";
import { MorningSummarySwitch } from "./morning-summary-switch";
import { RenameHer } from "./rename-her";
import { tintStyle } from "./tint";
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
const PAGE_PANE = "openlen:her-page-pane";

export function AssistantHome({
  assistant,
  projectHtml,
  address = null,
  projectTitle = null,
  initialChat,
  onPage,
  needsPublish,
  nothingToKnow,
}: {
  assistant: AssistantView;
  projectHtml: string;
  /** Where her home's page is published, or null. */
  address?: string | null;
  projectTitle?: string | null;
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
  // Her color for the whole place, and for what it draws outside its root (its sheets).
  const tint = useMemo(() => tintStyle(look.color) as CSSProperties, [look.color]);
  const [seen, setSeen] = useState<ReadonlySet<Tab>>(new Set(["talk"]));
  const tabs: readonly Tab[] = ["talk", "conversations", "requests"];
  const [menuOpen, setMenuOpen] = useState(false);
  // Her page beside her chat. Put away, it stays away on this device until it is asked for again.
  const [pageOpen, setPageOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(PAGE_PANE) === "0") setPageOpen(false);
    } catch {
      // No storage (a private window): it opens, as it does the first time.
    }
  }, []);
  const togglePage = () =>
    setPageOpen((open) => {
      try {
        localStorage.setItem(PAGE_PANE, open ? "0" : "1");
      } catch {
        // Same.
      }
      return !open;
    });
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
      <HerTint.Provider value={tint}>
      {/* ONE WINDOW (11/11, Jesús, on the reference he sent: «el mío se ve como si fueran dos apps»): one bar across the
          top, one ground under her rail and her chat and around her page — her color washing down from the top —, and
          her page as a card on that ground. */}
      <div className="workspace-v2 her-shell relative flex h-dvh flex-col" style={tint}>
        {/* The bar holds only her place's two buttons, at its right end: the page's name is in its own address bar. */}
        <div className="h-11 shrink-0" data-her-bar="" />
        <div ref={menu} className="absolute right-3 top-3 z-20 flex flex-col items-end gap-2">
          <div className="flex items-center gap-1">
            {tab === "talk" && (
              <button
                type="button"
                data-her-page-toggle=""
                aria-pressed={pageOpen}
                aria-label={t(pageOpen ? "ownAssistant.page.hide" : "ownAssistant.page.show")}
                title={t(pageOpen ? "ownAssistant.page.hide" : "ownAssistant.page.show")}
                onClick={togglePage}
                className={`her-ring hidden h-8 w-8 items-center justify-center rounded-full transition-colors min-[860px]:flex ${pageOpen ? "fg" : "fg-muted"} hover:bg-hover hover:fg`}
              >
                <PanelRight size={16} strokeWidth={1.8} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              data-assistant-menu=""
              aria-expanded={menuOpen}
              aria-label={t("ownAssistant.place.settings")}
              title={t("ownAssistant.place.settings")}
              onClick={() => setMenuOpen((o) => !o)}
              className={`her-ring flex h-8 w-8 items-center justify-center rounded-full transition-colors ${menuOpen ? "bg-hover fg" : "fg-muted hover:bg-hover hover:fg"}`}
            >
              <MoreHorizontal size={17} aria-hidden="true" />
            </button>
          </div>
          {/* Closed it is hidden, not unmounted: a rename half written or a switch in flight is not lost. */}
          <div
            className={menuOpen ? "slide-down flex w-[min(17.5rem,calc(100vw-5rem))] flex-col rounded-[14px] border bd-strong bg-elev p-1.5 shadow-[0_18px_48px_-12px_rgba(0,0,0,0.5)]" : "hidden"}
            data-assistant-controls=""
            // A row that opens its own sheet or dialog is the menu's answer: the menu steps aside.
            onClick={(e) => (e.target as Element).closest("[data-rename-open], [data-change-figure]") && setMenuOpen(false)}
          >
            <RenameHer assistantId={assistant.id} name={assistant.name} onPage={onPage} />
            <ChangeFigure assistant={her} onPage={onPage} onChanged={setLook} onOpenChange={setCreatorOpen} />
            <div className="my-1 h-px bg-[var(--border)]" />
            <MorningSummarySwitch assistantId={assistant.id} initial={assistant.morningSummary === true} />
            <HerProjects assistantId={assistant.id} name={assistant.name} homeOnPage={onPage} homeNeedsPublish={needsPublish} homeNothingToKnow={nothingToKnow} />
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          <div role="tablist" aria-orientation="vertical" className="flex w-[54px] shrink-0 flex-col items-center gap-1.5 pt-1" data-assistant-rail="">
            {tabs.map((k) => {
              const Icon = TAB_ICON[k];
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  title={t(TAB_LABEL[k])}
                  onClick={() => (setTab(k), setMenuOpen(false), setSeen((s) => (s.has(k) ? s : new Set(s).add(k))))}
                  className={`her-ring flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors ${tab === k ? "her-wash fg" : "fg-faint hover:bg-hover hover:fg"}`}
                >
                  <Icon size={18} strokeWidth={tab === k ? 2 : 1.7} aria-hidden="true" />
                  <span className="sr-only">{t(TAB_LABEL[k])}</span>
                </button>
              );
            })}
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* The conversation stays mounted while she reads the visitors': a turn in flight isn't lost. */}
            <div className={tab === "talk" ? "flex min-h-0 flex-1" : "hidden"}>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <NewChatPanel flatProjectId={assistant.projectId} flatProjectHtml={projectHtml} onFlatHtmlUpdate={noCanvas} flatProjectChat={initialChat} assistant={her} figurePaused={creatorOpen || tab !== "talk"} centered />
              </div>
              {/* Windows of 860 px or more: on a narrower one the conversation is the place. */}
              {pageOpen && (
                <div className="hidden min-h-0 min-w-0 flex-1 pb-2 pr-2 min-[860px]:flex">
                  <HerPage projectId={assistant.projectId} html={projectHtml} address={address} title={projectTitle} />
                </div>
              )}
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
      </div>
      </HerTint.Provider>
    </ToastProvider>
  );
}
