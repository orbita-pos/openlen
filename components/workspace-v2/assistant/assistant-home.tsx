"use client";

// THE ASSISTANT'S PLACE (spec local 2026-11-06-asistente-propio, §4.6.2): /<locale>/assistant/<name>, a clean page —
// Len's chat panel as the assistant, without the workshop around it. It never writes the project: the canvas update is
// a no-op, and the turn's session is read-only on the server. Phase 2A adds «Conversaciones» (what the page's visitors
// said to her) and «En mi página»; phase 3, «Pedidos» (what visitors asked for and couldn't be done, joined into cards
// only the owner's press turns into Len's work). Each tab after the first mounts the first time it opens. Phase 4: the
// projects she serves, beside her home's «En mi página», where she is taken off one or deleted.
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { AssistantView } from "@/lib/assistants/view";
import type { StoredChatTurn } from "@/lib/projects/types";

import { NewChatPanel } from "../chat/new-chat-panel";
import { ToastProvider } from "../toast";
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
  const [seen, setSeen] = useState<ReadonlySet<Tab>>(new Set(["talk"]));
  const tabs: readonly Tab[] = ["talk", "conversations", "requests"];
  return (
    <ToastProvider dismissLabel={tc("close")}>
      <div className="workspace-v2 flex h-dvh flex-col bg-side">
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b bd px-4 py-2" data-assistant-controls="">
          <div role="tablist" className="flex items-center gap-1">
            {tabs.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => (setTab(k), setSeen((s) => (s.has(k) ? s : new Set(s).add(k))))}
                className={`rounded-full px-3 py-1 text-[12.5px] ${tab === k ? "seg-active fg" : "fg-muted hover:fg"}`}
              >
                {t(TAB_LABEL[k])}
              </button>
            ))}
          </div>
          <div className="ml-auto flex min-w-0 flex-wrap items-center gap-3">
            <RenameHer assistantId={assistant.id} name={assistant.name} onPage={onPage} />
            <MorningSummarySwitch assistantId={assistant.id} initial={assistant.morningSummary === true} />
            <HerProjects assistantId={assistant.id} name={assistant.name} homeOnPage={onPage} homeNeedsPublish={needsPublish} homeNothingToKnow={nothingToKnow} />
          </div>
        </div>
        {/* The conversation stays mounted while she reads the visitors': a turn in flight isn't lost. */}
        <div className={tab === "talk" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <NewChatPanel flatProjectId={assistant.projectId} flatProjectHtml={projectHtml} onFlatHtmlUpdate={noCanvas} flatProjectChat={initialChat} assistant={assistant} centered />
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
    </ToastProvider>
  );
}
