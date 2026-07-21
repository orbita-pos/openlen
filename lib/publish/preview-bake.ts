// Preview bake — the PURE module bakes from bakeDocument, applied to a draft
// document so preview surfaces show active modules WITHOUT publishing. The
// user-facing bug this closes: turning a module on produced nothing visible
// anywhere until the next publish, which reads as "the module is broken".
//
// Scope: exactly the module UI bakes (collections grid, assistant, comments,
// bookings, chat, WhatsApp FAB, orders cart) with the SAME gates, ordering and
// stacking as publishToDir — deliberately excluding the impure/publish-only
// steps (asset/font migration, live-data fetch, analytics, canonical/SEO, CSP
// seal, sign-in link wiring). Widget runtimes fetch their APIs from the
// visitor's browser; on an unpublished draft those calls no-op and the widget
// renders its static shell, which is what a preview needs.

import { bakeAssistantWidget } from "@/lib/publish/assistant-widget";
import { bakeComments } from "@/lib/publish/comments-widget";
import { bakeBookings } from "@/lib/publish/bookings-widget";
import { bakeCollections } from "@/lib/publish/collections-block";
import { bakeWhatsAppButton, waHref } from "@/lib/publish/whatsapp-button";
import { injectOrdersCart } from "@/lib/publish/orders-cart";
import { bakeChatWidget } from "@/lib/publish/chat-widget";
import { detectSiteAccent } from "@/lib/members/site-accent";
import type { ItemRow } from "@/lib/collections/store";
import type { ProjectData } from "@/lib/projects/types";

export interface PreviewBakeCtx {
  projectId: string;
  title?: string | null;
  /** Published subdomain when one exists — widget runtimes use it to reach
   *  their APIs; an unpublished draft passes null and the shells still render. */
  sub?: string | null;
  /** Subpage slug, null = home. */
  page: string | null;
  settings: ProjectData["settings"] | undefined;
  /** Pre-loaded collections payload (DB read happens in the async wrapper). */
  collectionsItems?: { items: ItemRow[]; layout: "grid" | "list" } | null;
}

