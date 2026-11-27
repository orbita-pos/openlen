// «INSTALAR EN EL ESCRITORIO» (spec local 2026-11-26-apps-en-el-escritorio, §4.1, §4.2, §5, §6): an app of the person's
// is frozen as a release and opened in its own window, never published. The gates are the ones of a tool's install
// (`installThroughGates`: the security review 428, the build 422, the functions, the data changes to production 428,
// the deploy, the immutable release row) and then ONE row of `desktopApps` per person and project.
// Only the owner installs, for themself, on a paid plan. The row changes only when the gates pass: a gate that stops
// leaves the installed version exactly as it was (the window keeps running it).
import "server-only";

import type { Plan } from "@/lib/plan";
import type { AccesoAlProyecto } from "@/lib/projects/acceso";
import type { ProjectData } from "@/lib/projects/types";
import { installErrorResult, installThroughGates, type CoreDeps } from "@/lib/tools/install-core";

import { filesFingerprint } from "./fingerprint";
import type { DesktopAppRow, upsertDesktopApp } from "./store";
import { toDesktopAppView } from "./view";

const LOG_TAG = "[desktop-apps]";

type Answer = { status: number; body: Record<string, unknown> };

export interface DesktopDeps extends CoreDeps {
  enabled(): boolean;
  plan(userId: string): Promise<Plan>;
  access(projectId: string, userId: string): Promise<AccesoAlProyecto | Response>;
  /** The project's name (the window's), whether it has a published site, and its shell and app. */
  loadProject(projectId: string): Promise<{ title: string; subdomain: string | null; data: ProjectData } | null>;
  files(projectId: string): Promise<Record<string, string>>;
  /** Stripe lives in the project (spec §5): a frozen release would carry test ids against the live key. */
  usesStripe(projectId: string): Promise<boolean>;
  /** The person's installation of a TOOL project (the rail's), removed, switched off or not. */
  toolInstallation(personId: string, projectId: string): Promise<{ id: string; iconPath: string; enabled: boolean; removedAt: Date | null } | null>;
  desktopAppOf(personId: string, projectId: string): Promise<DesktopAppRow | null>;
  /** Whether ANYONE has the project on their desktop, not removed (only the owner can, today): publishing warns. */
  hasActiveDesktopApp(projectId: string): Promise<boolean>;
  upsertDesktopApp(i: Parameters<typeof upsertDesktopApp>[0]): Promise<DesktopAppRow>;
  markRemoved(id: string, personId: string): Promise<boolean>;
  /** The private host's label for a new row's id. 🔴 Throws without a secret: a row never gets an empty label. */
  hostLabelFor(id: string): string;
}

async function depsOrReal(deps: DesktopDeps | undefined): Promise<DesktopDeps> {
  if (deps) return deps;
  const { realDesktopDeps } = await import("./deps");
  return realDesktopDeps();
}

const notFound = (): Answer => ({ status: 404, body: { error: "not_found" } });

