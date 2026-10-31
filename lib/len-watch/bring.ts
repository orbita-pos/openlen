// «TRAER EL ARREGLO» (spec local 2026-10-30-len-watch, §5.5 step 5): the fix is published from its branch; the
// owner's draft doesn't have it yet, and their next publish would bring the crash back. Bringing it in is THEIRS to
// decide — like Claude Code, which never merges a worktree's branch unless told to. It is what git does with
// `git stash` + `git merge len-watch/…` + `git stash pop`: the fix enters, what the owner had half done stays half
// done, and nothing is committed in their history. Never conflict markers in anybody's app: if it collides, Len is
// asked to bring it in by hand, in a turn the person who pressed asked for.
import "server-only";

import { mergeTrees } from "@/lib/git/merge";

export type BringPlan =
  | { readonly kind: "nothing" }
  | { readonly kind: "clean"; readonly writes: ReadonlyMap<string, string | null> }
  | { readonly kind: "conflict"; readonly paths: string[] };

/** The three-way merge (base = what was published, ours = the draft, theirs = the branch; absolute path → blob oid),
 *  told as what to write in the draft. Only what the branch changed moves. */
export async function planBring(
  base: ReadonlyMap<string, string>,
  ours: ReadonlyMap<string, string>,
  theirs: ReadonlyMap<string, string>,
  text: (oid: string) => Promise<string>,
): Promise<BringPlan> {
  const m = await mergeTrees(base, ours, theirs, text, "len-watch");
  const conflicts = Object.keys(m.conflicts).sort();
  if (conflicts.length > 0) return { kind: "conflict", paths: conflicts };
  if (m.write.size === 0) return { kind: "nothing" };
  return { kind: "clean", writes: m.write };
}

/** After a collision handed to Len: is the fix in? Like `git add` after resolving a conflict, the files Len was handed
 *  (`handed`: path → oid at hand-off) and rewrote count as merged — merging the branch again would still collide on
 *  them, so that can't be the test. Anything else of the branch still missing from the draft means it isn't. */
export function handOffDone(plan: BringPlan, handed: ReadonlyMap<string, string | undefined>, now: ReadonlyMap<string, string>): boolean {
  const left = plan.kind === "nothing" ? [] : plan.kind === "conflict" ? plan.paths : [...plan.writes.keys()];
  return left.every((path) => handed.has(path) && now.get(path) !== handed.get(path));
}

export type BringStatus = "brought" | "nothing" | "handed_to_len" | "queued" | "no_fix";

/** A fix published from its branch that the draft doesn't have yet: the owner's next publish would bring the crash
 *  back, so it waits for «Traer el arreglo» or «Publicar igual». A branch deleted by hand is a discarded fix. */
export async function pendingFix(projectId: string): Promise<{ incidentId: string; branch: string } | null> {
  const [{ lenWatchEnabled }, store, wt] = await Promise.all([import("./enabled"), import("./store"), import("./worktree")]);
  if (!lenWatchEnabled()) return null;
  for (const i of await store.pendingBrings(projectId)) {
    if (!i.branch || !i.base) continue;
    const tip = await wt.branchTip(projectId, i.branch);
    if (!tip) continue;
    if ((await planOf(projectId, i.base, tip)).kind !== "nothing") return { incidentId: i.id, branch: i.branch };
  }
  return null;
}

/** «Publicar igual»: published without the fix, and not asked again for it (like an accepted security finding). The
 *  branch stays: it can still be brought. */
export async function declineFix(incidentId: string): Promise<void> {
  await (await import("./store")).updateIncident(incidentId, { bringState: "declined" });
}

/** «Traer el arreglo», pressed by `actorId`. With Len working in the project, it waits for the turn to end (in the
 *  background: the answer is `queued`); otherwise it brings it now. */
export async function bringFix(p: { projectId: string; incidentId: string; actorId: string }): Promise<{ status: BringStatus }> {
  const [{ hayTurnoVivoEnElProyecto }, { esperarALen }] = await Promise.all([import("@/lib/agent/direcciones"), import("@/lib/agent/turnos-desde-el-servidor")]);
  if (hayTurnoVivoEnElProyecto(p.projectId)) {
    void (async () => {
      if (await esperarALen(p.projectId)) await bringNow(p);
    })().catch((err: unknown) => console.warn("[len-watch] the fix couldn't be brought after Len's turn", err));
    return { status: "queued" };
  }
  return bringNow(p);
}

