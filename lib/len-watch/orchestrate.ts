// LEN WATCH'S ORCHESTRATOR (spec local 2026-10-30-len-watch, §5.3–§5.8): what happens once a crash is
// confirmed. The owner's switches decide how far it goes on its own:
//
//   open ──(fix on its own, or «Fix with Len»)──▶ fixing ──Len replies──▶ the site loads again by itself? recovered
//                                                    │                     Len changed nothing?          needs_owner
//                                                    │                     publish on its own, nothing   publish → loads? fixed
//                                                    │                       of the owner's half done?            → still down? fix_failed
//                                                    │                     otherwise                     fix_ready (Approve)
//                                                    └──turn fails──▶ needs_owner (with the reason)
//
// 🔴 Only `onIncidentOpened` starts a turn on its own, once per incident. After `fix_failed` nothing
// starts by itself: arreglar → publicar → sigue caída → arreglar… would empty the owner's credits at
// 3 a.m. Publishing goes through the same gates as a person (lib/projects/publish-through-gates.ts):
// any 428 stops it and leaves Approve. Never a rollback.
import "server-only";

import { createHash } from "node:crypto";

import type { FalloDelTurno, launchLenWatchTurn } from "@/lib/agent/turnos-desde-el-servidor";
import type { LenWatchEvent, LenWatchPhase } from "@/lib/notifications/types";
import type { GatedPublishInput, GatedPublishResult } from "@/lib/projects/publish-through-gates";

import type { LoadCheck } from "./check";
import { watchFraming } from "./framing";
import { noticeFor, noticeKey, pageUrl, type ProjectForWatch } from "./owner";
import type { Incident, LenWatchSettings, Resolution } from "./types";

const MAX_SUMMARY = 1_000;

export interface OrchestratorDeps {
  store: {
    getSettings(projectId: string): Promise<LenWatchSettings>;
    activeIncident(projectId: string): Promise<Incident | null>;
    incidentById(id: string): Promise<Incident | null>;
    updateIncident(id: string, patch: Partial<Pick<Incident, "summary" | "reason" | "shipsUnpublished" | "turnRowId" | "fixStamp">> & { status?: Exclude<Incident["status"], "resolved"> }): Promise<void>;
    resolveIncident(id: string, resolution: Resolution): Promise<void>;
  };
  project(projectId: string): Promise<ProjectForWatch | null>;
  check(url: string): Promise<LoadCheck>;
  notify(event: LenWatchEvent, dedupeKey: string): Promise<void>;
  launch: typeof launchLenWatchTurn;
  publish(i: GatedPublishInput): Promise<GatedPublishResult>;
  hasUnpublished(projectId: string, ownerId: string): Promise<boolean>;
  contentStamp(projectId: string): Promise<string>;
  /** Why the turn didn't reply, in the owner's language. */
  failPhrase(locale: string, fallo: FalloDelTurno | null): string;
  /** What the chat row shows as the message of a Len Watch turn, in the owner's language. */
  turnPrompt(locale: string): string;
  /** That Len's turn was cut (a restart, a crash), in the owner's language. */
  interruptedPhrase(locale: string): string;
  /** A Len turn is running in the project right now (this process). */
  liveTurn(projectId: string): boolean;
  now(): number;
  newId(): string;
}

/** Past the queue's longest wait (30 min) with no live turn, a fix still marked as running was cut. */
export const STALE_FIX_MS = 35 * 60_000;

/** A fix or publish cut by a restart would leave the incident «fixing» forever and Len Watch blocked
 *  on the project: once it's clearly dead, it goes back to the owner, who hears why. */
export async function recoverIfStale(i: Incident, deps?: OrchestratorDeps): Promise<Incident> {
  if (i.status !== "fixing" && i.status !== "publishing") return i;
  const d = deps ?? (await defaultDeps());
  if (d.now() - i.updatedAt.getTime() < STALE_FIX_MS || d.liveTurn(i.projectId)) return i;
  const next: Incident = { ...i, status: "needs_owner", reason: "interrupted" };
  await d.store.updateIncident(i.id, { status: "needs_owner", reason: "interrupted" });
  const p = await d.project(i.projectId);
  if (p) await tell(d, p, next, "needs_owner", d.interruptedPhrase(p.locale));
  return next;
}

async function tell(deps: OrchestratorDeps, p: ProjectForWatch, i: Incident, phase: LenWatchPhase, detail: string | null = null): Promise<void> {
  const event = noticeFor(p, i, phase, detail);
  await deps.notify(event, noticeKey(event));
}

