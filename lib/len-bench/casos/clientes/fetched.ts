// lib/len-bench/casos/clientes/fetched.ts — A CUSTOMER CASE OF LEN 3.1's BATTERY 1, as fetched from production.
//
// Plan local 2026-11-15-len-3-1-bateria-de-paginas-gratis, task 8 (spec local 2026-11-12-len-3-1-ruta, §5 piece
// 5): «en el repo va sólo el ID y la rúbrica; el texto se trae al correr, por ssh y en sólo lectura, a una carpeta
// fuera del repo». The rows come from `npm run bench:clientes:fetch` (scripts/fetch-bench-customer-cases.ts);
// this module turns them into a case and keeps it in `OPENLEN_BENCH_CASES_DIR` or ~/.openlen/bench-cases — the
// same place-outside-the-repo rule as the replay scenes (lib/agent/replay-scenes/scene-files.ts).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { answerSummary, isQuestionTool, type QuestionAnswer, type UserQuestion } from "@/lib/agent/ask-user-question";
import type { DatosDelCaso } from "../../tipos";

/** What the fetch brings for one project: never printed, only built into a case. */
export interface RawCaseRows {
  readonly projectId: string;
  /** `projects.data` and `projects.subdomain` today: the customer's final state. */
  readonly project: { readonly data: DatosDelCaso; readonly subdomain: string | null };
  /** `projectVersions` saved BEFORE the first owner message (a pasted page, a template): the starting page. */
  readonly versionsBefore: readonly { readonly page: string | null; readonly html: string; readonly createdAt: string }[];
  /** The owner-typed turns of the current chat, oldest first (no `tipo`, no `origen`, not `en_curso`). */
  readonly rows: readonly {
    readonly userText: string;
    readonly attachedImage: unknown;
    readonly attachedFiles: unknown;
    /** The site page the owner was looking at when they typed it (`projectChatMessages.page`); null = Home. */
    readonly page?: string | null;
    readonly createdAt: string;
    readonly transcript: { readonly mensajes?: readonly unknown[] } | null;
  }[];
}

export interface FetchedCase {
  readonly projectId: string;
  readonly fetchedAt: string;
  /** The page Len started from: blank, or what existed before the first message. */
  readonly start: DatosDelCaso;
  /** The customer's final state in production: the ORACLE the graders must pass (plan, task 10). */
  readonly final: DatosDelCaso;
  /** What the owner typed, in order: the case's script. */
  readonly ownerMessages: readonly string[];
  /** What the owner answered in Len's question cards, with the question: the ficha the simulated owner gives. */
  readonly cardAnswers: readonly { readonly question: string; readonly answer: string }[];
  readonly published: { readonly subdomain: string } | null;
}

const attached = (v: unknown): boolean => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);

interface Wire {
  readonly functionCalls?: readonly { readonly name?: unknown; readonly args?: { readonly questions?: unknown } }[];
  readonly functionResponses?: readonly { readonly name?: unknown; readonly response?: { readonly answers?: unknown } }[];
}

/** Each answer of a question card next to its question, as the owner gave it (options chosen, then written). */
function cardAnswersOf(rows: RawCaseRows["rows"]): FetchedCase["cardAnswers"] {
  const out: { question: string; answer: string }[] = [];
  for (const row of rows) {
    let asked = new Map<string, string>();
    for (const m of (row.transcript?.mensajes ?? []) as Wire[]) {
      for (const call of m.functionCalls ?? []) {
        if (typeof call.name !== "string" || !isQuestionTool(call.name) || !Array.isArray(call.args?.questions)) continue;
        asked = new Map((call.args.questions as UserQuestion[]).map((q) => [q.id, q.question]));
      }
      for (const r of m.functionResponses ?? []) {
        if (typeof r.name !== "string" || !isQuestionTool(r.name) || !Array.isArray(r.response?.answers)) continue;
        for (const a of r.response.answers as QuestionAnswer[]) {
          const answer = answerSummary([a]);
          if (answer) out.push({ question: asked.get(a.id) ?? "", answer });
        }
      }
    }
  }
  return out;
}

