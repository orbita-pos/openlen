// WHO IS ASKING THROUGH THE BRIDGE (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, §4.12): the workspace
// relays a tool's request with the person's session and names either the installed tool (only its own person,
// switched on, not removed) or the tool project whose canvas runs it in draft mode (whoever can edit it). Paid
// plans only (§4.13). Nothing here comes from the frame: the frame holds no credentials.
import "server-only";

import type { Plan } from "@/lib/plan";
import type { AccesoAlProyecto } from "@/lib/projects/acceso";

import type { ToolInstallationRow } from "../store";
import type { BridgeCaller } from "./handlers";

export interface CallerDeps {
  enabled(): boolean;
  plan(userId: string): Promise<Plan>;
  email(userId: string): Promise<string | null>;
  installationById(id: string): Promise<ToolInstallationRow | null>;
  access(projectId: string, userId: string): Promise<AccesoAlProyecto | Response>;
  projectIsTool(projectId: string): Promise<boolean>;
}

export async function realCallerDeps(): Promise<CallerDeps> {
  const [{ toolsEnabled }, limits, store, acceso, dbm, { eq }] = await Promise.all([
    import("../enabled"),
    import("@/lib/limits"),
    import("../store"),
    import("@/lib/projects/acceso"),
    import("@/lib/db"),
    import("drizzle-orm"),
  ]);
  return {
    enabled: () => toolsEnabled(),
    plan: (u) => limits.getUserPlan(u),
    email: async (u) => {
      const [row] = await dbm.db.select({ email: dbm.schema.users.email }).from(dbm.schema.users).where(eq(dbm.schema.users.id, u)).limit(1);
      return row?.email ?? null;
    },
    installationById: (id) => store.installationById(id),
    access: (p, u) => acceso.exigirAcceso(p, u, "editar"),
    projectIsTool: async (p) => {
      const [row] = await dbm.db.select({ data: dbm.schema.projects.data }).from(dbm.schema.projects).where(eq(dbm.schema.projects.id, p)).limit(1);
      return !!(row?.data as { tool?: unknown } | undefined)?.tool;
    },
  };
}

function validTimeZone(v: unknown): string {
  if (typeof v !== "string" || !v) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return v;
  } catch {
    return "UTC";
  }
}

type Failure = { status: number; body: Record<string, unknown> };
const notFound: Failure = { status: 404, body: { error: "not_found" } };

export async function resolveBridgeCaller(
  userId: string,
  body: { readonly installationId?: unknown; readonly draftProjectId?: unknown; readonly timeZone?: unknown; readonly locale?: unknown },
  deps?: CallerDeps,
): Promise<{ caller: BridgeCaller } | Failure> {
  const d = deps ?? (await realCallerDeps());
  if (!d.enabled()) return { status: 404, body: { error: "tools_off" } };
  const installationId = typeof body.installationId === "string" && body.installationId ? body.installationId : null;
  const draftProjectId = typeof body.draftProjectId === "string" && body.draftProjectId ? body.draftProjectId : null;
  if (!installationId && !draftProjectId) return { status: 400, body: { error: "invalid" } };
  if ((await d.plan(userId)) === "free") return { status: 402, body: { error: "plan_required" } };
  const email = await d.email(userId);
  if (!email) return { status: 401, body: { error: "unauthorized" } };
  const base = {
    personId: userId,
    personEmail: email,
    locale: typeof body.locale === "string" && /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(body.locale) ? body.locale : "en",
    timeZone: validTimeZone(body.timeZone),
  };
  if (installationId) {
    const row = await d.installationById(installationId);
    if (!row || row.personId !== userId || !row.enabled || row.removedAt) return notFound;
    return { caller: { ...base, mode: "installed", installation: row } };
  }
  const access = await d.access(draftProjectId!, userId);
  if (access instanceof Response || !(await d.projectIsTool(draftProjectId!))) return notFound;
  return { caller: { ...base, mode: "draft", toolProjectId: draftProjectId! } };
}