/** A crash was confirmed. With «fix on its own», Len starts now; otherwise the owner hears it's down. */
export async function onIncidentOpened(i: Incident, p: ProjectForWatch, check: LoadCheck, deps?: OrchestratorDeps): Promise<void> {
  const d = deps ?? (await defaultDeps());
  if ((await d.store.getSettings(p.projectId)).autoFix) await startFix(i, p, d, { check });
  else await tell(d, p, i, "down");
}

/** Len starts on the crash. From «Fix with Len» it checks first: a site that loads again needs no turn
 *  and costs no credits. The turn is WHOEVER pressed it (`actorId`): an editor's counts against the
 *  members' monthly cap and the owner pays, as any Len turn of a member; on its own, it's the owner's. */
export async function startFix(i: Incident, p: ProjectForWatch, deps?: OrchestratorDeps, o: { check?: LoadCheck; actorId?: string } = {}): Promise<void> {
  const d = deps ?? (await defaultDeps());
  const url = pageUrl(p, i.sample.page);
  const now = o.check ?? (await d.check(url));
  if (now.loads) {
    await d.store.resolveIncident(i.id, "recovered");
    await tell(d, p, i, "recovered");
    return;
  }
  const before = { stamp: await d.contentStamp(p.projectId), hadUnpublished: await d.hasUnpublished(p.projectId, p.ownerId) };
  const filaId = d.newId();
  await d.store.updateIncident(i.id, { status: "fixing", turnRowId: filaId, reason: null });
  await tell(d, p, i, "fixing");
  d.launch({
    userId: o.actorId ?? p.ownerId,
    projectId: p.projectId,
    texto: d.turnPrompt(p.locale),
    framing: watchFraming({ url, reports: [i.sample], check: now, hadUnpublishedChanges: before.hadUnpublished }),
    origin: { kind: "len_watch", incidentId: i.id },
    timeZone: p.timeZone,
    locale: p.locale,
    filaId,
    onStart: async () => undefined,
    reply: (text) => onFixReply(i, p, before, text, d),
    fail: (fallo) => onFixFailed(i, p, fallo, d),
  });
}

async function onFixReply(i: Incident, p: ProjectForWatch, before: { stamp: string; hadUnpublished: boolean }, text: string, d: OrchestratorDeps): Promise<void> {
  const summary = text.trim().slice(0, MAX_SUMMARY) || null;
  const withSummary: Incident = { ...i, summary };
  // Len's edits aren't published yet: a site that loads now came back by itself.
  if ((await d.check(pageUrl(p, i.sample.page))).loads) {
    await d.store.updateIncident(i.id, { summary });
    await d.store.resolveIncident(i.id, "recovered");
    await tell(d, p, withSummary, "recovered", summary);
    return;
  }
  const fixStamp = await d.contentStamp(p.projectId);
  if (fixStamp === before.stamp) {
    await d.store.updateIncident(i.id, { status: "needs_owner", reason: "no_change", summary });
    await tell(d, p, withSummary, "needs_owner", summary);
    return;
  }
  const settings = await d.store.getSettings(p.projectId);
  if (settings.autoPublish && !before.hadUnpublished) {
    await d.store.updateIncident(i.id, { summary, fixStamp });
    const r = await publishAndCheck(withSummary, p, d, p.ownerId);
    if (r.status !== 200) {
      await d.store.updateIncident(i.id, { status: "fix_ready", reason: String(r.body.error ?? r.status), summary });
      await tell(d, p, withSummary, "fix_ready", summary);
    }
    return;
  }
  const ready: Incident = { ...withSummary, shipsUnpublished: before.hadUnpublished, fixStamp };
  await d.store.updateIncident(i.id, { status: "fix_ready", shipsUnpublished: before.hadUnpublished, reason: null, summary, fixStamp });
  await tell(d, p, ready, "fix_ready", summary);
}

async function onFixFailed(i: Incident, p: ProjectForWatch, fallo: FalloDelTurno | null, d: OrchestratorDeps): Promise<void> {
  await d.store.updateIncident(i.id, { status: "needs_owner", reason: fallo?.code ?? "turn_failed" });
  await tell(d, p, i, "needs_owner", d.failPhrase(p.locale, fallo));
}

