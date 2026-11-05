// «CREAR» STARTS THE CREATOR AND INSTALLS WHAT IT HANDS BACK (spec local 2026-11-04-herramientas-hechas-por-len,
// §4.10). DeepSeek's `create_personalized_page` (creation-recommendations/src/index.ts, `generate` → `install`, at
// fcc0ad4621, MIT): the action starts a Creator activation in the background with `delivery: "caller"` and an output
// schema `{ ready: boolean }`; when it settles, the CARD's code — not the model — validates and installs. Here the
// Creator works in the person's own tool project, born for it, and installing is phase 1's `installTool`, every gate
// included, then the load test.
import "server-only";

import { CENTICREDITOS_POR_CREDITO } from "@/lib/credits-client";

import { creatorFraming } from "./framing";
import type { ToolCardRow } from "./store";
import type { ToolCardPhase, ToolCardReview } from "./types";

/** DeepSeek's activation output schema for its Creator. */
export const READY_SCHEMA = { type: "object", properties: { ready: { type: "boolean" } }, required: ["ready"] } as const;

const DEFAULT_CAP_CREDITS = 25;

/** What one creation may spend at most, in centicredits: `OPENLEN_TOOL_CREATION_CAP` credits (25 by default). */
export function creationCapCentis(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const n = Number(env.OPENLEN_TOOL_CREATION_CAP);
  return Math.round((Number.isFinite(n) && n > 0 ? n : DEFAULT_CAP_CREDITS) * CENTICREDITOS_POR_CREDITO);
}

/** The host turn that launches the Creator in the tool project (`launchToolCreationHost`). */
export interface ToolCreationHost {
  readonly userId: string;
  readonly projectId: string;
  readonly texto: string;
  readonly framing: string;
  readonly origin: { readonly kind: "tool_creation"; readonly cardId: string; readonly title: string };
  readonly timeZone: string;
  readonly locale: string;
  readonly filaId: string;
  readonly ceilingCentis: number;
  readonly fail: (reason: string | null) => Promise<void>;
}

