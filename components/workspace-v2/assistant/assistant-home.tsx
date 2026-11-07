"use client";

// THE ASSISTANT'S PLACE (spec local 2026-11-06-asistente-propio, §4.6.2): /<locale>/assistant/<name>, a clean page with
// only its conversation — Len's chat panel as the assistant, without the workshop around it. It never writes the
// project: the canvas update is a no-op, and the turn's session is read-only on the server.
import { useTranslations } from "next-intl";

import type { AssistantView } from "@/lib/assistants/view";
import type { StoredChatTurn } from "@/lib/projects/types";

import { NewChatPanel } from "../chat/new-chat-panel";
import { ToastProvider } from "../toast";

const noCanvas = () => {};

export function AssistantHome({ assistant, projectHtml, initialChat }: { assistant: AssistantView; projectHtml: string; initialChat: StoredChatTurn[] }) {
  const t = useTranslations("common");
  return (
    <ToastProvider dismissLabel={t("close")}>
      <div className="workspace-v2 flex h-dvh flex-col bg-side">
        <NewChatPanel flatProjectId={assistant.projectId} flatProjectHtml={projectHtml} onFlatHtmlUpdate={noCanvas} flatProjectChat={initialChat} assistant={assistant} centered />
      </div>
    </ToastProvider>
  );
}