/** The last version of each page saved before the first message; none at all = a blank page. */
function startOf(versions: RawCaseRows["versionsBefore"]): DatosDelCaso {
  const latest = new Map<string | null, { html: string; at: string }>();
  for (const v of versions) {
    const seen = latest.get(v.page);
    if (!seen || v.createdAt >= seen.at) latest.set(v.page, { html: v.html, at: v.createdAt });
  }
  const pages = Object.fromEntries([...latest].filter(([page]) => page !== null).map(([page, v]) => [page!, { html: v.html }]));
  return { html: latest.get(null)?.html ?? "", ...(Object.keys(pages).length > 0 ? { pages } : {}) };
}

/** A case, or why the project is left out. */
export function fetchedCaseFrom(raw: RawCaseRows, fetchedAt: string): FetchedCase | { left: string } {
  if (raw.rows.length === 0) return { left: "sin mensajes del dueño" };
  if (raw.rows.some((r) => attached(r.attachedImage) || attached(r.attachedFiles))) {
    return { left: "el dueño adjuntó una foto o un fichero: el banco no repite adjuntos" };
  }
  // The battery measures «crear, editar y publicar una página»; a dashboard or a deck is another flow, and its
  // project's page stays empty — the oracle would be a page nobody asked for (case 25b92e46, 15/11).
  const madeArtifact = raw.rows.some((r) =>
    ((r.transcript?.mensajes ?? []) as Wire[]).some((m) =>
      (m.functionCalls ?? []).some((c) => c.name === "create_deliverable" || c.name === "create_artifact"),
    ),
  );
  if (madeArtifact) return { left: "Len hizo un entregable (create_deliverable), no la página: es otro flujo" };
  // Review I4: the bench sends every message against Home; one typed while looking at a sub-page would be another
  // request. Left out and counted, as attachments.
  if (raw.rows.some((r) => typeof r.page === "string" && r.page !== "")) {
    return { left: "un mensaje se escribió viendo una subpágina: el banco lo repetiría contra la portada" };
  }
  // Review I1: «published» is a publish LEN made. A customer who published with the publish button never asked Len,
  // and the replay would fail len-publico in both columns.
  const lenPublished = raw.rows.some((r) =>
    ((r.transcript?.mensajes ?? []) as Wire[]).some((m) => (m.functionCalls ?? []).some((c) => c.name === "publish")),
  );
  return {
    projectId: raw.projectId,
    fetchedAt,
    start: startOf(raw.versionsBefore),
    final: pageStateOf(raw.project.data),
    ownerMessages: raw.rows.map((r) => r.userText),
    cardAnswers: cardAnswersOf(raw.rows),
    published: lenPublished && raw.project.subdomain ? { subdomain: raw.project.subdomain } : null,
  };
}

/** Review I3: of `projects.data`, only what a page is — the Home's html and each page's html, title and
 *  membersOnly. Never a preview token, a passcode or anything else the project keeps. */
function pageStateOf(data: DatosDelCaso): DatosDelCaso {
  const pages = Object.fromEntries(
    Object.entries(data.pages ?? {}).map(([slug, p]) => [
      slug,
      { html: p.html, ...(typeof p.title === "string" ? { title: p.title } : {}), ...(p.membersOnly === true ? { membersOnly: true } : {}) },
    ]),
  );
  return { html: data.html ?? "", ...(Object.keys(pages).length > 0 ? { pages } : {}) };
}

/** Where the cases live: outside the repo, always. */
export function casesDir(): string {
  return process.env.OPENLEN_BENCH_CASES_DIR ?? path.join(os.homedir(), ".openlen", "bench-cases");
}

const fileOf = (projectId: string) => path.join(casesDir(), `${projectId}.json`);

export function writeFetchedCase(c: FetchedCase): void {
  fs.mkdirSync(casesDir(), { recursive: true });
  fs.writeFileSync(fileOf(c.projectId), JSON.stringify(c, null, 2));
}

export function readFetchedCase(projectId: string): FetchedCase {
  const file = fileOf(projectId);
  if (!fs.existsSync(file)) throw new Error(`el caso ${projectId} no está traído en ${casesDir()}: npm run bench:clientes:fetch`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as FetchedCase;
}
