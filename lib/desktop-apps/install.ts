// «INSTALAR EN EL ESCRITORIO» (spec local 2026-11-26-apps-en-el-escritorio, §4.1, §4.2, §5, §6): an app of the person's
// is frozen as a release and opened in its own window, never published. The gates are the ones of a tool's install
// (`installThroughGates`: the security review 428, the build 422, the functions, the data changes to production 428,
// the deploy, the immutable release row) and then ONE row of `desktopApps` per person and project.
// Only the owner installs, for themself, on a paid plan. The row changes only when the gates pass: a gate that stops
// leaves the installed version exactly as it was (the window keeps running it).
import "server-only";

import { randomUUID } from "node:crypto";

import type { ProjectData } from "@/lib/projects/types";
import type { InstallDeps } from "@/lib/tools/install";
import { installThroughGates, type CoreDeps } from "@/lib/tools/install-core";

import { versionFingerprint, type LiveSecret } from "./fingerprint";
import { desktopAppName } from "./name";
import type { DesktopAppRow, upsertDesktopApp } from "./store";
import { toDesktopAppView } from "./view";

const LOG_TAG = "[desktop-apps]";

type Answer = { status: number; body: Record<string, unknown> };

/** The gates are `CoreDeps`; the plan, the access check and the files are a tool's install's own (`InstallDeps`, not restated:
 *  a change there reaches both installs). The rest is the desktop's. */
export interface DesktopDeps extends CoreDeps, Pick<InstallDeps, "plan" | "access" | "files"> {
  enabled(): boolean;
  /** The project's name (the window's), whether it has a published site, and its shell and app. */
  loadProject(projectId: string): Promise<{ title: string; subdomain: string | null; data: ProjectData } | null>;
  /** Stripe lives in the project (spec §5): a frozen release would carry test ids against the live key. */
  usesStripe(projectId: string): Promise<boolean>;
  /** The person's installation of a TOOL project (the rail's), removed, switched off or not. */
  toolInstallation(personId: string, projectId: string): Promise<{ id: string; iconPath: string; enabled: boolean; removedAt: Date | null } | null>;
  desktopAppOf(personId: string, projectId: string): Promise<DesktopAppRow | null>;
  /** Whether a release is still there (it can be cleaned up once nobody uses it): an install with nothing new needs it. */
  releaseExists(sha: string): Promise<boolean>;
  /** The production function secrets the install would deploy, as names and the digests the store keeps — part of the version
   *  (a rotated secret is a new one). 🔴 Never a value: there is no way to ask for one here. */
  liveSecrets(projectId: string): Promise<readonly LiveSecret[]>;
  /** The key those secrets are folded into the version with (an HMAC); null when the server has no secret to make it from. */
  versionKey(): string | null;
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

/** Why an install would be refused, for a person who is the owner of a project that exists: `plan_required` is the 402 and
 *  the rest are 409s, named by the answer's `error`. The owner's GET tells it before the tap (`blockedBy`). */
export type InstallBlock = "plan_required" | "not_an_app" | "uses_stripe" | "tool_not_installed";

type Checked =
  | { readonly blockedBy: Exclude<InstallBlock, "plan_required"> }
  | { readonly blockedBy: null; readonly app: NonNullable<ProjectData["app"]>; readonly tool: { readonly id: string; readonly iconPath: string } | null };

/** The checks of an install that depend on the project (the POST and the owner's GET ask the same ones, in this order, so
 *  what the read says is what the install does). Nothing here reviews, builds or deploys. */
async function checkProject(
  d: Pick<DesktopDeps, "usesStripe" | "toolInstallation">,
  i: { readonly projectId: string; readonly actorId: string },
  project: { readonly data: ProjectData },
): Promise<Checked> {
  const app = project.data.app;
  if (!app) return { blockedBy: "not_an_app" };
  if (await d.usesStripe(i.projectId)) return { blockedBy: "uses_stripe" };

  // A tool's window gets the bridge through the person's installation of it (spec §4.3): the row points at it.
  // Switching a tool off stops it everywhere, so a switched-off installation counts as not installed, like a removed one.
  let tool: { id: string; iconPath: string } | null = null;
  if (project.data.tool) {
    const installation = await d.toolInstallation(i.actorId, i.projectId);
    if (!installation || installation.removedAt || !installation.enabled) return { blockedBy: "tool_not_installed" };
    tool = installation;
  }
  return { blockedBy: null, app, tool };
}

/** THE VERSION of what an install would use right now: the files, the production public environment the build bakes in (`entorno`,
 *  what the gates give the build) and the production function secrets it deploys — Claude's `ver` bumps with ANY change to what
 *  the installed thing runs. Never throws, and a read that fails is a version NOTHING matches (so the update is offered, and an
 *  install never takes the «nothing new» shortcut), never a version that looks unchanged. */
async function currentVersion(d: DesktopDeps, projectId: string, html: string, files: Record<string, string>): Promise<string> {
  try {
    const key = d.versionKey();
    if (!key) throw new Error("the server has no secret to fold the function secrets into the version with");
    const [env, secrets] = await Promise.all([d.entorno(projectId), d.liveSecrets(projectId)]);
    return versionFingerprint({ html, files, env, secrets, key });
  } catch (err) {
    console.warn(`${LOG_TAG} could not read what an install uses, so its version is not told and an update is offered:`, err);
    return `unreadable:${randomUUID()}`;
  }
}

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
    /** The window's «Actualizar» (it only ever updates): an app that is no longer on the desktop is not installed again. */
    readonly fromWindow?: boolean;
  },
  deps?: DesktopDeps,
): Promise<Answer> {
  const d = await depsOrReal(deps);
  if (!d.enabled()) return { status: 404, body: { error: "desktop_apps_off" } };
  if ((await d.plan(i.actorId)) === "free") return { status: 402, body: { error: "plan_required" } };
  const access = await d.access(i.projectId, i.actorId);
  if (access instanceof Response) return { status: access.status, body: (await access.json().catch(() => ({}))) as Record<string, unknown> };
  if (access.rol !== "dueno") return { status: 403, body: { error: "owner_only" } };

  const installed = await d.desktopAppOf(i.actorId, i.projectId);
  // Claude reconciles with what is installed before it acts and closes a window when its app is uninstalled, so a window
  // left open after a removal elsewhere cannot exist there. Here it can, and its button must not undo the removal.
  if (i.fromWindow && (!installed || installed.removedAt)) return { status: 409, body: { error: "desktop_app_removed" } };

  const project = await d.loadProject(i.projectId);
  if (!project) return { status: 409, body: { error: "not_an_app" } };
  const checked = await checkProject(d, i, project);
  if (checked.blockedBy !== null) return { status: 409, body: { error: checked.blockedBy } };
  const { app, tool } = checked;

  const files = await d.files(i.projectId);
  const fingerprint = await currentVersion(d, i.projectId, project.data.html, files);
  // What the person sees for the project, in their language (never the raw «Untitled page» of one that was never named).
  const name = await desktopAppName(project.title, i.locale);

  // Claude has no «update» when nothing changed: its content is live and identical bytes are skipped. An install of an app
  // that is on the desktop, whose version (files, production environment, function secrets) is the installed one and whose
  // release is still there, is that same row — there is nothing new to review, build or deploy. A new name or a different
  // tool installation is something to update.
  if (
    installed &&
    !installed.removedAt &&
    installed.filesFingerprint === fingerprint &&
    installed.name === name &&
    installed.toolInstallationId === (tool?.id ?? null) &&
    installed.iconPath === (tool?.iconPath ?? null) &&
    (await d.releaseExists(installed.releaseSha))
  ) {
    return { status: 200, body: { desktopApp: toDesktopAppView(installed), published: project.subdomain !== null } };
  }

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
      // The row is saved BEFORE the security review's base moves (Claude's order: save the list, undo on failure): a row that
      // fails to save leaves the base on what was there, not on a version nobody has installed.
      save: (release) =>
        d.upsertDesktopApp({
          personId: i.actorId,
          projectId: i.projectId,
          releaseSha: release.sha,
          name,
          iconPath: tool?.iconPath ?? null,
          toolInstallationId: tool?.id ?? null,
          // Of what was BUILT, not of what is there now: a file, a variable or a secret saved during the build is an update waiting.
          filesFingerprint: fingerprint,
          hostLabelFor: d.hostLabelFor,
        }),
    },
    d,
  );
  if (!core.ok) return { status: core.status, body: core.body };
  return { status: 200, body: { desktopApp: toDesktopAppView(core.row), published: project.subdomain !== null } };
}

