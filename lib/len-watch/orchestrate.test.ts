// @vitest-environment node
// Len Watch's decisions with everything around them faked: who gets told what, when Len runs, when
// the fix is published, and that nothing ever starts a second turn on its own.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { LoadCheck } from "./check";
import { createIngester } from "./ingest";
import { afterOwnerPublish, approveFix, onIncidentOpened, recoverIfStale, STALE_FIX_MS, startFix, type OrchestratorDeps } from "./orchestrate";
import type { ProjectForWatch } from "./owner";
import type { Incident, LenWatchSettings, Resolution, WatchReport } from "./types";

const REPORT: WatchReport = { message: "boom", file: null, line: null, col: null, page: null };
const P: ProjectForWatch = { projectId: "p1", ownerId: "u1", title: "Holi", subdomain: "holi", url: "https://holi.openlen.app", locale: "es", timeZone: "UTC" };
const DOWN: LoadCheck = { loads: false, reason: "blank", errors: ["kaput"] };
const UP: LoadCheck = { loads: true, reason: "ok", errors: [] };

type Launched = Parameters<OrchestratorDeps["launch"]>[0];

function world(o: { settings?: Partial<LenWatchSettings>; checks?: LoadCheck[]; stamps?: string[]; unpublished?: boolean; publish?: { status: number; body: Record<string, unknown> }; live?: boolean; now?: number } = {}) {
  const incidents = new Map<string, Incident>();
  const notices: string[] = [];
  const launched: Launched[] = [];
  const checks = [...(o.checks ?? [])];
  const stamps = [...(o.stamps ?? ["a", "b"])];
  const deps: OrchestratorDeps = {
    store: {
      getSettings: async () => ({ autoFix: false, autoPublish: false, muted: false, locale: null, ...o.settings }),
      activeIncident: async (pid) => [...incidents.values()].find((i) => i.projectId === pid && i.status !== "resolved") ?? null,
      incidentById: async (id) => incidents.get(id) ?? null,
      updateIncident: async (id, patch) => void incidents.set(id, { ...incidents.get(id)!, ...patch }),
      resolveIncident: async (id, resolution: Resolution) => void incidents.set(id, { ...incidents.get(id)!, status: "resolved", resolution, resolvedAt: new Date() }),
    },
    project: async () => P,
    check: vi.fn(async () => checks.shift() ?? DOWN),
    notify: async (e) => void notices.push(e.phase),
    launch: (p) => void launched.push(p),
    publish: vi.fn(async () => o.publish ?? { status: 200, body: { url: P.url } }),
    hasUnpublished: async () => o.unpublished ?? false,
    contentStamp: async () => stamps.shift() ?? "same",
    failPhrase: (_l, f) => `No pude: ${f?.code ?? "?"}`,
    turnPrompt: () => "Tu sitio publicado no carga. Averigua por qué y arréglalo.",
    interruptedPhrase: () => "Len se interrumpió.",
    liveTurn: () => o.live ?? false,
    now: () => o.now ?? Date.now(),
    newId: () => "row-1",
  };
  const open = (status: Incident["status"] = "open"): Incident => {
    const now = new Date();
    const i: Incident = { id: "i1", projectId: "p1", status, sample: REPORT, reports: 1, summary: null, reason: null, shipsUnpublished: false, turnRowId: null, createdAt: now, updatedAt: now, resolvedAt: null, resolution: null };
    incidents.set(i.id, i);
    return i;
  };
  const current = () => incidents.get("i1")!;
  return { deps, notices, launched, open, current };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("onIncidentOpened", () => {
  it("without «fix on its own», it only says the site is down", async () => {
    const w = world();
    await onIncidentOpened(w.open(), P, DOWN, w.deps);
    expect(w.notices).toEqual(["down"]);
    expect(w.launched).toHaveLength(0);
  });

  it("with it, Len starts at once, as the owner, with the framing and our browser's errors", async () => {
    const w = world({ settings: { autoFix: true } });
    await onIncidentOpened(w.open(), P, DOWN, w.deps);
    expect(w.notices).toEqual(["fixing"]);
    expect(w.launched).toHaveLength(1);
    expect(w.launched[0]).toMatchObject({ userId: "u1", projectId: "p1", origin: { kind: "len_watch", incidentId: "i1" }, locale: "es", filaId: "row-1" });
    expect(w.launched[0]!.framing).toContain("our browser: kaput");
    expect(w.current()).toMatchObject({ status: "fixing", turnRowId: "row-1" });
    expect(w.deps.check).not.toHaveBeenCalled();
  });
});

describe("when Len replies", () => {
  it("fix on its own + publish on its own: published, checked, fixed", async () => {
    const w = world({ settings: { autoFix: true, autoPublish: true }, checks: [DOWN, UP] });
    await onIncidentOpened(w.open(), P, DOWN, w.deps);
    await w.launched[0]!.reply("Arreglado: main.jsx.", []);
    expect(w.deps.publish).toHaveBeenCalledTimes(1);
    expect(w.deps.publish).toHaveBeenCalledWith({ projectId: "p1", actorId: "u1", ownerId: "u1", subdomain: "holi", locale: "es", source: "len_watch" });
    expect(w.current()).toMatchObject({ status: "resolved", resolution: "fixed", summary: "Arreglado: main.jsx." });
    expect(w.notices).toEqual(["fixing", "fixed"]);
  });

  it("🔴 the owner had changes half done: never published alone; the notice says they'd go too", async () => {
    const w = world({ settings: { autoFix: true, autoPublish: true }, unpublished: true, checks: [DOWN] });
    await onIncidentOpened(w.open(), P, DOWN, w.deps);
    expect(w.launched[0]!.framing).toContain("keep them and fix on top");
    await w.launched[0]!.reply("Arreglado.", []);
    expect(w.deps.publish).not.toHaveBeenCalled();
    expect(w.current()).toMatchObject({ status: "fix_ready", shipsUnpublished: true });
    expect(w.notices).toEqual(["fixing", "fix_ready"]);
  });

  it("a publish gate (a security finding) leaves it ready to approve", async () => {
    const w = world({ settings: { autoFix: true, autoPublish: true }, checks: [DOWN], publish: { status: 428, body: { error: "security_findings" } } });
    await onIncidentOpened(w.open(), P, DOWN, w.deps);
    await w.launched[0]!.reply("Arreglado.", []);
    expect(w.current()).toMatchObject({ status: "fix_ready", reason: "security_findings" });
    expect(w.notices).toEqual(["fixing", "fix_ready"]);
  });

  it("🔴 published but still blank: fix_failed, and later reports start nothing", async () => {
    const w = world({ settings: { autoFix: true, autoPublish: true }, checks: [DOWN, DOWN] });
    await onIncidentOpened(w.open(), P, DOWN, w.deps);
    await w.launched[0]!.reply("Arreglado.", []);
    expect(w.current().status).toBe("fix_failed");
    expect(w.notices).toEqual(["fixing", "fix_failed"]);
    const ingest = createIngester({ store: { ...w.deps.store, countReport: async () => undefined, openIncident: async () => null }, project: w.deps.project, check: w.deps.check, onOpened: (i, p, c) => onIncidentOpened(i, p, c, w.deps), now: () => 1 });
    await ingest("p1", REPORT);
    await settle();
    expect(w.launched).toHaveLength(1);
  });

  it("without «publish on its own»: ready to approve", async () => {
    const w = world({ settings: { autoFix: true }, checks: [DOWN] });
    await onIncidentOpened(w.open(), P, DOWN, w.deps);
    await w.launched[0]!.reply("Arreglado.", []);
    expect(w.deps.publish).not.toHaveBeenCalled();
    expect(w.current()).toMatchObject({ status: "fix_ready", shipsUnpublished: false });
  });

  it("the site came back on its own while Len worked: recovered, nothing published", async () => {
    const w = world({ settings: { autoFix: true, autoPublish: true }, checks: [UP] });
    await onIncidentOpened(w.open(), P, DOWN, w.deps);
    await w.launched[0]!.reply("Miré y …", []);
    expect(w.deps.publish).not.toHaveBeenCalled();
    expect(w.current()).toMatchObject({ status: "resolved", resolution: "recovered" });
    expect(w.notices).toEqual(["fixing", "recovered"]);
  });

  it("Len changed nothing: it needs the owner", async () => {
    const w = world({ settings: { autoFix: true }, checks: [DOWN], stamps: ["same", "same"] });
    await onIncidentOpened(w.open(), P, DOWN, w.deps);
    await w.launched[0]!.reply("No encontré la causa.", []);
    expect(w.current()).toMatchObject({ status: "needs_owner", reason: "no_change", summary: "No encontré la causa." });
    expect(w.notices).toEqual(["fixing", "needs_owner"]);
  });

  it("the turn fails (no credits): it needs the owner, with the reason", async () => {
    const w = world({ settings: { autoFix: true } });
    await onIncidentOpened(w.open(), P, DOWN, w.deps);
    await w.launched[0]!.fail({ motivo: "sin créditos", code: "no_credits" }, false);
    expect(w.current()).toMatchObject({ status: "needs_owner", reason: "no_credits" });
    expect(w.notices).toEqual(["fixing", "needs_owner"]);
  });
});

describe("startFix by the owner", () => {
  it("checks first: if the site loads again, no turn and no credits spent", async () => {
    const w = world({ checks: [UP] });
    await startFix(w.open("needs_owner"), P, w.deps);
    expect(w.launched).toHaveLength(0);
    expect(w.current()).toMatchObject({ status: "resolved", resolution: "recovered" });
  });
});

describe("approveFix", () => {
  it("only a ready fix can be approved", async () => {
    const w = world();
    expect(await approveFix(w.open("open"), P, w.deps)).toEqual({ status: 409, body: { error: "not_ready" } });
    expect(w.deps.publish).not.toHaveBeenCalled();
  });

  it("approved and loading: fixed", async () => {
    const w = world({ checks: [UP] });
    const r = await approveFix(w.open("fix_ready"), P, w.deps);
    expect(r.status).toBe(200);
    expect(w.current()).toMatchObject({ status: "resolved", resolution: "fixed" });
    expect(w.notices).toEqual(["fixed"]);
  });

  it("a gate answers as it is, and the incident waits", async () => {
    const w = world({ publish: { status: 428, body: { error: "confirmation_required" } } });
    expect(await approveFix(w.open("fix_ready"), P, w.deps)).toEqual({ status: 428, body: { error: "confirmation_required" } });
    expect(w.current().status).toBe("fix_ready");
    expect(w.notices).toEqual([]);
  });
});

describe("recoverIfStale", () => {
  const minutesAgo = (w: ReturnType<typeof world>, status: Incident["status"], minutes: number) => {
    const i = w.open(status);
    const updatedAt = new Date(Date.parse("2026-10-30T12:00:00Z") - minutes * 60_000);
    void w.deps.store.updateIncident(i.id, {});
    return { ...i, updatedAt };
  };
  const NOW = Date.parse("2026-10-30T12:00:00Z");

  it("🔴 a fix cut by a restart (no live turn, long past the queue's wait) goes back to the owner", async () => {
    const w = world({ now: NOW });
    const r = await recoverIfStale(minutesAgo(w, "fixing", STALE_FIX_MS / 60_000 + 1), w.deps);
    expect(r).toMatchObject({ status: "needs_owner", reason: "interrupted" });
    expect(w.current()).toMatchObject({ status: "needs_owner", reason: "interrupted" });
    expect(w.notices).toEqual(["needs_owner"]);
  });

  it("a publish cut the same way too", async () => {
    const w = world({ now: NOW });
    expect((await recoverIfStale(minutesAgo(w, "publishing", STALE_FIX_MS / 60_000 + 1), w.deps)).status).toBe("needs_owner");
  });

  it("a recent fix, or one whose turn is alive, is left alone", async () => {
    const recent = world({ now: NOW });
    expect((await recoverIfStale(minutesAgo(recent, "fixing", 5), recent.deps)).status).toBe("fixing");
    const alive = world({ now: NOW, live: true });
    expect((await recoverIfStale(minutesAgo(alive, "fixing", 120), alive.deps)).status).toBe("fixing");
    expect(alive.notices).toEqual([]);
  });

  it("only fixing and publishing can be stale", async () => {
    const w = world({ now: NOW });
    expect((await recoverIfStale(minutesAgo(w, "fix_ready", 600), w.deps)).status).toBe("fix_ready");
  });
});

describe("afterOwnerPublish", () => {
  it("the owner published and the site loads: resolved, no notice", async () => {
    const w = world({ checks: [UP] });
    w.open("fix_failed");
    await afterOwnerPublish("p1", w.deps);
    expect(w.current()).toMatchObject({ status: "resolved", resolution: "owner_published" });
    expect(w.notices).toEqual([]);
  });

  it("leaves a turn in progress alone", async () => {
    const w = world({ checks: [UP] });
    w.open("fixing");
    await afterOwnerPublish("p1", w.deps);
    expect(w.deps.check).not.toHaveBeenCalled();
    expect(w.current().status).toBe("fixing");
  });
});
