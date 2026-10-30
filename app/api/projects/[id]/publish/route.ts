import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { exigirAcceso } from "@/lib/projects/acceso";
import { publishThroughGates } from "@/lib/projects/publish-through-gates";
import { auth } from "@/auth";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { ProjectNotFoundError, unpublishProject } from "@/lib/projects";

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
//   422 functions_do_not_compile — the Edge Functions don't compile for production;
//                      `errors` lists file:line — message (spec local 2026-10-11)
//   428 secrets_required — a literal Deno.env.get("…") has no production value;
//                      `missing` names them; resend with `skipMissingSecrets`
//   502 functions_deploy_failed — production functions couldn't be deployed;
//                      the release wasn't switched
//   503 functions_bundler_unavailable — the functions bundler didn't answer
//   428 confirmation_required — the publish would delete real data; `destructive`
//                      lists it and the client resends with `confirmFingerprint`
//   428 security_findings — the security review found HIGH problems nobody
//                      accepted: `blocking`, `medium`, `accepted`, `fingerprint`
//                      and `status`; resend with `acceptSecurityFingerprint`
//                      («Publicar igual», spec local 2026-10-15)
//   422 stripe_account_mismatch — the production Stripe key is from another
//                      account than the draft's (spec local 2026-10-21-stripe-integration)
//   502 stripe_sync_failed — copying to Stripe's live mode failed; the release
//                      wasn't switched (what was copied stays, for next time)
//   428 security_review_pending — the review is still running: `fingerprint`;
//                      wait for it (GET …/security-review) and resend
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
  /** «Publicar igual» aunque falten secretos de las funciones (428). */
  skipMissingSecrets: z.boolean().optional(),
  /** «Publicar igual» con hallazgos de seguridad (428): la huella de la revisión aceptada. */
  acceptSecurityFingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /** El idioma de quien publica: el de los textos de la revisión si arranca aquí. */
  locale: z.string().min(2).max(10).optional(),
  /** «Publicar igual» sin el arreglo de Len Watch que el borrador aún no tiene (428 len_watch_fix_pending). */
  acceptLenWatchFix: z.string().min(1).max(64).optional(),
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

  // The gates (security review, data, functions, Stripe) and their codes live in one function, shared
  // with Len Watch (lib/projects/publish-through-gates.ts).
  const r = await publishThroughGates({
    projectId: id,
    actorId: userId,
    ownerId: acceso.duenoId,
    subdomain: parsed.data.subdomain,
    languages: parsed.data.languages,
    confirmFingerprint: parsed.data.confirmFingerprint,
    copyDraftData: parsed.data.copyDraftData,
    skipMissingSecrets: parsed.data.skipMissingSecrets,
    acceptSecurityFingerprint: parsed.data.acceptSecurityFingerprint,
    locale: parsed.data.locale,
    ...(parsed.data.acceptLenWatchFix ? { acceptLenWatchFix: parsed.data.acceptLenWatchFix } : {}),
    source: "person",
  });
  return json(r.body, r.status);
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
