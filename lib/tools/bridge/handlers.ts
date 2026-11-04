// WHAT THE BRIDGE'S SERVER ANSWERS (spec local 2026-11-04-herramientas-hechas-por-len, §4.4, §4.5, §4.12): the tool's
// own backend signed in as the person (the draft in its canvas, production once installed), the projects the
// person can open, and — the owner's only, like Len's own `resultados` — a project's form submissions, visits and
// read-only SQL on production. What needs the person's hand (`update`, `sendPrompt`) or the screen (`context`)
// is answered by the workspace, never here.
import "server-only";

import type { AccesoAlProyecto, RolEnProyecto } from "@/lib/projects/acceso";

import type { ToolInstallationRow } from "../store";
import { INVALID_PARAMS, type BridgeError } from "./protocol";

export type BridgeCaller = {
  readonly personId: string;
  readonly personEmail: string;
  readonly locale: string;
  readonly timeZone: string;
  /** Len's eyes only: the colours the tool is shown with (`dark: true`); the workspace sends its own. */
  readonly theme?: "light" | "dark";
} & ({ readonly mode: "draft"; readonly toolProjectId: string } | { readonly mode: "installed"; readonly installation: ToolInstallationRow });

export type ServerMethod = "backend" | "projects" | "forms" | "visits" | "query";
export const SERVER_METHODS: readonly ServerMethod[] = ["backend", "projects", "forms", "visits", "query"];

export interface HandlerDeps {
  backend(toolProjectId: string, environment: "draft" | "live", email: string): Promise<{ url: string; key: string; session: Record<string, unknown> } | null>;
  projects(personId: string): Promise<Array<{ id: string; title: string; role: RolEnProyecto }>>;
  access(projectId: string, personId: string): Promise<AccesoAlProyecto | Response>;
  forms(projectId: string, personId: string, timeZone: string, filter: { cuales: "fecha"; desde?: string; hasta?: string }): Promise<unknown>;
  visits(projectId: string, timeZone: string, range: { desde?: string; hasta?: string }): Promise<unknown>;
  query(projectId: string, sql: string): Promise<unknown>;
}

export async function realHandlerDeps(): Promise<HandlerDeps> {
  return {
    async backend(toolProjectId, environment, email) {
      const { backendConfigured } = await import("@/lib/backend/pg");
      if (!backendConfigured()) return null;
      const registry = await import("@/lib/backend/registry");
      const rec = await registry.getBackendByProject(toolProjectId);
      if (!rec) return null;
      let env;
      if (environment === "draft") env = await registry.ensureEnvironmentReady(rec, "draft");
      else {
        const { getEnvironment } = await import("@/lib/backend/environments");
        env = await getEnvironment(toolProjectId, "live");
        if (!env?.provisionedAt) return null;
      }
      const project = registry.backendProjectFor({ record: rec, pageSub: null }, env);
      const { signInForVisit } = await import("@/lib/backend/auth/visit-session");
      const signed = await signInForVisit(project, email, { createIfMissing: true });
      if (!signed.ok) return null;
      return { url: registry.projectUrl(rec.ref), key: project.publishableKey, session: signed.session };
    },
    async projects(personId) {
      const { visibleProjects } = await import("@/lib/projects/visible-projects");
      return (await visibleProjects(personId)).map((p) => ({ id: p.id, title: p.title, role: p.role }));
    },
    async access(projectId, personId) {
      const { exigirAcceso } = await import("@/lib/projects/acceso");
      return exigirAcceso(projectId, personId, "ver");
    },
    async forms(projectId, personId, timeZone, filter) {
      const { resumirFormularios } = await import("@/lib/resultados/formularios");
      return resumirFormularios(projectId, personId, timeZone, filter);
    },
    async visits(projectId, timeZone, range) {
      const { resumirVisitas } = await import("@/lib/resultados/visitas");
      return resumirVisitas(projectId, timeZone, range);
    },
    async query(projectId, sql) {
      const { queryBackendReadOnly } = await import("@/lib/backend/live-read");
      return queryBackendReadOnly(projectId, "live", sql);
    },
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const invalid = { error: { code: INVALID_PARAMS, message: "invalid_params" } };

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function day(v: unknown): string | undefined {
  return typeof v === "string" && DAY.test(v) ? v : undefined;
}

/** The tool's own project: where its backend lives. */
export function toolProjectOf(caller: BridgeCaller): string {
  return caller.mode === "draft" ? caller.toolProjectId : caller.installation.projectId;
}

/** A project the person reads through the tool: theirs only (a member gets owner_only, as Len's `resultados`). */
async function owned(projectId: string, caller: BridgeCaller, d: HandlerDeps): Promise<{ error: BridgeError } | null> {
  const a = await d.access(projectId, caller.personId);
  if (a instanceof Response) return { error: { code: 404, message: "not_found" } };
  if (a.rol !== "dueno") return { error: { code: 403, message: "owner_only" } };
  return null;
}

export async function handleBridgeCall(
  caller: BridgeCaller,
  method: ServerMethod,
  params: unknown,
  deps?: HandlerDeps,
): Promise<{ result: unknown } | { error: BridgeError }> {
  const d = deps ?? (await realHandlerDeps());
  const p = record(params);
  switch (method) {
    case "backend": {
      const b = await d.backend(toolProjectOf(caller), caller.mode === "draft" ? "draft" : "live", caller.personEmail);
      return b ? { result: b } : { error: { code: 404, message: "no_backend" } };
    }
    case "projects":
      return { result: await d.projects(caller.personId) };
    case "forms":
    case "visits":
    case "query": {
      const projectId = typeof p.projectId === "string" && p.projectId ? p.projectId : null;
      if (!projectId) return invalid;
      if (method === "query" && (typeof p.sql !== "string" || !p.sql.trim())) return invalid;
      const refused = await owned(projectId, caller, d);
      if (refused) return refused;
      if (method === "query") return { result: await d.query(projectId, p.sql as string) };
      if (method === "forms") {
        const since = day(p.since);
        const until = day(p.until);
        return { result: await d.forms(projectId, caller.personId, caller.timeZone, { cuales: "fecha", ...(since ? { desde: since } : {}), ...(until ? { hasta: until } : {}) }) };
      }
      const from = day(p.from);
      const to = day(p.to);
      return { result: await d.visits(projectId, caller.timeZone, { ...(from ? { desde: from } : {}), ...(to ? { hasta: to } : {}) }) };
    }
  }
}
