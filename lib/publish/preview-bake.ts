// Preview bake — the PURE module bakes from bakeDocument, applied to a draft
// document so preview surfaces show active modules WITHOUT publishing. The
// user-facing bug this closes: turning a module on produced nothing visible
// anywhere until the next publish, which reads as "the module is broken".
//
// Scope: exactly the module UI bakes (collections grid, assistant, comments,
// bookings, chat, video lightbox, WhatsApp FAB) with the SAME
// gates, ordering and stacking as publishToDir — deliberately excluding the
// impure/publish-only steps (asset/font migration, live-data fetch, analytics,
// canonical/SEO, CSP seal, sign-in link wiring). Widget runtimes fetch their
// APIs from the visitor's browser; on an unpublished draft those calls no-op
// and the widget renders its static shell, which is what a preview needs.

import type { BusinessProfileData } from "@/lib/business-profiles/types";
import { bakeAssistantWidget } from "@/lib/publish/assistant-widget";
import { bakeChatWidget } from "@/lib/publish/chat-widget";
import { detectSiteAccent } from "@/lib/publish/site-accent";
import { splitPagesForPublish } from "@/lib/projects/site-pages";
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
  /** Per SECTION module: does the SITE declare its band in at least one
   *  document? Mirrors publish's "la banda manda" scoping — with a band
   *  somewhere, only the documents that carry it get the widget. Absent =
   *  no band known = the append-everywhere fallback. */
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

  // ⚰️ El horneado del catálogo se fue el 2026-08-29, AQUÍ Y EN EL PUBLICADOR
  // a la vez — es lo que exige `bake-surfaces.ts`: un horneado que existe en una
  // superficie y no en la otra es un borrador que miente. Un catálogo es ahora
  // un almacén de `lectura`.
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

  // ⚰️ LA BANDA DE PLATAFORMAS se fue el 2026-08-29, aquí y en el publicador a
  // la vez — que es lo que exige `bake-surfaces.ts`: un horneado que existe en
  // una superficie y no en la otra es un borrador que miente. Era un TECHO: el
  // prompt le decía al modelo que las plataformas SON una banda, así que nunca
  // le proponía otra cosa. Los enlaces siguen en el perfil; la forma la decide
  // ahora él.
  // VÍDEO Y MAPAS RETIRADOS el 2026-08-26, aquí y en el publicador a la vez —
  // que es lo que exige `bake-surfaces.ts`: un horneado que existe en una
  // superficie y no en la otra es un hueco silencioso.
  //
  // Los dos existían para devolver el `<iframe>` que el saneador acababa de
  // quitar. Ahora el modelo escribe el embebido y nadie se lo borra.





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
  // ⚰️ Aquí se cargaban los items del catálogo desde la base para la vista
  // previa. Se van con su horneado: era su único consumidor, así que cada
  // borrador deja de pagar dos consultas.
  const split = splitPagesForPublish(opts.data);
  // Same site-wide band scan publishToDir runs, over the same documents, so a
  // section module previews exactly where it will publish.
  const siteDocs = [
    opts.data?.html ?? "",
    ...split.publicPages.map((p) => p.html),
    ...split.gatedPages.map((p) => p.html),
  ];
  // ⚰️ Aquí se buscaba el perfil del negocio para llenar la banda. Se va con
  // ella: era su ÚNICO consumidor, así que la vista previa deja de pagar una
  // consulta a la base por una sección que ya no existe.
  const platforms: PreviewBakeCtx["platforms"] = null;
  return bakeModulesForPreviewHtml(html, {
    projectId: opts.projectId,
    title: opts.title,
    sub: opts.sub,
    page: opts.page,
    settings: opts.data?.settings,
    sandboxed: opts.sandboxed,
    platforms,
  });
}
