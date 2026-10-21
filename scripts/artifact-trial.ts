/**
 * THE PAID LEN 3.0 TRIAL (plan B): the central request, end to end, with the
 * real model and real providers, then the corrections that must reuse what is
 * already made instead of paying for it again.
 *
 *   1. «Mañana presento mi app…» → slides, a silent video, two images and a
 *      scenario dashboard, each its own deliverable, every one ready.
 *   2. Correct the deck: new cover title, the SECOND image — no new image call.
 *   3. Add a narration to the video → one speech call, the video gets AAC.
 *   4. Change the last scene's text → a new video, the SAME voice, no new call.
 *
 * Len runs on the Len-Bench server (http://localhost:3007, started separately
 * with the artifact environment and the throwaway database). The trial worker
 * (scripts/artifact-trial-worker.ts) renders through the WSL bridge and asks
 * the budget guard before every paid call. Dry by default; spending needs
 * --yes and --cap-usd. Never runs on anything but a local throwaway database.
 *
 *   npx tsx --tsconfig tsconfig.eval.json --require ./scripts/test-node-server-only-shim.cjs \
 *     scripts/artifact-trial.ts --evidence <new directory> --cap-usd 3 --yes [--node <linux node>] [--only s1,s2]
 *
 * --project <id> picks up an earlier trial's project instead of creating one (with --only, to repeat a step
 * after a fix): what that project already spent counts against the cap.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { arrancarCorredor, TIMEOUT_TURNO_MS } from "../lib/len-bench/arranque";
import { BASE_LEN_BENCH, DIR_GRABACIONES } from "../lib/len-bench/entorno";
import { esperarUsdDeProyecto } from "../lib/len-bench/coste";
import { enviarTurno, herramientasDeLen, textoDeLen } from "../lib/len-bench/sesion";
import { createThrowawayProject } from "../lib/len-bench/proyecto-de-eval";
import { ARTIFACT_SELECTION_CASES } from "../lib/len-bench/casos/artifacts";
import { getChatMessages } from "../lib/projects/chat";
import { accionesAlRecargar, historialParaElAgente } from "../lib/chat/historial-del-agente";
import { TRIAL_ANSWER, TRIAL_PROJECT_BRIEF, TRIAL_PROJECT_TITLE, trialApp } from "../lib/artifacts/acceptance/trial-project";
import { createArtifactCoreRuntime } from "../lib/artifacts/runtime-core";
import { bundleBridge, createBridge, wsl } from "../lib/artifacts/acceptance/bridge-client";
import { requireTrialDatabase, trialSpend, type PaidKind, type TrialAttempt, type TrialLimits } from "../lib/artifacts/acceptance/trial-budget";
import type { DatosDelCaso } from "../lib/len-bench/tipos";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const distro = arg("--distro") ?? "Ubuntu-24.04";
const only = arg("--only")?.split(",").map((s) => s.trim());
const resumeProject = arg("--project");

/** Generous on purpose: an image at medium up to 1536×1024 plus reference input,
 *  a speech call up to the 120 s limit. Real costs are read from the receipts. */
const LIMITS: Omit<TrialLimits, "capUsd"> = { worstCaseUsd: { image: 0.12, audio: 0.1 }, maxCalls: { image: 6, audio: 2 } };

const caseMessage = (id: string) => {
  const found = ARTIFACT_SELECTION_CASES.find((c) => c.id === id);
  if (!found) throw new Error(`no Len-Bench artifact case ${id}`);
  return found.message;
};

// ── What the database says ───────────────────────────────────────────────────

interface ArtifactRow { id: string; kind: string; title: string; currentRevision: number; lastReadyRevision: number | null; status: string; createdAt: string; dependencies: { artifactId: string; revision: number }[] }
interface Snapshot { artifacts: ArtifactRow[]; jobs: { id: string; artifactId: string; revision: number; status: string; errorCode: string | null }[]; attempts: (TrialAttempt & { jobId: string; model: string })[] }

type Runtime = ReturnType<typeof createArtifactCoreRuntime>;