/** The GET (spec §4.4): what is installed for the person, whether the project's files moved on since, and whether an install
 *  would work right now (`canInstall`; `blockedBy` says what refuses it, with the install's own predicates and none of its
 *  gates), so the menu can say it before the tap. Only the owner's: anyone else gets a 404, as if the project were not there. */
export async function desktopAppState(i: { readonly projectId: string; readonly actorId: string }, deps?: DesktopDeps): Promise<Answer> {
  const d = await depsOrReal(deps);
  if (!d.enabled()) return { status: 404, body: { error: "desktop_apps_off" } };
  const access = await d.access(i.projectId, i.actorId);
  if (access instanceof Response || access.rol !== "dueno") return notFound();
  const project = await d.loadProject(i.projectId);
  if (!project) return notFound();

  const published = project.subdomain !== null;
  const blockedBy: InstallBlock | null = (await d.plan(i.actorId)) === "free" ? "plan_required" : (await checkProject(d, i, project)).blockedBy;
  const verdict = { canInstall: blockedBy === null, blockedBy };
  const row = await d.desktopAppOf(i.actorId, i.projectId);
  if (!row || row.removedAt) return { status: 200, body: { desktopApp: null, updateAvailable: false, published, ...verdict } };
  const current = await currentVersion(d, i.projectId, project.data.html, await d.files(i.projectId));
  return { status: 200, body: { desktopApp: toDesktopAppView(row), updateAvailable: current !== row.filesFingerprint, published, ...verdict } };
}

/** The GET `?for=publish` (spec §5): the publish dialog warns that the site and the desktop app share their production data,
 *  and whoever can publish needs to hear it — an editor's publish migrates the production database the OWNER's frozen
 *  release uses. So this one answers anyone with edit access, and only `installed`: a boolean, nothing about whose. No access
 *  is a 404 like the owner's GET (a reader doesn't publish); with the switch off nobody has anything installed. */
export async function desktopInstalledForPublish(i: { readonly projectId: string; readonly actorId: string }, deps?: DesktopDeps): Promise<Answer> {
  const d = await depsOrReal(deps);
  if (!d.enabled()) return { status: 200, body: { installed: false } };
  const access = await d.access(i.projectId, i.actorId);
  // A reader doesn't publish: the real `access` asks for edit permission and refuses one with a 403, but the answer must not
  // depend on which permission a dependency happened to ask for.
  if (access instanceof Response || access.rol === "lector") return notFound();
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