export async function installDesktopApp(
  i: {
    readonly projectId: string;
    readonly actorId: string;
    readonly locale: string;
    readonly requestHost: string | null;
    readonly acceptSecurityFingerprint?: string;
    readonly confirmFingerprint?: string;
    readonly copyDraftData?: boolean;
    readonly skipMissingSecrets?: boolean;
  },
  deps?: DesktopDeps,
): Promise<Answer> {
  const d = await depsOrReal(deps);
  if (!d.enabled()) return { status: 404, body: { error: "desktop_apps_off" } };
  if ((await d.plan(i.actorId)) === "free") return { status: 402, body: { error: "plan_required" } };
  const access = await d.access(i.projectId, i.actorId);
  if (access instanceof Response) return { status: access.status, body: (await access.json().catch(() => ({}))) as Record<string, unknown> };
  if (access.rol !== "dueno") return { status: 403, body: { error: "owner_only" } };

  const project = await d.loadProject(i.projectId);
  const app = project?.data.app;
  if (!project || !app) return { status: 409, body: { error: "not_an_app" } };
  if (await d.usesStripe(i.projectId)) return { status: 409, body: { error: "uses_stripe" } };

  // A tool's window gets the bridge through the person's installation of it (spec §4.3): the row points at it.
  // Switching a tool off stops it everywhere, so a switched-off installation counts as not installed, like a removed one.
  let tool: { id: string; iconPath: string } | null = null;
  if (project.data.tool) {
    const installation = await d.toolInstallation(i.actorId, i.projectId);
    if (!installation || installation.removedAt || !installation.enabled) return { status: 409, body: { error: "tool_not_installed" } };
    tool = installation;
  }

  const files = await d.files(i.projectId);
  const core = await installThroughGates(
    {
      projectId: i.projectId,
      actorId: i.actorId,
      locale: i.locale,
      html: project.data.html,
      files,
      app,
      // A plain app has no icon of its own (OpenLen draws one from the name): no file is named, none is added.
      iconPath: tool?.iconPath ?? "",
      ...(i.acceptSecurityFingerprint ? { acceptSecurityFingerprint: i.acceptSecurityFingerprint } : {}),
      ...(i.confirmFingerprint ? { confirmFingerprint: i.confirmFingerprint } : {}),
      ...(i.copyDraftData !== undefined ? { copyDraftData: i.copyDraftData } : {}),
      ...(i.skipMissingSecrets !== undefined ? { skipMissingSecrets: i.skipMissingSecrets } : {}),
      logTag: LOG_TAG,
    },
    d,
  );
  if (!core.ok) return { status: core.status, body: core.body };

  try {
    const row = await d.upsertDesktopApp({
      personId: i.actorId,
      projectId: i.projectId,
      releaseSha: core.releaseSha,
      name: project.title,
      iconPath: tool?.iconPath ?? null,
      toolInstallationId: tool?.id ?? null,
      // Of what was BUILT, not of what is there now: a file saved during the build is an update waiting.
      filesFingerprint: filesFingerprint(project.data.html, files),
      hostLabelFor: d.hostLabelFor,
    });
    return { status: 200, body: { desktopApp: toDesktopAppView(row), published: project.subdomain !== null } };
  } catch (err) {
    return installErrorResult(err, LOG_TAG);
  }
}

/** The GET (spec §4.4): what is installed for the person, and whether the project's files moved on since. Only the
 *  owner's: anyone else gets a 404, as if the project were not there. */
export async function desktopAppState(i: { readonly projectId: string; readonly actorId: string }, deps?: DesktopDeps): Promise<Answer> {
  const d = await depsOrReal(deps);
  if (!d.enabled()) return { status: 404, body: { error: "desktop_apps_off" } };
  const access = await d.access(i.projectId, i.actorId);
  if (access instanceof Response || access.rol !== "dueno") return notFound();
  const project = await d.loadProject(i.projectId);
  if (!project) return notFound();

  const published = project.subdomain !== null;
  const row = await d.desktopAppOf(i.actorId, i.projectId);
  if (!row || row.removedAt) return { status: 200, body: { desktopApp: null, updateAvailable: false, published } };
  const current = filesFingerprint(project.data.html, await d.files(i.projectId));
  return { status: 200, body: { desktopApp: toDesktopAppView(row), updateAvailable: current !== row.filesFingerprint, published } };
}

/** The GET `?for=publish` (spec §5): the publish dialog warns that the site and the desktop app share their production data,
 *  and whoever can publish needs to hear it — an editor's publish migrates the production database the OWNER's frozen
 *  release uses. So this one answers anyone with edit access, and only `installed`: a boolean, nothing about whose. No access
 *  is a 404 like the owner's GET (a reader doesn't publish); with the switch off nobody has anything installed. */
export async function desktopInstalledForPublish(i: { readonly projectId: string; readonly actorId: string }, deps?: DesktopDeps): Promise<Answer> {
  const d = await depsOrReal(deps);
  if (!d.enabled()) return { status: 200, body: { installed: false } };
  const access = await d.access(i.projectId, i.actorId);
  if (access instanceof Response) return notFound();
  return { status: 200, body: { installed: await d.hasActiveDesktopApp(i.projectId) } };
}

/** The DELETE, «Quitar del escritorio» (spec §4.6): the row stays, marked, so the window can say the app is gone. */
export async function removeDesktopApp(i: { readonly projectId: string; readonly actorId: string }, deps?: DesktopDeps): Promise<Answer> {
  const d = await depsOrReal(deps);
  if (!d.enabled()) return { status: 404, body: { error: "desktop_apps_off" } };
  const access = await d.access(i.projectId, i.actorId);
  if (access instanceof Response || access.rol !== "dueno") return notFound();
  const row = await d.desktopAppOf(i.actorId, i.projectId);
  if (!row) return { status: 200, body: { removed: false } };
  return { status: 200, body: { removed: await d.markRemoved(row.id, i.actorId) } };
}