/** What `installTool` answers (phase 1, `lib/tools/install.ts`). */
export interface InstallAnswer {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface CreationDeps {
  createProject(personId: string, p: { title: string; brief: string; html: string }): Promise<string>;
  bornAsTool(p: { projectId: string; userId: string; title: string; locale: string }): Promise<"born" | "not_blank" | "plan_required">;
  cardById(id: string): Promise<ToolCardRow | null>;
  casPhase(id: string, from: readonly ToolCardPhase[], to: ToolCardPhase, set?: Partial<ToolCardRow>): Promise<ToolCardRow | null>;
  launchHost(p: ToolCreationHost): void;
  installTool(i: {
    projectId: string;
    actorId: string;
    locale: string;
    requestHost: null;
    waitWhenPending: true;
    acceptSecurityFingerprint?: string;
    confirmFingerprint?: string;
  }): Promise<InstallAnswer>;
  /** Opens the installed release once (`loadTestInstalled`) as the person. */
  loadTest(installation: { id: string }, personId: string, locale: string): Promise<{ ok: true } | { ok: false; errors: string[] }>;
  markRemoved(installationId: string, personId: string): Promise<boolean>;
  /** The subagent registry's `stop`. */
  stopRun(runId: string): boolean;
  newId(): string;
  capCentis: number;
}

export async function realCreationDeps(): Promise<CreationDeps> {
  const [projects, born, store, install, tools, loadTest, launcher, registry] = await Promise.all([
    import("@/lib/projects"),
    import("@/lib/projects/born-as-tool"),
    import("./store"),
    import("../install"),
    import("../store"),
    import("./load-test"),
    import("@/lib/agent/turnos-desde-el-servidor"),
    import("@/lib/agent/subagents/registry"),
  ]);
  return {
    createProject: (personId, p) => projects.createProject(personId, p),
    bornAsTool: (p) => born.bornAsTool(p),
    cardById: store.cardById,
    casPhase: (id, from, to, set) => store.casPhase(id, from, to, set),
    launchHost: (p) => launcher.launchToolCreationHost(p),
    installTool: (i) => install.installTool(i),
    loadTest: async (view, personId, locale) => {
      const row = await tools.installationById(view.id);
      if (!row) return { ok: false, errors: ["The installed version is gone."] };
      const personEmail = await tools.personEmail(personId);
      return loadTest.loadTestInstalled(row, { mode: "installed", installation: row, personId, personEmail, locale, timeZone: "UTC" });
    },
    markRemoved: tools.markRemoved,
    stopRun: registry.stop,
    newId: () => crypto.randomUUID(),
    capCentis: creationCapCentis(),
  };
}

/**
 * «Crear» (and «Reintentar»): the person's tool project is born — a retry reuses it — and a host turn in it launches
 * the Creator. The card is already `creating` (the press moved it); a Free plan puts nothing in motion.
 */
export async function startCreation(
  card: ToolCardRow,
  o: { readonly personId: string; readonly locale: string; readonly timeZone: string; readonly previousError?: string },
  deps: CreationDeps,
): Promise<{ ok: true } | { ok: false; reason: "plan_required" }> {
  let toolProjectId = card.toolProjectId;
  if (!toolProjectId) {
    toolProjectId = await deps.createProject(o.personId, { title: card.title, brief: card.brief, html: "" });
    const born = await deps.bornAsTool({ projectId: toolProjectId, userId: o.personId, title: card.title, locale: o.locale });
    if (born === "plan_required") return { ok: false, reason: "plan_required" };
  }
  const hostRowId = deps.newId();
  await deps.casPhase(card.id, ["creating"], "creating", { toolProjectId, hostRowId, error: null, review: null, cancelRequested: false });
  deps.launchHost({
    userId: o.personId,
    projectId: toolProjectId,
    texto: `Crear «${card.title}»`,
    framing: creatorFraming(card, o.previousError ? { previousError: o.previousError } : {}),
    origin: { kind: "tool_creation", cardId: card.id, title: card.title },
    timeZone: o.timeZone,
    locale: o.locale,
    filaId: hostRowId,
    ceilingCentis: deps.capCentis,
    fail: async (reason) => {
      await deps.casPhase(card.id, ["creating"], "failed", { error: reason ?? "unavailable" });
    },
  });
  return { ok: true };
}

/** What the host row says while the Creator works (the person may open the tool project and see it). */
const HOST_TEXT: Readonly<Record<string, (title: string) => string>> = {
  en: (t) => `Building «${t}»…`,
  es: (t) => `Creando «${t}»…`,
  pt: (t) => `Criando «${t}»…`,
  fr: (t) => `Création de «${t}»…`,
  de: (t) => `«${t}» wird erstellt…`,
  it: (t) => `Creazione di «${t}»…`,
  ja: (t) => `«${t}»を作成中…`,
  ko: (t) => `«${t}» 만드는 중…`,
  zh: (t) => `正在创建«${t}»…`,
  nl: (t) => `«${t}» wordt gemaakt…`,
};

/** The launcher of the host turn's children (`SubagentsDeps.launch`, Task 6's options). */
export interface CreatorLauncher {
  launch(o: {
    description: string;
    prompt: string;
    preset: string;
    outputSchema: typeof READY_SCHEMA;
    delivery: "caller";
    onSettled: (r: CreatorSettled) => Promise<void>;
  }): Promise<{ ok: true; id: string } | { ok: false; code: string; message: string }>;
}

/**
 * The host turn: no model call. It launches the `creator` child with DeepSeek's activation options — `delivery:
 * "caller"`, the `{ ready }` schema — whose settlement goes to the card, and answers what the row says.
 */
export async function hostTheCreator(
  o: { readonly cardId: string; readonly framing: string; readonly locale: string; readonly launcher: CreatorLauncher | undefined },
  deps: CreationDeps,
): Promise<string> {
  const card = await deps.cardById(o.cardId);
  const text = (HOST_TEXT[o.locale] ?? HOST_TEXT.en!)(card?.title ?? "");
  if (!card || card.phase !== "creating") return text;
  if (!o.launcher) {
    await deps.casPhase(card.id, ["creating"], "failed", { error: "subagents_off" });
    return text;
  }
  const launched = await o.launcher.launch({
    preset: "creator",
    description: card.title,
    prompt: o.framing,
    outputSchema: READY_SCHEMA,
    delivery: "caller",
    onSettled: (r) => onCreatorSettled(card.id, r, { locale: o.locale }, deps),
  });
  if (!launched.ok) {
    await deps.casPhase(card.id, ["creating"], "failed", { error: launched.code });
    return text;
  }
  const stored = await deps.casPhase(card.id, ["creating"], "creating", { creatorRunId: launched.id });
  // «Cancelar» pressed while it was being launched: the press found no run to stop, so it is stopped here.
  if (!stored || stored.cancelRequested) deps.stopRun(launched.id);
  return text;
}

/** How the Creator's run ended (Task 6's `onSettled`). */
export interface CreatorSettled {
  readonly id: string;
  readonly status: "completed" | "aborted" | "error" | "budget" | "turn_limit";
  readonly structured: Record<string, unknown> | null;
  readonly finalText: string;
}

/** The Creator settled: the card's code decides, never the model's prose (DeepSeek's `generate`). */
export async function onCreatorSettled(cardId: string, r: CreatorSettled, o: { readonly locale: string }, deps: CreationDeps): Promise<void> {
  const card = await deps.cardById(cardId);
  if (!card || card.phase !== "creating") return;
  if (r.status !== "completed") {
    if (card.cancelRequested) await deps.casPhase(cardId, ["creating"], "cancelled");
    else if (r.status === "aborted") await deps.casPhase(cardId, ["creating"], "interrupted");
    else await deps.casPhase(cardId, ["creating"], "failed", { error: oneSentence(r.finalText) || r.status });
    return;
  }
  if (r.structured?.ready !== true) {
    await deps.casPhase(cardId, ["creating"], "failed", { error: oneSentence(r.finalText) || "not_ready" });
    return;
  }
  const installing = await deps.casPhase(cardId, ["creating"], "installing");
  if (installing) await installAndCheck(installing, { locale: o.locale }, deps);
}

/**
 * Install through every gate, waiting for a review still running (nobody is in front of it), then open it once. A
 * 428 leaves the card waiting for the person's review («Instalar igual» passes their acceptance back here).
 */
export async function installAndCheck(
  card: ToolCardRow,
  o: { readonly locale: string; readonly acceptSecurityFingerprint?: string; readonly confirmFingerprint?: string },
  deps: CreationDeps,
): Promise<void> {
  if (!card.toolProjectId) {
    await deps.casPhase(card.id, ["installing"], "failed", { error: "not_a_tool" });
    return;
  }
  const answer = await deps.installTool({
    projectId: card.toolProjectId,
    actorId: card.personId,
    locale: o.locale,
    requestHost: null,
    waitWhenPending: true,
    ...(o.acceptSecurityFingerprint ? { acceptSecurityFingerprint: o.acceptSecurityFingerprint } : {}),
    ...(o.confirmFingerprint ? { confirmFingerprint: o.confirmFingerprint } : {}),
  });
  if (answer.status === 200) {
    const installation = answer.body.installation as { id: string };
    const loaded = await deps.loadTest(installation, card.personId, o.locale);
    if (loaded.ok) {
      await deps.casPhase(card.id, ["installing"], "installed", { installationId: installation.id, error: null, review: null });
      return;
    }
    await deps.markRemoved(installation.id, card.personId);
    await deps.casPhase(card.id, ["installing"], "failed", { error: loaded.errors.join("\n") });
    return;
  }
  const review = reviewOf(answer);
  if (review) {
    await deps.casPhase(card.id, ["installing"], "needs_review", { review });
    return;
  }
  await deps.casPhase(card.id, ["installing"], "failed", { error: installError(answer) });
}

/** A 428 the person can answer: the security review's findings, or a migration that destroys real data. */
function reviewOf(a: InstallAnswer): ToolCardReview | null {
  if (a.status !== 428 || typeof a.body.fingerprint !== "string") return null;
  if (a.body.error === "security_findings") {
    const blocking = Array.isArray(a.body.blocking) ? (a.body.blocking as { description?: string; category?: string; params?: Record<string, string> }[]) : [];
    return {
      kind: "security_findings",
      fingerprint: a.body.fingerprint,
      findings: blocking.map((f) => f.description || [f.category, ...Object.values(f.params ?? {})].filter(Boolean).join(" ")),
    };
  }
  if (a.body.error === "confirmation_required") {
    const destructive = Array.isArray(a.body.destructive) ? (a.body.destructive as Record<string, unknown>[]) : [];
    return {
      kind: "needs_confirmation",
      fingerprint: a.body.fingerprint,
      findings: destructive.map((d) =>
        d.kind === "delete_rows" ? `delete_rows: ${String(d.statement)}` : `${String(d.kind)}: ${String(d.table)}${d.column ? `.${String(d.column)}` : ""}`,
      ),
    };
  }
  return null;
}

/** Any other answer, as one line: its code, and its first details when it has them. */
function installError(a: InstallAnswer): string {
  const code = typeof a.body.error === "string" ? a.body.error : `HTTP ${a.status}`;
  const details = [a.body.errors, a.body.problems].find(Array.isArray) as unknown[] | undefined;
  const first = details?.slice(0, 3).map(String).join("; ");
  return first ? `${code}: ${first}` : code;
}

/** The Creator's last words, trimmed to what a card shows. */
function oneSentence(text: string): string {
  return text.trim().slice(0, 500);
}