export function bakeModulesForPreviewHtml(html: string, ctx: PreviewBakeCtx): string {
  const s = ctx.settings ?? {};
  const sub = ctx.sub ?? "";
  let out = html;

  // Collections + orders config — same usable-number predicate as publish.
  const ordersNumberUsable =
    s.orders?.enabled === true && waHref(s.orders.number ?? "") !== null;
  const ordersCfg =
    process.env.OPENLEN_ORDERS !== "0" && ordersNumberUsable
      ? { number: s.orders!.number! }
      : null;
  if (ctx.collectionsItems) {
    try {
      out = bakeCollections(
        out,
        { items: ctx.collectionsItems.items, layout: ctx.collectionsItems.layout, orders: ordersCfg },
        ctx.page === null,
      );
    } catch {
      /* soft-fail like publish */
    }
  }

  // AI→human handoff — same single-source-of-truth rule as publishToDir.
  const handoffMerged =
    process.env.OPENLEN_ASSISTANT !== "0" &&
    s.assistant?.enabled === true &&
    process.env.OPENLEN_CHAT !== "0" &&
    s.chat?.enabled === true &&
    s.chat?.selfServeJoin !== false &&
    s.chat?.identityMode !== "account";

  if (process.env.OPENLEN_ASSISTANT !== "0" && s.assistant?.enabled === true) {
    try {
      out = bakeAssistantWidget(out, {
        sub,
        apiBase: previewApiBase(),
        businessName: ctx.title || sub || "",
        chatHandoff: handoffMerged,
      });
    } catch {
      /* soft-fail */
    }
  }

  const siteAccent = detectSiteAccent(out) ?? undefined;

  if (process.env.OPENLEN_COMMENTS !== "0" && s.comments?.enabled === true) {
    try {
      out = bakeComments(out, {
        sub,
        page: ctx.page,
        accent: siteAccent,
        theme: s.comments.theme,
      });
    } catch {
      /* soft-fail */
    }
  }

  if (process.env.OPENLEN_BOOKINGS !== "0" && s.bookings?.enabled === true) {
    try {
      out = bakeBookings(out, { sub, accent: siteAccent, theme: s.bookings.theme });
    } catch {
      /* soft-fail */
    }
  }

  if (process.env.OPENLEN_CHAT !== "0" && s.chat?.enabled === true) {
    try {
      const chatMount =
        handoffMerged && s.chat.mount === "section" ? "both" : (s.chat.mount ?? "both");
      out = bakeChatWidget(out, {
        sub,
        accent: siteAccent,
        mount: chatMount,
        selfServeJoin: s.chat.selfServeJoin !== false,
        title: ctx.title ?? undefined,
        identityMode: s.chat.identityMode,
        welcome: s.chat.welcome,
        quickReplies: s.chat.quickReplies,
        theme: s.chat.theme,
        chatAsHandoffTarget: handoffMerged,
      });
    } catch {
      /* soft-fail */
    }
  }

  if (process.env.OPENLEN_WHATSAPP !== "0" && s.whatsapp?.enabled && s.whatsapp.number) {
    try {
      // Same FAB stacking as publish: assistant OR a standalone chat FAB owns
      // the right corner's first slot; music occupies the left.
      const waSide = s.whatsapp.side === "left" ? "left" : "right";
      const chatFabOnRight =
        process.env.OPENLEN_CHAT !== "0" &&
        s.chat?.enabled === true &&
        s.chat.mount !== "section" &&
        !handoffMerged;
      const priorRightFabs =
        (process.env.OPENLEN_ASSISTANT !== "0" && s.assistant?.enabled === true ? 1 : 0) +
        (chatFabOnRight ? 1 : 0);
      const leftOccupied = waSide === "left" && !!s.music?.src;
      out = bakeWhatsAppButton(out, {
        number: s.whatsapp.number,
        message: s.whatsapp.message,
        side: s.whatsapp.side,
        bottomPx:
          waSide === "right" ? 18 + priorRightFabs * 68 : leftOccupied ? 86 : 18,
      });
    } catch {
      /* soft-fail */
    }
  }

  if (process.env.OPENLEN_ORDERS !== "0" && ordersNumberUsable) {
    try {
      out = injectOrdersCart(out, {
        number: s.orders!.number!,
        projectId: ctx.projectId,
        page: ctx.page,
      });
    } catch {
      /* soft-fail */
    }
  }

  return out;
}

/** Same resolution as publishToDir's assistantApiBase — the widget runtime
 *  needs an absolute base because preview documents render on opaque origins
 *  (srcDoc iframe / sandboxed /p/). */
function previewApiBase(): string {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://openlen.com";
}

/** DB-aware wrapper: loads the collections payload the same way
 *  publishProject does, then runs the pure pipeline. Collections load
 *  soft-fails to "no grid" — a preview must never 500 over module data. */
export async function bakeModulesForPreview(
  html: string,
  opts: {
    projectId: string;
    title?: string | null;
    sub?: string | null;
    page: string | null;
    data: ProjectData | null | undefined;
  },
): Promise<string> {
  let collectionsItems: PreviewBakeCtx["collectionsItems"] = null;
  if (opts.data?.settings?.collections?.enabled) {
    try {
      const { getDefaultCollection, listItems } = await import("@/lib/collections/store");
      const col = await getDefaultCollection(opts.projectId);
      if (col) {
        collectionsItems = {
          items: await listItems(opts.projectId, col.id, { includeArchived: false }),
          layout: col.layout,
        };
      }
    } catch {
      collectionsItems = null;
    }
  }
  return bakeModulesForPreviewHtml(html, {
    projectId: opts.projectId,
    title: opts.title,
    sub: opts.sub,
    page: opts.page,
    settings: opts.data?.settings,
    collectionsItems,
  });
}