/** Publishes the fix through the gates and, if it went out, opens the site again to see it load. */
async function publishAndCheck(i: Incident, p: ProjectForWatch, d: OrchestratorDeps, actorId: string): Promise<GatedPublishResult> {
  const r = await d.publish({ projectId: p.projectId, actorId, ownerId: p.ownerId, subdomain: p.subdomain ?? "", locale: p.locale, source: "len_watch" });
  if (r.status !== 200) return r;
  await d.store.updateIncident(i.id, { status: "publishing" });
  if ((await d.check(pageUrl(p, i.sample.page))).loads) {
    await d.store.resolveIncident(i.id, "fixed");
    await tell(d, p, i, "fixed", i.summary);
  } else {
    await d.store.updateIncident(i.id, { status: "fix_failed" });
    await tell(d, p, i, "fix_failed", i.summary);
  }
  return r;
}

/** Someone pressed Approve. A gate (428) answers as it is and the incident waits for them. If the draft
 *  moved after Len's fix, publishing would carry those edits too: it asks first (409
 *  `changed_since_fix`), the way a review is dismissed when new commits land, and goes on with
 *  `confirmChanged`. */
export async function approveFix(i: Incident, p: ProjectForWatch, deps?: OrchestratorDeps, o: { actorId?: string; confirmChanged?: boolean } = {}): Promise<GatedPublishResult> {
  const d = deps ?? (await defaultDeps());
  if (i.status !== "fix_ready") return { status: 409, body: { error: "not_ready" } };
  if (i.fixStamp && !o.confirmChanged && (await d.contentStamp(p.projectId)) !== i.fixStamp) return { status: 409, body: { error: "changed_since_fix" } };
  return publishAndCheck(i, p, d, o.actorId ?? p.ownerId);
}

/** A person published the project: if an incident stands (and Len isn't mid-turn), check whether the
 *  site loads now. No notice — they just published it. */
export async function afterOwnerPublish(projectId: string, deps?: OrchestratorDeps): Promise<void> {
  const d = deps ?? (await defaultDeps());
  const i = await d.store.activeIncident(projectId);
  if (!i || i.status === "fixing" || i.status === "publishing") return;
  const p = await d.project(projectId);
  if (!p?.url) return;
  if ((await d.check(pageUrl(p, i.sample.page))).loads) await d.store.resolveIncident(i.id, "owner_published");
}

/** A fingerprint of everything a publish would ship: if it didn't move, Len changed nothing. */
export async function contentStamp(projectId: string): Promise<string> {
  const [{ eq }, { db, schema }, { hashHomeDoc, hashSitePages }] = await Promise.all([import("drizzle-orm"), import("@/lib/db"), import("@/lib/projects")]);
  const [row] = await db
    .select({ filesHash: schema.projects.filesHash, envHash: schema.projects.envHash, data: schema.projects.data })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  const parts = [row?.filesHash ?? null, row?.envHash ?? null, hashHomeDoc(row?.data?.html ?? "", row?.data?.settings), hashSitePages(row?.data)];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

let defaults: OrchestratorDeps | null = null;

async function defaultDeps(): Promise<OrchestratorDeps> {
  if (defaults) return defaults;
  const [store, owner, { checkPublishedLoads }, { scheduleNotification }, turns, gates, { leerCambiosSinPublicar }, correos, { lenWatchTurnPrompt }, { hayTurnoVivoEnElProyecto }] = await Promise.all([
    import("./store"),
    import("./owner"),
    import("./check"),
    import("@/lib/notifications/dispatch"),
    import("@/lib/agent/turnos-desde-el-servidor"),
    import("@/lib/projects/publish-through-gates"),
    import("@/lib/projects"),
    import("@/lib/projects/correos-del-proyecto"),
    import("./texts"),
    import("@/lib/agent/direcciones"),
  ]);
  defaults = {
    store,
    project: owner.projectForWatch,
    check: (url) => checkPublishedLoads(url, { allowOrigins: owner.allowedCheckOrigins() }),
    notify: (event, key) => scheduleNotification(event, key),
    launch: turns.launchLenWatchTurn,
    publish: gates.publishThroughGates,
    hasUnpublished: leerCambiosSinPublicar,
    contentStamp,
    failPhrase: (locale, fallo) => correos.fraseDeFalloDelHilo(correos.idiomaDelCorreo(locale), fallo),
    turnPrompt: lenWatchTurnPrompt,
    interruptedPhrase: (locale) => correos.fraseDeInterrupcionDelHilo(correos.idiomaDelCorreo(locale)),
    liveTurn: hayTurnoVivoEnElProyecto,
    now: Date.now,
    newId: () => crypto.randomUUID(),
  };
  return defaults;
}