async function snapshot(runtime: Runtime, projectId: string): Promise<Snapshot> {
  const q = (text: string) => runtime.database.query(text, [projectId]);
  const artifacts = (await q(`select a."id",a."kind",a."title",a."currentRevision",a."lastReadyRevision",a."status",a."createdAt",r."dependencies" from "artifacts" a left join "artifactRevisions" r on r."artifactId"=a."id" and r."revision"=a."currentRevision" where a."projectId"=$1 order by a."createdAt",a."id"`))
    .map((r) => ({ ...r, createdAt: new Date(r.createdAt as string).toISOString(), dependencies: (r.dependencies ?? []) as ArtifactRow["dependencies"] }) as unknown as ArtifactRow);
  const jobs = (await q(`select j."id",j."artifactId",j."revision",j."status",j."errorCode" from "artifactJobs" j join "artifacts" a on a."id"=j."artifactId" where a."projectId"=$1 order by j."createdAt"`)) as unknown as Snapshot["jobs"];
  const attempts = (await q(`select "kind","model","jobId","receipt" from "artifactAttempts" where "projectId"=$1 order by "createdAt"`))
    .map((r) => ({ kind: r.kind as PaidKind, model: String(r.model), jobId: String(r.jobId), costMicroUsd: (r.receipt as { costMicroUsd?: number | null } | null)?.costMicroUsd ?? null }));
  return { artifacts, jobs, attempts };
}

const ACTIVE = ["queued", "running", "validating", "storing"];

async function waitForJobs(runtime: Runtime, projectId: string, worker: ChildProcess, timeoutMs: number): Promise<number> {
  const started = Date.now();
  for (;;) {
    const [row] = await runtime.database.query(`select count(*)::int as n from "artifactJobs" j join "artifacts" a on a."id"=j."artifactId" where a."projectId"=$1 and j."status"=any($2::text[])`, [projectId, ACTIVE]);
    if (Number(row?.n ?? 0) === 0) return Date.now() - started;
    if (worker.exitCode !== null) throw new Error(`the trial worker exited (${worker.exitCode}) with jobs still pending`);
    if (Date.now() - started > timeoutMs) throw new Error(`jobs still pending after ${Math.round(timeoutMs / 60000)} min`);
    await new Promise((r) => setTimeout(r, 5_000));
  }
}

// ── The steps ────────────────────────────────────────────────────────────────

interface StepContext { before: Snapshot; after: Snapshot; inspect: (name: string, bytes: Uint8Array) => Promise<string>; output: (a: ArtifactRow, format: string) => Promise<Uint8Array | null> }
/** `answer`: what the owner says if Len asks, about THIS step only — a generic answer that talks about other pieces
 *  steers Len into them (trial D: s2's answer spoke of the video, and Len redid the video). */
interface Step { id: string; title: string; message: string; answer: string; reserveUsd: number; check: (c: StepContext) => Promise<string[]> }

const count = (s: Snapshot, kind: string) => s.artifacts.filter((a) => a.kind === kind).length;
const calls = (s: Snapshot, kind: PaidKind) => s.attempts.filter((a) => a.kind === kind).length;
const first = (s: Snapshot, kind: string) => s.artifacts.find((a) => a.kind === kind);
const ready = (a: ArtifactRow | undefined) => !!a && a.status === "ready" && a.lastReadyRevision === a.currentRevision;
const failedJobs = (c: StepContext) => c.after.jobs.filter((j) => !c.before.jobs.some((b) => b.id === j.id) && ["failed", "needs_attention", "cancelled"].includes(j.status)).map((j) => `job ${j.id.slice(0, 8)} ${j.status} (${j.errorCode ?? "no code"})`);

async function hasAac(c: StepContext, motion: ArtifactRow | undefined): Promise<boolean> {
  const bytes = motion ? await c.output(motion, "mp4") : null;
  if (!bytes) return false;
  const probe = JSON.parse(await c.inspect("video.mp4", bytes)) as { streams: { codec_type: string; codec_name: string }[] };
  return probe.streams.some((s) => s.codec_type === "audio" && s.codec_name === "aac");
}

