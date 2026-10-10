import { z } from "zod";
import { eq } from "drizzle-orm";
import { AppNoCompilaError, textoDeDiagnostico } from "@/lib/apps/compilador";
import { dataChangesErrorBody } from "@/lib/backend/data-changes";
import { db, schema } from "@/lib/db";
import { exigirAcceso } from "@/lib/projects/acceso";
import { conAutor } from "@/lib/projects/autor-del-cambio";
import { auth } from "@/auth";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import {
  ProjectNotFoundError,
  publishProject,
  SubdomainInvalidError,
  SubdomainLimitError,
  SubdomainTakenError,
  unpublishProject,
} from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// POST   /api/projects/[id]/publish  → claim a subdomain + publish.
// DELETE /api/projects/[id]/publish  → release the subdomain + take it down.
//
// HTTP status map (kept tight on purpose — the UI matches on these):
//   400 invalid       — subdomain regex/length/xn--/pure-numeric fail
//   400 reserved      — subdomain in the reserved list
//   402 limit_reached — tier cap on active subdomains hit
//   403 forbidden     — caller doesn't own the project (also used when the
//                      project exists but belongs to someone else)
//   404 not_found     — project id doesn't exist for this user
//   409 taken         — another row already claims this subdomain
//   422 app_does_not_compile — an app web whose code does not compile; `errors`
//                      lists file:line — message (spec local 2026-10-07-apps)
//   422 migration_failed — a migration from the test database fails on production;
//                      nothing was applied and the release wasn't switched
//                      (spec local 2026-10-09-borrador-y-produccion-de-datos)
//   422 migrations_diverged — production has migrations the test database lacks
//   428 confirmation_required — the publish would delete real data; `destructive`
//                      lists it and the client resends with `confirmFingerprint`
//   500 error         — disk write or DB error after validation passed
// ─────────────────────────────────────────────────────────────────────────────

const PublishBodySchema = z.object({
  subdomain: z.string().min(1).max(63),
  /** Speak Every Language targets — persisted to the project's settings.
   *  Omitted = keep the stored setting; [] = turn translations off. */
  languages: z.array(z.string().min(2).max(5)).max(9).optional(),
  /** La huella de los cambios destructivos que el dueño confirmó (428). */
  confirmFingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /** Primera publicación: producción nace como copia del borrador. */
  copyDraftData: z.boolean().optional(),
});

export const POST = paraLaApp(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  // Publican el dueño y los editores (lib/projects/acceso.ts)…
  const acceso = await exigirAcceso(id, userId, "editar");
  if (acceso instanceof Response) return acceso;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = PublishBodySchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid input" },
      400,
    );
  }
  // …pero la DIRECCIÓN la elige el dueño: un editor sólo vuelve a publicar
  // en la que ya tiene el proyecto (reclamar otra cuenta contra su plan).
  if (acceso.rol !== "dueno") {
    const [p] = await db.select({ subdomain: schema.projects.subdomain }).from(schema.projects).where(eq(schema.projects.id, id)).limit(1);
    if (!p?.subdomain || p.subdomain !== parsed.data.subdomain) return json({ error: "solo_dueno_direccion" }, 403);
  }

  try {
    // La versión «Publicado» lleva el nombre de quien publicó (lib/projects/autor-del-cambio.ts).
    const result = await conAutor(userId, () => publishProject({
      projectId: id,
      userId: acceso.duenoId,
      subdomain: parsed.data.subdomain,
      languages: parsed.data.languages,
      dataChanges: { mode: "owner", confirmFingerprint: parsed.data.confirmFingerprint, copyDraftData: parsed.data.copyDraftData },
    }));
    return json(result, 200);
  } catch (err) {
    if (err instanceof SubdomainInvalidError) {
      return json({ error: err.reason }, 400);
    }
    if (err instanceof SubdomainTakenError) {
      return json({ error: "taken" }, 409);
    }
    if (err instanceof SubdomainLimitError) {
      return json({ error: "limit_reached", limit: err.limit }, 402);
    }
    if (err instanceof ProjectNotFoundError) {
      return json({ error: "not_found" }, 404);
    }
    // Una app web que no compila no se publica (spec local 2026-10-07-apps):
    // se dice qué fichero y qué línea, para el dueño y para Len.
    if (err instanceof AppNoCompilaError) {
      return json({ error: "app_does_not_compile", errors: err.errores.map(textoDeDiagnostico) }, 422);
    }
    // Los datos (spec local 2026-10-09): una migración que falla en producción,
    // o lo destructivo sin confirmar.
    const dataError = dataChangesErrorBody(err);
    if (dataError) return json(dataError.body, dataError.status);
    // eslint-disable-next-line no-console
    console.error("[publish] unexpected error:", err);
    return json({ error: "publish_failed" }, 500);
  }
});

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;

  try {
    await unpublishProject({
      projectId: id,
      userId: session.user.id,
    });
    return json({ ok: true }, 200);
  } catch (err) {
    if (err instanceof ProjectNotFoundError) {
      return json({ error: "not_found" }, 404);
    }
    // eslint-disable-next-line no-console
    console.error("[unpublish] unexpected error:", err);
    return json({ error: "unpublish_failed" }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const OPTIONS = respuestaPrevia;
