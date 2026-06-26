// Módulos as a full-center VIEW (was a 272px rail panel). Hosts the hub
// (ModulesPanel — a modern card grid + the live member list) and routes to each
// module's management surface in the same center, with a back link to the hub.
// Insert actions return to the canvas so the freshly-baked section is visible.
//
// Encapsulates its own sub-routing so the parent only renders <ModulesView/>
// for centerView === "modulos" and passes the same module settings/handlers it
// already owns. The sub-panels are imported here (not in the parent).

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type {
  BookingsSettings,
  BroadcastSettings,
  CollectionsSettings,
  CommentsSettings,
  MembersSettings,
  WhatsAppSettings,
} from "@/lib/projects/types";
import { ModulesPanel } from "./panels/modules-panel";
import { BroadcastPanel } from "./panels/broadcast-panel";
import { CommentsPanel } from "./panels/comments-panel";
import { BookingsPanel } from "./panels/bookings-panel";
import { CollectionsPanel } from "./panels/collections-panel";
import { AssistantPanel } from "./panels/assistant-panel";

type Sub = "hub" | "broadcast" | "comments" | "bookings" | "collections" | "assistant";

export interface ModulesViewProps {
  currentProjectId?: string | null;
  /** Pages currently carrying the members-only flag (drives the hub hint). */
  gatedCount: number;
  membersSettings?: MembersSettings;
  onUpdateMembersSettings?: (
    patch: MembersSettings,
  ) => Promise<{ ok: boolean; createdPageSlug?: string }>;
  broadcastSettings?: BroadcastSettings;
  onUpdateBroadcastSettings?: (patch: BroadcastSettings) => Promise<boolean>;
  commentsSettings?: CommentsSettings;
  onUpdateCommentsSettings?: (patch: CommentsSettings) => Promise<boolean>;
  onInsertCommentsSection?: () => void;
  bookingsSettings?: BookingsSettings;
  onUpdateBookingsSettings?: (patch: BookingsSettings) => Promise<boolean>;
  onInsertBookingsSection?: () => void;
  collectionsSettings?: CollectionsSettings;
  onUpdateCollectionsSettings?: (patch: CollectionsSettings) => Promise<boolean>;
  onInsertCollectionsSection?: () => void;
  whatsappSettings?: WhatsAppSettings;
  onUpdateWhatsappSettings?: (patch: WhatsAppSettings) => Promise<boolean>;
  /** Jump to the account sections that already host these (center swap). */
  onShowLeads?: () => void;
  onShowAnalytics?: () => void;
  /** Called after an insert so the parent can land the canvas back in view. */
  onReturnToCanvas?: () => void;
}

export function ModulesView(props: ModulesViewProps) {
  const t = useTranslations("members");
  const [sub, setSub] = useState<Sub>("hub");

  // Insert into the page, then drop the user back on the canvas to see it.
  const afterInsert = (fn?: () => void) => {
    fn?.();
    props.onReturnToCanvas?.();
  };

  return (
    <section className="flex-1 min-w-0 min-h-0 flex flex-col bg-app">
      {sub === "hub" ? (
        <div className="flex-1 min-h-0 overflow-y-auto nice-scroll">
          <div className="max-w-[880px] mx-auto px-6 sm:px-8 py-9">
            <ModulesPanel
              currentProjectId={props.currentProjectId}
              gatedCount={props.gatedCount}
              membersSettings={props.membersSettings}
              onUpdateMembers={props.onUpdateMembersSettings}
              broadcastSettings={props.broadcastSettings}
              onUpdateBroadcast={props.onUpdateBroadcastSettings}
              onShowBroadcast={() => setSub("broadcast")}
              commentsSettings={props.commentsSettings}
              onUpdateComments={props.onUpdateCommentsSettings}
              onInsertCommentsSection={() => afterInsert(props.onInsertCommentsSection)}
              onShowComments={() => setSub("comments")}
              bookingsSettings={props.bookingsSettings}
              onUpdateBookings={props.onUpdateBookingsSettings}
              onInsertBookingsSection={() => afterInsert(props.onInsertBookingsSection)}
              onShowBookings={() => setSub("bookings")}
              collectionsSettings={props.collectionsSettings}
              onUpdateCollections={props.onUpdateCollectionsSettings}
              onInsertCollectionsSection={() => afterInsert(props.onInsertCollectionsSection)}
              onShowCollections={() => setSub("collections")}
              whatsappSettings={props.whatsappSettings}
              onUpdateWhatsapp={props.onUpdateWhatsappSettings}
              onShowLeads={props.onShowLeads}
              onShowAnalytics={props.onShowAnalytics}
              onShowAssistant={() => setSub("assistant")}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="shrink-0 w-full max-w-2xl mx-auto px-5 pt-4">
            <button
              type="button"
              onClick={() => setSub("hub")}
              className="inline-flex items-center gap-1 text-[12px] fg-muted hover:fg transition"
            >
              <span aria-hidden>‹</span>
              <span>{t("title")}</span>
            </button>
          </div>
          <div className="flex-1 min-h-0 w-full max-w-2xl mx-auto flex flex-col">
            {sub === "broadcast" && (
              <BroadcastPanel
                currentProjectId={props.currentProjectId}
                membersEnabled={props.membersSettings?.enabled === true}
              />
            )}
            {sub === "comments" && (
              <CommentsPanel currentProjectId={props.currentProjectId} />
            )}
            {sub === "bookings" && (
              <BookingsPanel
                currentProjectId={props.currentProjectId}
                defaultTz={props.bookingsSettings?.creatorTz}
              />
            )}
            {sub === "collections" && (
              <CollectionsPanel currentProjectId={props.currentProjectId} />
            )}
            {sub === "assistant" && (
              <AssistantPanel currentProjectId={props.currentProjectId} />
            )}
          </div>
        </>
      )}
    </section>
  );
}