const STEPS: Step[] = [
  {
    id: "s1", title: "El pedido central: presentación, video, dos imágenes y dashboard", message: caseMessage("complete-request-es"), answer: TRIAL_ANSWER, reserveUsd: 0.4,
    async check(c) {
      const problems = failedJobs(c);
      for (const [kind, n] of [["slides", 1], ["motion", 1], ["image", 2], ["dashboard", 1]] as const) if (count(c.after, kind) < n) problems.push(`${kind}: ${count(c.after, kind)}, expected at least ${n}`);
      for (const a of c.after.artifacts) if (!ready(a)) problems.push(`${a.kind} «${a.title}» is ${a.status}, not ready`);
      if (calls(c.after, "image") !== count(c.after, "image")) problems.push(`${calls(c.after, "image")} image calls for ${count(c.after, "image")} images: something was paid twice or not at all`);
      return problems;
    },
  },
  {
    id: "s2", title: "Corregir la portada con la segunda imagen, sin pagar otra", message: caseMessage("existing-piece-correction"), answer: "El título nuevo de la portada: «Turnia: tu agenda llena, sin llamadas». Lo demás, como está.", reserveUsd: 0.25,
    async check(c) {
      const problems = failedJobs(c);
      const before = first(c.before, "slides"), after = first(c.after, "slides");
      if (!after || !before || after.currentRevision <= before.currentRevision) problems.push("the deck got no new revision");
      else if (!ready(after)) problems.push(`the corrected deck is ${after.status}`);
      const images = c.after.artifacts.filter((a) => a.kind === "image");
      if (images.length >= 2 && !after?.dependencies.some((d) => d.artifactId === images[1]!.id)) problems.push(`the deck does not use the second image (${images[1]!.title}); it depends on ${JSON.stringify(after?.dependencies ?? [])}`);
      if (calls(c.after, "image") !== calls(c.before, "image")) problems.push(`${calls(c.after, "image") - calls(c.before, "image")} new image calls: the correction paid for an image again`);
      for (const a of c.before.artifacts) {
        const now = c.after.artifacts.find((x) => x.id === a.id);
        if (a.kind !== "slides" && now && now.currentRevision !== a.currentRevision) problems.push(`${a.kind} «${a.title}» changed too (revision ${a.currentRevision} → ${now.currentRevision})`);
      }
      return problems;
    },
  },
  {
    id: "s3", title: "Añadir narración al video: una sola toma de voz", answer: "La voz que tú elijas, clara y cercana. Hazlo ya.", reserveUsd: 0.3,
    message: "Ahora añade al video una narración corta en español, de unos 20 segundos, que explique qué hace la app.",
    async check(c) {
      const problems = failedJobs(c);
      const newCalls = calls(c.after, "audio") - calls(c.before, "audio");
      if (newCalls !== 1) problems.push(`${newCalls} speech calls, expected exactly 1`);
      if (!c.after.artifacts.some((a) => a.kind === "audio" && ready(a))) problems.push("no ready audio deliverable");
      const before = first(c.before, "motion"), after = first(c.after, "motion");
      if (!after || !before || after.currentRevision <= before.currentRevision || !ready(after)) problems.push("the video got no ready new revision");
      else if (!(await hasAac(c, after))) problems.push("the new video has no AAC audio track");
      return problems;
    },
  },
  {
    id: "s4", title: "Cambiar la última escena sin volver a grabar la voz", answer: "Sólo ese texto, lo demás igual.", reserveUsd: 0.25,
    message: "En el video, cambia sólo el texto de la última escena por «Pruébala hoy». No vuelvas a grabar la voz.",
    async check(c) {
      const problems = failedJobs(c);
      if (calls(c.after, "audio") !== calls(c.before, "audio")) problems.push("a new speech call: the voice was recorded again");
      if (calls(c.after, "image") !== calls(c.before, "image")) problems.push("a new image call");
      const before = first(c.before, "motion"), after = first(c.after, "motion");
      if (!after || !before || after.currentRevision <= before.currentRevision || !ready(after)) problems.push("the video got no ready new revision");
      else if (!(await hasAac(c, after))) problems.push("the new video lost its voice track");
      return problems;
    },
  },
];

// ── Main ─────────────────────────────────────────────────────────────────────

interface StepResult { id: string; title: string; message: string; asked: boolean; pass: boolean; problems: string[]; tools: string[]; reply: string; turnMs: number; jobsMs: number; lenUsdAfter: number; spendAfterUsd: number; changed: string[] }

const usd = (n: number) => `$${n.toFixed(3)}`;