/** The draft as git would see it: absolute path → content (lib/len-watch/published-sources.ts). */
async function draftFiles(projectId: string): Promise<Record<string, string>> {
  const [{ eq }, { db, schema }, { listProjectFiles }, { snapshotFiles }] = await Promise.all([
    import("drizzle-orm"),
    import("@/lib/db"),
    import("@/lib/backend/files"),
    import("./published-sources"),
  ]);
  const [row] = await db.select({ data: schema.projects.data }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
  return row ? snapshotFiles(row.data, await listProjectFiles(projectId)).versioned : {};
}

async function bringNow(p: { projectId: string; incidentId: string; actorId: string }): Promise<{ status: BringStatus }> {
  const [store, wt, owner] = await Promise.all([import("./store"), import("./worktree"), import("./owner")]);
  const incident = await store.incidentById(p.incidentId);
  if (!incident || incident.projectId !== p.projectId || !incident.branch || !incident.base) return { status: "no_fix" };
  const { branch, base } = incident;
  const finish = async () => {
    await store.updateIncident(incident.id, { bringState: "brought" });
    await wt.deleteBranch(p.projectId, branch).catch(() => undefined);
  };
  const tip = await wt.branchTip(p.projectId, branch);
  // The branch is gone: deleted by hand, which in git is discarding it.
  if (!tip) return { status: "nothing" };

  const plan = await planOf(p.projectId, base, tip);
  if (plan.kind === "nothing") {
    await finish();
    return { status: "nothing" };
  }
  const project = await owner.projectForWatch(p.projectId);
  if (!project) return { status: "no_fix" };
  if (plan.kind === "clean") {
    const draft = await draftFiles(p.projectId);
    const [{ guardarLoDeLaTerminal }, { realDeps }] = await Promise.all([import("@/lib/agent/herramientas-de-ficheros"), import("@/lib/agent/tools")]);
    const session = {
      projectId: p.projectId,
      userId: project.ownerId,
      ...(p.actorId !== project.ownerId ? { personId: p.actorId } : {}),
      autor: "usuario" as const,
      page: null,
      ownerEmail: null,
      imageEditsThisTurn: 0,
      photoSearchesThisTurn: 0,
      busquedasVaciasSeguidas: 0,
    };
    const cambios = [...plan.writes].map(([ruta, contenido]) =>
      contenido === null ? { tipo: "borrado" as const, ruta } : { tipo: "escrito" as const, ruta, contenido, crea: !Object.hasOwn(draft, ruta) },
    );
    const saved = await guardarLoDeLaTerminal(session, realDeps(), cambios, draft);
    if (!saved.rechazado) {
      await finish();
      return { status: "brought" };
    }
    // A guard refused part of it: Len reads why and finishes by hand.
    return handToLen(p, project, branch, base, [...plan.writes.keys()], saved.notas, finish);
  }
  return handToLen(p, project, branch, base, plan.paths, [], finish);
}

/** The draft as a git tree: absolute path → blob oid, and each oid's text. */
async function draftTree(projectId: string): Promise<{ oids: Map<string, string>; texts: Map<string, string> }> {
  const { oidOfContent } = await import("@/lib/git/content");
  const oids = new Map<string, string>();
  const texts = new Map<string, string>();
  for (const [path, content] of Object.entries(await draftFiles(projectId))) {
    const oid = oidOfContent(content);
    oids.set(path, oid);
    texts.set(oid, content);
  }
  return { oids, texts };
}

async function planOf(projectId: string, base: string, tip: string, draft?: Awaited<ReturnType<typeof draftTree>>): Promise<BringPlan> {
  const [{ postgresStore }, { Repository }, { toAbsolute }] = await Promise.all([import("@/lib/git/postgres-store"), import("@/lib/git/repository"), import("@/lib/git/paths")]);
  const repo = new Repository(postgresStore(projectId));
  const [b, t] = await Promise.all([repo.commit(base), repo.commit(tip)]);
  const [baseFiles, theirFiles] = await Promise.all([repo.files(b.tree), repo.files(t.tree)]);
  const absolute = (m: ReadonlyMap<string, string>) => new Map([...m].map(([path, oid]) => [toAbsolute(path), oid]));
  const ours = draft ?? (await draftTree(projectId));
  return planBring(absolute(baseFiles), ours.oids, absolute(theirFiles), async (oid) => ours.texts.get(oid) ?? repo.text(oid));
}

async function handToLen(
  p: { projectId: string; incidentId: string; actorId: string },
  project: import("./owner").ProjectForWatch,
  branch: string,
  base: string,
  paths: readonly string[],
  notes: readonly string[],
  finish: () => Promise<void>,
): Promise<{ status: BringStatus }> {
  const [{ launchLenWatchTurn }, { bringFraming }, { lenWatchBringPrompt }, { LOCALE_ENGLISH_NAMES }] = await Promise.all([
    import("@/lib/agent/turnos-desde-el-servidor"),
    import("./framing"),
    import("./texts"),
    import("@/lib/publish/publish-locales"),
  ]);
  const tip = async () => (await import("./worktree")).branchTip(p.projectId, branch);
  const atHandOff = (await draftTree(p.projectId)).oids;
  const handed = new Map(paths.map((path) => [path, atHandOff.get(path)]));
  launchLenWatchTurn({
    userId: p.actorId,
    projectId: p.projectId,
    texto: lenWatchBringPrompt(project.locale),
    framing: bringFraming({ branch, base, paths, notes, language: LOCALE_ENGLISH_NAMES[project.locale] ?? "English" }),
    origin: { kind: "len_watch", incidentId: p.incidentId },
    timeZone: project.timeZone,
    locale: project.locale,
    filaId: crypto.randomUUID(),
    onStart: async () => undefined,
    // Brought when Len rewrote what it was handed and nothing else of the branch is missing (`handOffDone`).
    reply: async () => {
      const t = await tip();
      if (!t) return;
      const now = await draftTree(p.projectId);
      if (handOffDone(await planOf(p.projectId, base, t, now), handed, now.oids)) await finish();
    },
    fail: async () => undefined,
  });
  return { status: "handed_to_len" };
}
