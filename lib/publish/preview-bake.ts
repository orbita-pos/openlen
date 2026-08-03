// Preview bake — the PURE module bakes from bakeDocument, applied to a draft
// document so preview surfaces show active modules WITHOUT publishing. The
// user-facing bug this closes: turning a module on produced nothing visible
// anywhere until the next publish, which reads as "the module is broken".
//
// Scope: exactly the module UI bakes (collections grid, assistant, comments,
// bookings, chat, video lightbox, WhatsApp FAB, orders cart) with the SAME
// gates, ordering and stacking as publishToDir — deliberately excluding the
// impure/publish-only steps (asset/font migration, live-data fetch, analytics,
// canonical/SEO, CSP seal, sign-in link wiring). Widget runtimes fetch their
// APIs from the visitor's browser; on an unpublished draft those calls no-op
// and the widget renders its static shell, which is what a preview needs.

import { fillPlatformsBand } from "@/lib/business-profiles/seed-html";
import { PLATFORMS_BAND_MARKER } from "@/lib/business-profiles/platforms-band";
import type { BusinessProfileData } from "@/lib/business-profiles/types";
import { bakeAssistantWidget } from "@/lib/publish/assistant-widget";
import { bakeComments, hasCommentsSection } from "@/lib/publish/comments-widget";
import { bakeBookings, hasBookingsSection } from "@/lib/publish/bookings-widget";
import { bakeCollections } from "@/lib/publish/collections-block";
import { bakeWhatsAppButton, waHref } from "@/lib/publish/whatsapp-button";
import { injectOrdersCart } from "@/lib/publish/orders-cart";
import { bakeChatWidget } from "@/lib/publish/chat-widget";
import { bakeVideoEmbeds } from "@/lib/publish/video-embed";
import { detectSiteAccent } from "@/lib/members/site-accent";
import {
  applySigninLink,
  accountLabelFor,
  signinLabelFor,
} from "@/lib/publish/signin-link";
import { memberDoorPlan, splitPagesForPublish } from "@/lib/projects/site-pages";
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
  /** Members door (memberDoorPlan) — mirrors publish's sign-in entry so the
   *  preview shows the same wired nav link the published site will have. */
  memberSignin?: { path: string; isAccount: boolean } | null;
  /** Per SECTION module: does the SITE declare its band in at least one
   *  document? Mirrors publish's "la banda manda" scoping — with a band
   *  somewhere, only the documents that carry it get the widget. Absent =
   *  no band known = the append-everywhere fallback. */
  sectionBands?: { bookings: boolean; comments: boolean };
  /** Links del perfil de negocio del dueño. Rellenan la banda si el documento
   *  lleva su marcador. HTML puro: NO se salta cuando ctx.sandboxed. */
  platforms?: BusinessProfileData["links"] | null;
  /** ¿El documento se sirve con CSP `sandbox` (sin allow-same-origin)? El
   *  origen opaco que eso da se HEREDA a los iframes anidados, y el player de
   *  YouTube revienta ahí — medido: lanza jserror y deja un rectángulo negro.
   *  Con esto en true el lightbox no se inyecta y el enlace sigue navegando
   *  fuera, que es lo correcto en esa superficie. */
  sandboxed?: boolean;
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
        {
          items: ctx.collectionsItems.items,
          layout: ctx.collectionsItems.layout,
          orders: ordersCfg,
          theme: s.collections?.theme,
        },
        ctx.page === null,
      );
    } catch {
      /* soft-fail like publish */
    }
  }

  // AI→human handoff — same single-source-of-truth rule as publishToDir.
  const assistantOn =
    process.env.OPENLEN_ASSISTANT !== "0" && s.assistant?.enabled === true;
  const handoffMerged =
    assistantOn &&
    process.env.OPENLEN_CHAT !== "0" &&
    s.chat?.enabled === true &&
    s.chat?.selfServeJoin !== false &&
    s.chat?.identityMode !== "account";

  if (assistantOn) {
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

  // "La banda manda", same rule as publish: a section module the creator placed
  // somewhere on the site previews ONLY where its band is.
  const bandRules = ctx.sectionBands ?? { bookings: false, comments: false };

  if (
    process.env.OPENLEN_COMMENTS !== "0" &&
    s.comments?.enabled === true &&
    (!bandRules.comments || hasCommentsSection(html))
  ) {
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

  if (
    process.env.OPENLEN_BOOKINGS !== "0" &&
    s.bookings?.enabled === true &&
    (!bandRules.bookings || hasBookingsSection(html))
  ) {
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
        // Same anti-overlap step as publish: an unmergeable chat (account /
        // invite-only) keeps its own bubble, one slot above the assistant's.
        bottomPx: !handoffMerged && assistantOn ? 18 + 68 : 18,
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

  if (ctx.platforms?.length) {
    try {
      out = fillPlatformsBand(out, { links: ctx.platforms } as BusinessProfileData);
    } catch {
      /* soft-fail */
    }
  }

  // In-page video playback. Universal (no module flag), same position in the
  // chain as publishToDir. Without it a creator's YouTube/Vimeo links only
  // become playable at publish, so the preview under-promises the page.
  // Skipped on sandboxed surfaces — see PreviewBakeCtx.sandboxed.
  if (process.env.OPENLEN_VIDEO_EMBED !== "0" && !ctx.sandboxed) {
    try {
      out = bakeVideoEmbeds(out);
    } catch {
      /* soft-fail */
    }
  }

  if (process.env.OPENLEN_WHATSAPP !== "0" && s.whatsapp?.enabled && s.whatsapp.number) {
    try {
      // Same FAB stacking as publish: the assistant takes the right corner's
      // first slot, an unmerged chat FAB the second; music occupies the left.
      const waSide = s.whatsapp.side === "left" ? "left" : "right";
      const chatFabOnRight =
        process.env.OPENLEN_CHAT !== "0" &&
        s.chat?.enabled === true &&
        s.chat.mount !== "section" &&
        !handoffMerged;
      const priorRightFabs = (assistantOn ? 1 : 0) + (chatFabOnRight ? 1 : 0);
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

  // Members sign-in entry — same rewire/inject publish does, same kill-switch,
  // so the preview never under-promises the door the published site gets.
  if (ctx.memberSignin && process.env.OPENLEN_MEMBER_SIGNIN !== "0") {
    try {
      const lang =
        /<html[^>]*\blang=["']?([a-zA-Z]{2})/.exec(out)?.[1]?.toLowerCase() ||
        "en";
      out = applySigninLink(out, {
        href: `/${ctx.memberSignin.path}`,
        label: ctx.memberSignin.isAccount
          ? accountLabelFor(lang)
          : signinLabelFor(lang),
        rewriteText: ctx.memberSignin.isAccount
          ? accountLabelFor(lang)
          : undefined,
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
    /** Ver PreviewBakeCtx.sandboxed — lo decide la ruta que sirve el HTML. */
    sandboxed?: boolean;
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
  const split = splitPagesForPublish(opts.data);
  const door = memberDoorPlan(
    opts.data,
    split.gatedPages.map((p) => p.slug),
  );
  // Same site-wide band scan publishToDir runs, over the same documents, so a
  // section module previews exactly where it will publish.
  const siteDocs = [
    opts.data?.html ?? "",
    ...split.publicPages.map((p) => p.html),
    ...split.gatedPages.map((p) => p.html),
  ];
  // Gated on the band actually being present — same shape as the collections
  // gate above (settings.collections.enabled) — so a site with no platforms
  // band never pays for the profile lookup.
  let platforms: PreviewBakeCtx["platforms"] = null;
  if (siteDocs.some((doc) => doc.includes(PLATFORMS_BAND_MARKER))) {
    try {
      const { db, schema } = await import("@/lib/db");
      const { eq } = await import("drizzle-orm");
      const { projectBusinessProfile } = await import(
        "@/lib/business-profiles/whatsapp-default"
      );
      // projectBusinessProfile resolves linked-profile-first-else-default (the
      // one canonical resolution — lib/business-profiles/whatsapp-default.ts),
      // but it's an ownership-scoped lookup (projectId + userId). Callers here
      // don't necessarily have a session (the public /p/[id] draft link has
      // none), so resolve the project's own owner first — this is a read of
      // the project's OWN business profile for ITS OWN preview surface, not an
      // access-control decision on behalf of the requester.
      const rows = await db
        .select({ userId: schema.projects.userId })
        .from(schema.projects)
        .where(eq(schema.projects.id, opts.projectId))
        .limit(1);
      const ownerId = rows[0]?.userId;
      if (ownerId) {
        const profile = await projectBusinessProfile(opts.projectId, ownerId);
        platforms = profile?.links ?? null;
      }
    } catch {
      platforms = null;
    }
  }
  return bakeModulesForPreviewHtml(html, {
    projectId: opts.projectId,
    title: opts.title,
    sub: opts.sub,
    page: opts.page,
    settings: opts.data?.settings,
    sandboxed: opts.sandboxed,
    collectionsItems,
    platforms,
    memberSignin: door.signinPath
      ? { path: door.signinPath, isAccount: door.signinIsAccount }
      : null,
    sectionBands: {
      bookings: siteDocs.some(hasBookingsSection),
      comments: siteDocs.some(hasCommentsSection),
    },
  });
}