async function main(): Promise<number> {
  const evidenceArg = arg("--evidence"), capArg = arg("--cap-usd"), yes = process.argv.includes("--yes");
  // Everything but Len's turns: server, session, project, kinds, worker. Free.
  const preflight = process.argv.includes("--preflight");
  const steps = STEPS.filter((s) => !only || only.includes(s.id));
  const plan = { trial: "Len 3.0 paid trial (B)", steps: steps.map((s) => ({ id: s.id, title: s.title, message: s.message, reserveUsd: s.reserveUsd })), limits: LIMITS, capUsd: capArg ? Number(capArg) : null, estimateUsd: "0.40–1.40" };
  console.log(JSON.stringify(plan, null, 2));
  if (!yes && !preflight) { console.log("Dry plan only: nothing was called. Paid execution needs --yes, --cap-usd and --evidence; --preflight checks the wiring for free."); return 0; }
  const capUsd = Number(capArg);
  if (!evidenceArg || !Number.isFinite(capUsd) || capUsd <= 0) throw new Error("paid execution needs --evidence <new directory> and --cap-usd <n>");
  const database = requireTrialDatabase(process.env.DATABASE_URL ?? "");
  const evidence = resolve(evidenceArg);
  await mkdir(evidence, { recursive: true });
  if ((await readdir(evidence)).length) throw new Error(`--evidence must be empty: ${evidence}`);
  await mkdir(join(evidence, "package"), { recursive: true });

  const runtime = createArtifactCoreRuntime(process.env);
  const storage = await runtime.storage();
  const node = arg("--node") ?? wsl(distro, ["sh", "-c", 'command -v node || echo "$HOME/.local/bin/node"']).stdout.trim();
  const image = process.env.OPENLEN_ARTIFACT_RENDERER_IMAGE ?? "openlen/artifact-renderer:1";
  const bridgeFile = join(evidence, "package", "renderer-bridge.mjs");
  const bridgeSha256 = await bundleBridge(bridgeFile);
  const bridge = createBridge({ distro, node, bridgeFile, image });

  const { owner, cookie } = await arrancarCorredor(BASE_LEN_BENCH);
  // A real app with real facts (lib/artifacts/acceptance/trial-project.ts): on an
  // empty skeleton Len rightly refuses to invent a business for paid pieces.
  const initial: DatosDelCaso = trialApp();
  let projectId: string;
  if (resumeProject) {
    const [row] = await runtime.database.query(`select "userId" from "projects" where "id"=$1`, [resumeProject]);
    if (!row || row.userId !== owner.id) throw new Error(`--project ${resumeProject} is not a trial project of the Len-Bench owner in this database`);
    projectId = resumeProject;
  } else {
    projectId = await createThrowawayProject(owner.id, "artifact-trial", initial, { title: TRIAL_PROJECT_TITLE, brief: "App de reservas para barberías" });
    await runtime.database.query(`update "projects" set "userBrief"=$2 where "id"=$1`, [projectId, TRIAL_PROJECT_BRIEF]);
  }
  const capabilities = (await (await fetch(`${BASE_LEN_BENCH}/api/projects/${projectId}/artifacts`, { headers: { cookie } })).json().catch(() => null)) as { kinds?: string[] } | null;
  const missingKinds = ["dashboard", "slides", "image", "motion", "audio"].filter((k) => !capabilities?.kinds?.includes(k));
  if (missingKinds.length) throw new Error(`the Len-Bench server does not offer: ${missingKinds.join(", ")} (start it with the artifact environment)`);

  // The worker reads the cap and Len's spend from here before every paid call.
  const statePath = join(evidence, "trial-state.json");
  // A resumed project brings what Len already spent on it: the cap is for the whole trial.
  let lenUsd = resumeProject ? (await esperarUsdDeProyecto(resolve(DIR_GRABACIONES), projectId)).usd : 0;
  const writeState = () => writeFile(statePath, JSON.stringify({ projectId, capUsd, lenUsd, limits: { ...LIMITS, capUsd } }));
  await writeState();
  const workerLog = createWriteStream(join(evidence, "worker.log"));
  const worker = spawn(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "--tsconfig", "tsconfig.eval.json", "--require", "./scripts/test-node-server-only-shim.cjs", "scripts/artifact-trial-worker.ts", "--state", statePath, "--bridge", bridgeFile, "--node", node, "--distro", distro], { env: process.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  worker.stdout!.pipe(workerLog); worker.stderr!.pipe(workerLog);

  const output = async (a: ArtifactRow, format: string): Promise<Uint8Array | null> => {
    const [rev] = await runtime.database.query(`select "outputs" from "artifactRevisions" where "artifactId"=$1 and "revision"=$2`, [a.id, a.lastReadyRevision ?? -1]);
    const file = ((rev?.outputs ?? []) as { key: string; format: string }[]).find((o) => o.format === format);
    return file ? new Uint8Array(await storage.get(file.key)) : null;
  };
  const saveOutputs = async (step: string, s: Snapshot, onlyIds?: readonly string[]) => {
    for (const [n, a] of s.artifacts.entries()) {
      if (onlyIds && !onlyIds.includes(a.id)) continue;
      if (a.lastReadyRevision === null) continue;
      const [rev] = await runtime.database.query(`select "outputs" from "artifactRevisions" where "artifactId"=$1 and "revision"=$2`, [a.id, a.lastReadyRevision]);
      const dir = join(evidence, "outputs", step, `${String(n + 1).padStart(2, "0")}-${a.kind}-r${a.lastReadyRevision}`);
      await mkdir(dir, { recursive: true });
      for (const o of (rev?.outputs ?? []) as { key: string }[]) await writeFile(join(dir, o.key.split("/").at(-1)!), await storage.get(o.key));
    }
  };

  const results: StepResult[] = [];
  let stopped: string | null = null;
  try {
    if (preflight) {
      const started = Date.now();
      while (!(await import("node:fs/promises").then((fs) => fs.readFile(join(evidence, "worker.log"), "utf8")).catch(() => "")).includes('"started"')) {
        if (worker.exitCode !== null || Date.now() - started > 120_000) throw new Error("the trial worker did not start; see worker.log");
        await new Promise((r) => setTimeout(r, 1_000));
      }
      console.log(JSON.stringify({ preflight: "ok", projectId, kinds: capabilities?.kinds, database }));
      await runtime.close();
      return 0;
    }
    for (const step of steps) {
      const before = await snapshot(runtime, projectId);
      const projected = trialSpend(lenUsd, before.attempts, { ...LIMITS, capUsd }) + step.reserveUsd;
      if (projected > capUsd) { stopped = `${step.id}: ${usd(projected)} with its reserve would pass the ${usd(capUsd)} cap`; break; }
      console.log(`${step.id} … ${step.title}`);
      const sendTurn = async (prompt: string) => {
        const turns = (await getChatMessages(projectId)).map((t) => ({ ...t, actions: accionesAlRecargar(t.actions) }));
        const { history, historyTotal, dichoAntes } = historialParaElAgente(turns, null);
        return enviarTurno({ base: BASE_LEN_BENCH, cookie, cuerpo: { projectId, prompt, turnId: randomUUID(), history, historyTotal, dichoAntes, esfuerzo: "auto", zonaHoraria: "America/Chihuahua" }, timeoutMs: TIMEOUT_TURNO_MS });
      };
      const turnStarted = Date.now();
      let events = await sendTurn(step.message);
      // A question gets ONE answer, as an owner would give, then the step is judged.
      const asked = herramientasDeLen(events).includes("ask_user_question");
      if (asked) events = [...events, ...(await sendTurn(step.answer))];
      const turnMs = Date.now() - turnStarted;
      const recorded = await esperarUsdDeProyecto(resolve(DIR_GRABACIONES), projectId);
      if (recorded.aviso) { stopped = `${step.id}: Len's spend is unknown (${recorded.aviso}); stopped before spending more`; }
      lenUsd = recorded.usd;
      await writeState();
      const jobsMs = await waitForJobs(runtime, projectId, worker, 30 * 60_000);
      const after = await snapshot(runtime, projectId);
      const changed = after.artifacts.filter((a) => before.artifacts.find((b) => b.id === a.id)?.lastReadyRevision !== a.lastReadyRevision).map((a) => a.id);
      await saveOutputs(step.id, after, changed);
      const problems = await step.check({ before, after, inspect: (name, bytes) => bridge.inspect("ffprobe", name, bytes), output });
      const error = events.find((e) => e.nombre === "error")?.datos as { code?: string; message?: string } | undefined;
      if (error) problems.push(`the turn reported an error: ${error.code ?? ""} ${error.message ?? ""}`.trim());
      const spendAfterUsd = trialSpend(lenUsd, after.attempts, { ...LIMITS, capUsd });
      results.push({ id: step.id, title: step.title, message: step.message, asked, pass: problems.length === 0, problems, tools: herramientasDeLen(events), reply: textoDeLen(events).slice(0, 1500), turnMs, jobsMs, lenUsdAfter: lenUsd, spendAfterUsd, changed });
      console.log(`${step.id} ${problems.length ? "FAIL" : "PASS"} · spend so far ${usd(spendAfterUsd)}${problems.length ? ` · ${problems.join(" | ")}` : ""}`);
      if (stopped) break;
    }
  } finally {
    worker.stdin!.end();
    await new Promise((r) => worker.once("exit", r)).catch(() => undefined);
    workerLog.end();
  }

  const final = await snapshot(runtime, projectId);
  await saveOutputs("final", final);
  const knownOpenAiUsd = final.attempts.reduce((t, a) => t + (a.costMicroUsd ?? 0) / 1e6, 0);
  const unknownCalls = final.attempts.filter((a) => a.costMicroUsd === null);
  const report = { database, projectId, owner: owner.email, capUsd, bridgeSha256, lenUsd, knownOpenAiUsd, unknownCostCalls: unknownCalls.map((a) => a.kind), guardedSpendUsd: trialSpend(lenUsd, final.attempts, { ...LIMITS, capUsd }), stopped, steps: results, artifacts: final.artifacts, attempts: final.attempts, jobs: final.jobs };
  await writeFile(join(evidence, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(join(evidence, "REPORT.md"), [
    "# Len 3.0 — ensayo pagado (B)",
    "",
    `**${results.filter((r) => r.pass).length} de ${steps.length} fases pasan.**${stopped ? ` Detenido: ${stopped}.` : ""}`,
    "",
    `Gasto: Len ${usd(lenUsd)} · OpenAI conocido ${usd(knownOpenAiUsd)}${unknownCalls.length ? ` · ${unknownCalls.length} llamada(s) sin coste informado (${unknownCalls.map((a) => a.kind).join(", ")}), contadas en el guardia a su peor caso` : ""} · total del guardia ${usd(report.guardedSpendUsd)} de un tope de ${usd(capUsd)}.`,
    "",
    "| | Fase | Mensaje | ¿Preguntó? | Herramientas de Len | Turno | Trabajos | Gasto acumulado |",
    "|---|---|---|---|---|---|---|---|",
    ...results.map((r) => `| ${r.pass ? "✅" : "❌"} | ${r.id} · ${r.title} | ${r.message} | ${r.asked ? "sí (se le contestó una vez)" : "no"} | ${r.tools.join(", ")} | ${(r.turnMs / 1000).toFixed(0)} s | ${(r.jobsMs / 1000).toFixed(0)} s | ${usd(r.spendAfterUsd)} |`),
    "",
    ...results.flatMap((r) => [`## ${r.id} · ${r.title}`, "", r.problems.length ? r.problems.map((p) => `- ❌ ${p}`).join("\n") : "- ✅ Todo lo comprobado se cumplió.", "", "Respuesta de Len:", "", `> ${r.reply.replace(/\n/g, "\n> ")}`, ""]),
    "## Entregables al final",
    "",
    "| Tipo | Título | Revisión lista | Estado |",
    "|---|---|---|---|",
    ...final.artifacts.map((a) => `| ${a.kind} | ${a.title} | ${a.lastReadyRevision ?? "—"} | ${a.status} |`),
    "",
    "Los archivos de cada fase están en `outputs/<fase>/` (sólo lo que cambió en esa fase) y el estado final en `outputs/final/`. El proyecto queda en la base desechable para abrirlo en la interfaz.",
    "",
  ].join("\n"));
  console.log(`\n${results.filter((r) => r.pass).length}/${steps.length} steps passed · ${join(evidence, "REPORT.md")}`);
  await runtime.close();
  return results.every((r) => r.pass) && !stopped ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }, (error) => { console.error(`trial could not run: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 2; });
