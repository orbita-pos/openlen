// Módulos as a full-center VIEW (was a 272px rail panel). Hosts the hub
// (ModulesPanel — a modern card grid + the live member list) and routes to each
// module's management surface in the same center, with a back link to the hub.
// Insert actions return to the canvas so the freshly-baked section is visible.
//
// Encapsulates its own sub-routing so the parent only renders <ModulesView/>
// for centerView === "modulos" and passes the same module settings/handlers it
// already owns. The sub-panels are imported here (not in the parent).

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Globe } from "./icons";
import type {
  BookingsSettings,
  BroadcastSettings,
  ChatSettings,
  CollectionsSettings,
  CommentsSettings,
  MembersSettings,
  OrdersSettings,
  WhatsAppSettings,
} from "@/lib/projects/types";
import type { PlacedModule } from "@/lib/projects/module-placements";
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
  ordersSettings?: OrdersSettings;
  onUpdateOrdersSettings?: (patch: OrdersSettings) => Promise<boolean>;
  chatSettings?: ChatSettings;
  onUpdateChatSettings?: (patch: ChatSettings) => Promise<boolean>;
  /** "Mis plataformas" — links captured on the active business profile, the
   *  insert action, and the escape hatch to Mi negocio when there are none. */
  platformLinkCount?: number;
  onInsertPlatformsSection?: () => void;
  onOpenBusinessProfile?: () => void;
  /** Create a dedicated, brand-matched page for a module (bookings/collections). */
  onCreateModulePage?: (module: "bookings" | "collections") => void | Promise<void>;
  /** Insert the designed WhatsApp CTA section into the home. */
  onAddWhatsappSection?: () => void;
  /** Jump to the account sections that already host these (center swap). */
  onShowLeads?: () => void;
  onShowAnalytics?: () => void;
  /** Called after an insert so the parent can land the canvas back in view. */
  onReturnToCanvas?: () => void;
  /** Where each content module's band already lives across the site —
   *  drives the hub's placement line + "Add to a page" deep-link. */
  placements?: Record<PlacedModule, string[]>;
  /** Jump to the Library so the user can drop a module section onto another page. */
  onOpenLibrary?: () => void;
  /** One-shot: land on this sub-panel (the "Administrar productos" deep-link
   *  from the Library). Consumed via onInitialSubConsumed — a nonce-ref here
   *  misfires when the view mounts AFTER the click (needed two clicks). */
  initialSub?: "collections" | null;
  onInitialSubConsumed?: () => void;
  sitePages?: { slug: string; title: string }[];
  activeSitePage?: string | null;
  onSwitchPage?: (slug: string | null) => void;
  homePageLabel?: string;
  projectTitle?: string | null;
  projectSubdomain?: string | null;
}

export function ModulesView(props: ModulesViewProps) {
  const t = useTranslations("members");
  const tw = useTranslations("wsPage");
  const [sub, setSub] = useState<Sub>("hub");
  useEffect(() => {
    if (props.initialSub) {
      setSub(props.initialSub);
      props.onInitialSubConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialSub]);

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
              ordersSettings={props.ordersSettings}
              onUpdateOrders={props.onUpdateOrdersSettings}
              chatSettings={props.chatSettings}
              onUpdateChat={props.onUpdateChatSettings}
              platformLinkCount={props.platformLinkCount}
              onInsertPlatformsSection={() => afterInsert(props.onInsertPlatformsSection)}
              onOpenBusinessProfile={props.onOpenBusinessProfile}
              onCreateModulePage={async (m) => {
                await props.onCreateModulePage?.(m);
                props.onReturnToCanvas?.();
              }}
              onAddWhatsappSection={() => afterInsert(props.onAddWhatsappSection)}
              onShowLeads={props.onShowLeads}
              onShowAnalytics={props.onShowAnalytics}
              onShowAssistant={() => setSub("assistant")}
              placements={props.placements}
              onOpenLibrary={props.onOpenLibrary}
              sitePages={props.sitePages}
              activeSitePage={props.activeSitePage}
              onSwitchPage={props.onSwitchPage}
              homePageLabel={props.homePageLabel}
              projectTitle={props.projectTitle}
              projectSubdomain={props.projectSubdomain}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="shrink-0 w-full max-w-2xl mx-auto px-5 pt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setSub("hub")}
              className="inline-flex items-center gap-1 text-[12px] fg-muted hover:fg transition"
            >
              <span aria-hidden>‹</span>
              <span>{t("title")}</span>
            </button>
            {props.projectTitle && (
              <span className="inline-flex items-center gap-1.5 rounded-full ring-1 ring-[color:var(--border)] bg-elev px-2.5 py-1 min-w-0">
                <Globe size={11} className="text-accent shrink-0" />
                <span className="text-[9.5px] uppercase tracking-[0.12em] fg-faint font-semibold shrink-0">
                  {tw("modulesHub.siteLabel")}
                </span>
                <span className="text-[11.5px] font-semibold fg truncate">{props.projectTitle}</span>
                {props.projectSubdomain && (
                  <span className="text-[10.5px] fg-faint truncate">
                    {props.projectSubdomain}.openlen.com
                  </span>
                )}
              </span>
            )}
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
