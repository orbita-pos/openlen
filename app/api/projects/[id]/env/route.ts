import { and, eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { exigirAcceso } from "@/lib/projects/acceso";
import { platformEnv } from "@/lib/apps/entorno";
import { dotEnvPublicVars } from "@/lib/apps/env/dotenv";
import { envVersionOf } from "@/lib/apps/env/hash";
import { DOTENV_PATH, ENV_TARGETS, parseEnvVarsBody } from "@/lib/apps/env/rules";
import { listEnvVars, replaceEnvVars, type EnvVarRow } from "@/lib/apps/env/store";
import { listProjectFiles } from "@/lib/backend/files";

// ─────────────────────────────────────────────────────────────────────────────
// /api/projects/[id]/env — LAS VARIABLES DE ENTORNO DE UNA APP (spec local
// docs/superpowers/specs/2026-10-10-variables-de-entorno-design.md).
//
//   GET  (ver: dueño, editor, lector) → las del ajuste, las de `/.env` y las de
//        OpenLen, con la versión para el PUT y si la publicada va atrasada.
//   PUT  (editar: dueño y editor) → la lista ENTERA de una vez. Con una versión
//        vieja, 409 y la lista de ahora: el diálogo no pisa lo que otro guardó.
//
// Sólo en apps: una página no tiene `import.meta.env` que leer. Todo es
// PÚBLICO: un lector puede ver los valores, que ya van en el JavaScript servido.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

interface ProjectRow {
  readonly data: { readonly app?: unknown } | null;
  readonly subdomain: string | null;
  readonly publishedAt: Date | null;
  readonly envHash: string | null;
  readonly publishedEnvHash: string | null;
}

async function loadProject(id: string, ownerId: string): Promise<ProjectRow | null> {
  const [row] = await db
    .select({
      data: schema.projects.data,
      subdomain: schema.projects.subdomain,
      publishedAt: schema.projects.publishedAt,
      envHash: schema.projects.envHash,
      publishedEnvHash: schema.projects.publishedEnvHash,
    })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, ownerId)))
    .limit(1);
  return row ?? null;
}

async function envState(id: string, project: ProjectRow, vars: readonly EnvVarRow[]) {
  const [files, platform] = await Promise.all([listProjectFiles(id, DOTENV_PATH), platformEnv(id)]);
  const dotEnv = files[DOTENV_PATH];
  const published = project.subdomain !== null && project.publishedAt !== null;
  return {
    vars: vars.map((v) => ({ name: v.name, target: v.target, value: v.value, updatedAt: v.updatedAt.toISOString() })),
    fromFile: Object.entries(dotEnv === undefined ? {} : dotEnvPublicVars(dotEnv)).map(([name, value]) => ({
      name,
      value,
      overridden: ENV_TARGETS.filter((target) => vars.some((v) => v.name === name && v.target === target)),
    })),
    platform: Object.entries(platform).map(([name, value]) => ({ name, value })),
    version: envVersionOf(vars),
    published,
    pendingPublish: published && (project.envHash ?? null) !== (project.publishedEnvHash ?? null),
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const acceso = await exigirAcceso(id, session.user.id, "ver");
  if (acceso instanceof Response) return acceso;
  const project = await loadProject(id, acceso.duenoId);
  if (!project) return json({ error: "not_found" }, 404);
  if (!project.data?.app) return json({ error: "not_an_app" }, 400);
  return json(await envState(id, project, await listEnvVars(id)), 200);
}

export async function PUT(req: Request, { params }: Ctx): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const acceso = await exigirAcceso(id, session.user.id, "editar");
  if (acceso instanceof Response) return acceso;
  const body = parseEnvVarsBody(await req.json().catch(() => null));
  if (!body) return json({ error: "invalid_body" }, 400);
  const project = await loadProject(id, acceso.duenoId);
  if (!project) return json({ error: "not_found" }, 404);
  if (!project.data?.app) return json({ error: "not_an_app" }, 400);

  const r = await replaceEnvVars({ projectId: id, ownerId: acceso.duenoId, userId: session.user.id, version: body.version, vars: body.vars });
  if (!r.ok) {
    if (r.reason === "not_found") return json({ error: "not_found" }, 404);
    if (r.reason === "invalid") return json({ error: "invalid", problems: r.problems }, 400);
    return json({ error: "conflict", ...(await envState(id, project, r.vars)) }, 409);
  }
  // `envHash` acaba de cambiar: «publica de nuevo» se lee de la fila de ahora.
  return json(await envState(id, (await loadProject(id, acceso.duenoId)) ?? project, r.vars), 200);
}
