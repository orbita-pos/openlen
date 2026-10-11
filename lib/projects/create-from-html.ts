// CREAR UN PROYECTO DESDE HTML: lo que hacía entera la ruta «pegar HTML»
// (app/api/projects/from-html), sacado aquí para que el servidor MCP
// (`create_project`, plans/mcp-de-openlen) entre por la MISMA puerta. La ruta
// sigue teniendo lo suyo (sesión, tope de ingestión, cuerpo de la petición).
//
// LA ENTRADA COMO VERCEL (2026-10-04, decidido por Jesús). Lo que se pega se
// guarda como se pegó, con su JavaScript: aquí no pasa `sanitizeForPublish`,
// sólo `gateReservedMarker`, la MISMA puerta que lo que escribe el modelo.
//
// Safety:
// - 8 MB max HTML size.
// - Rejects `data-slot-path=` editor markers, in every variant; the same gate
//   runs again in publishToDir as defense in depth.
import { db, schema } from "@/lib/db";
import { gateReservedMarker } from "@/lib/html-engine";
import { passHtmlGate } from "@/lib/html-gate/document-gate";
import { MAX_HTML_BYTES } from "@/lib/projects/limites-html";
import { renderProjectThumbnail } from "@/lib/projects/thumbnail";
import { createVersion } from "@/lib/projects/versions";
import { pageMetaFor } from "@/lib/publish/page-meta-intent";

export function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const inner = match?.[1]?.trim();
  return inner && inner.length > 0 ? inner.slice(0, 200) : null;
}

export async function createProjectFromHtml(p: {
  userId: string;
  html: string;
  title?: string;
  brief?: string;
  tags?: string[];
}): Promise<{ ok: true; projectId: string; title: string } | { ok: false; error: "empty" | "too_large" | "invalid_html" | "db_insert_failed" }> {
  if (p.html.trim().length === 0) return { ok: false, error: "empty" };
  if (Buffer.byteLength(p.html, "utf8") > MAX_HTML_BYTES) return { ok: false, error: "too_large" };

  const title = p.title?.trim() || extractTitle(p.html) || "Untitled page";

  // ⚰️ Aquí se resolvía el PERFIL DE NEGOCIO al crear (`resolveProfileForCreation`)
  // para que la página naciera con los datos del dueño. Retirado el 2026-08-31.
  // Los datos viven en la página; el logo se pone desde el inspector, que es
  // donde el dueño lo ve.

  // One gate. This surface FAILS OPEN: the project does
  // not exist yet, so refusing costs the user the whole page instead of an
  // edit. `seal: false` (publishToDir seals at publish time) and
  // `render: false` (a paste cannot pay a browser launch).
  const gated = await passHtmlGate(
    p.html,
    {
      sanitize: gateReservedMarker,
      // ⚰️ Aquí se sembraba el perfil de negocio (`seedBrandIntoHtml`).
      // Retirado el 2026-08-31: los datos del dueño viven en su página, no en
      // otra tabla que los repinta.
    },
    {
      render: false,
      seal: false,
      // AUTHORED: a human may have written this <head>. Never take it over.
      meta: pageMetaFor({ provenance: "authored", title }),
    },
  );
  // The reserved marker never fails open, anywhere. `gateReservedMarker`
  // refuses ONLY for it, so both codes mean the same thing here: the literal
  // marker, or one of its encoded variants.
  if (!gated.ok) return { ok: false, error: "invalid_html" };
  const finalHtml = gated.html;

  const projectId = crypto.randomUUID();
  try {
    await db.insert(schema.projects).values({
      id: projectId,
      userId: p.userId,
      title,
      brief: p.brief ?? `Pasted HTML${p.title ? `: ${p.title}` : ""}`,
      thumbnailUrl: null,
      tags: p.tags ?? ["paste"],
      status: "draft",
      data: { html: finalHtml },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[from-html] db insert failed", err);
    return { ok: false, error: "db_insert_failed" };
  }

  // Seed the version history with the pasted HTML — anchor point the user
  // can restore to if subsequent chats / inline edits ruin the page.
  await createVersion({
    projectId,
    html: finalHtml,
    label: "Pasted HTML",
    source: "initial",
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[from-html] initial version snapshot failed", err);
  });

  // Background card thumbnail so the pasted page shows a preview in /projects
  // instead of the placeholder icon. Fire-and-forget — never blocks the create.
  // Its Chromium blocks private and internal addresses
  // (`installSubresourceSsrfGuard`): the pasted JavaScript runs there too.
  void renderProjectThumbnail({ projectId, html: finalHtml });

  return { ok: true, projectId, title };
}
