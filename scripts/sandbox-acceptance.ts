// scripts/sandbox-acceptance.ts
// Acceptance of Len's real terminal against a REAL E2B box (spec local 2026-10-21-real-terminal-e2b,
// plan task 14). Every command goes through `toolBash`, the same path and guards as Len's, on a
// throwaway account and project in a LOCAL database (it refuses any other). Says OK/FAIL per check.
//
// Needs E2B_API_KEY, the template built (npm run sandbox:template) and DATABASE_URL of a local
// throwaway Postgres with the schema. Costs a few cents of E2B.
//
// Run: DATABASE_URL=postgres://… npm run sandbox:acceptance

import { randomUUID } from "node:crypto";

import { desc, eq, sql } from "drizzle-orm";

import { entornoDeLenBench, exigirBaseLocal, problemasDelEntorno } from "@/lib/len-bench/entorno";
import type { AgentDeps, AgentSession } from "@/lib/agent/tools";

// Len-Bench's environment BEFORE loading anything that may read it: no R2, Cloudflare, Resend or Exa.
Object.assign(process.env, entornoDeLenBench(process.env, process.cwd()));

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "OK   " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
};

let deps: AgentDeps;
let toolBash: typeof import("@/lib/agent/terminal/herramienta").toolBash;

async function bash(session: AgentSession, command: string, o: { timeout?: number; background?: boolean } = {}) {
  const started = Date.now();
  const out = await toolBash(session, deps, {
    command,
    ...(o.timeout ? { timeout: o.timeout } : {}),
    ...(o.background ? { run_in_background: true } : {}),
  });
  const text = String((out.response as Record<string, unknown>).tool_result ?? "");
  return { text, ok: out.response.ok !== false, ms: Date.now() - started };
}

const short = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 160);

async function main() {
  const problems = problemasDelEntorno(process.env, process.cwd());
  if (problems.length > 0) throw new Error(problems.join("\n"));
  await exigirBaseLocal();
  if (!process.env.E2B_API_KEY) throw new Error("E2B_API_KEY is not set");
  // The server is a warm process: its SDK and modules are loaded before a turn opens a box. Load them
  // here too, so the latency measured is the box's and not this script's first imports.
  await import("e2b");
  const { db, schema } = await import("@/lib/db");
  const { TurnSandbox } = await import("@/lib/agent/sandbox/choose");
  const { sandboxCenticredits } = await import("@/lib/agent/sandbox/billing");
  const { SANDBOX_USD_PER_SECOND } = await import("@/lib/agent/sandbox/size");
  const { sandboxCleanupDriver } = await import("@/lib/agent/sandbox/reaper");
  const herramienta = await import("@/lib/agent/terminal/herramienta");
  const { cerrarTerminalDeLaSesion } = herramienta;
  toolBash = herramienta.toolBash;
  deps = (await import("@/lib/agent/tools")).realDeps();

  const userId = randomUUID();
  const projectId = randomUUID();
  // Only this throwaway account gets the box here, whatever .env.local says.
  process.env.OPENLEN_SANDBOX_ONLY_USERS = userId;
  await db.insert(schema.users).values({ id: userId, email: `sandbox-acceptance-${userId.slice(0, 8)}@openlen.test`, name: "Sandbox acceptance" });
  await db.execute(sql`update "users" set "credits" = 20000 where "id" = ${userId}`);
  await db.insert(schema.projects).values({
    id: projectId,
    userId,
    title: "Sandbox acceptance",
    brief: "Throwaway project of the real terminal's acceptance — safe to delete.",
    data: { html: "<!doctype html><html><body><h1>Hola</h1></body></html>" },
  });
  const turn = (): AgentSession => ({ projectId, userId, turnId: randomUUID(), mode: "len", app: null }) as AgentSession;
  let sandboxId: string | null = null;

  try {
    // ── Latency of today's terminal, for comparison (the box switched off for this one turn).
    process.env.OPENLEN_SANDBOX = "0";
    const old = turn();
    const oldEcho = await bash(old, "echo hola");
    await cerrarTerminalDeLaSesion(old, deps);
    delete process.env.OPENLEN_SANDBOX;

    // ── A new box.
    const s1 = turn();
    const first = await bash(s1, "echo hola");
    check("1. echo hola in the box", first.text.trim() === "hola" && s1.terminal instanceof TurnSandbox && !s1.sandboxNotice, short(first.text));
    const row = await db.select().from(schema.projectSandboxes).where(eq(schema.projectSandboxes.projectId, projectId)).limit(1);
    sandboxId = row[0]?.sandboxId ?? null;

    const py = await bash(s1, `python3 -c "print(2+2)"`);
    check("2a. python3 runs", py.text.trim() === "4", short(py.text));
    const pip = await bash(s1, "pip install --quiet requests && python3 -c 'import requests; print(requests.__name__)'", { timeout: 180_000 });
    check("2b. pip install requests works", pip.ok && pip.text.includes("requests"), short(pip.text));

    const closed = await bash(s1, "curl -sS --max-time 10 https://example.com >/dev/null; echo code=$?");
    check("3a. the network is closed (example.com)", !/code=0\b/.test(closed.text), short(closed.text));
    const npm = await bash(s1, `curl -sS --max-time 20 -o /dev/null -w "%{http_code}" https://registry.npmjs.org/`);
    check("3b. the npm registry answers", npm.text.trim().startsWith("200"), short(npm.text));

    await bash(s1, "printf x > /nota.txt");
    const saved = await db.select().from(schema.projectFiles).where(eq(schema.projectFiles.projectId, projectId));
    check("4. /nota.txt is saved in Postgres", saved.some((f) => f.path === "/nota.txt" && f.content === "x"), saved.map((f) => f.path).join(", "));

    const rm = await bash(s1, "rm /index.html");
    const still = await bash(s1, "ls /index.html");
    check("5. rm of a page is refused and the page stays in the box", still.text.includes("/index.html") && !/No such file/.test(still.text), short(rm.text));

    const git = await bash(s1, "git status");
    check("6. git status is OpenLen's git", /On branch main|No commits yet|not a git repository/.test(git.text), short(git.text));

    const ro = await bash(s1, "echo x > /.openlen/a.txt");
    check("6b. /.openlen is read-only (EROFS)", /Read-only file system/i.test(ro.text), short(ro.text));

    const sleeper = await bash(s1, "sleep 1000 >/dev/null 2>&1 & echo $!");
    const pid = sleeper.text.trim().split(/\s+/).pop() ?? "";

    const moved = await bash(s1, "sleep 5; echo done", { timeout: 2000 });
    check("8. a command past its timeout goes on in the background", /background/i.test(moved.text) && moved.ok, short(moved.text));

    // ── Pause and resume.
    await cerrarTerminalDeLaSesion(s1, deps);
    const paused = await db.select().from(schema.projectSandboxes).where(eq(schema.projectSandboxes.projectId, projectId)).limit(1);
    const s2 = turn();
    const resumed = await bash(s2, "cat /nota.txt");
    const alive = await bash(s2, `kill -0 ${pid} 2>/dev/null && echo alive || echo gone`);
    check(
      "7. after pause and resume, /nota.txt is there and the sleep is alive",
      paused[0]?.state === "paused" && resumed.text.trim() === "x" && alive.text.includes("alive") && paused[0]?.sandboxId === sandboxId,
      `state=${paused[0]?.state} nota=${short(resumed.text)} sleep=${short(alive.text)}`,
    );
    await cerrarTerminalDeLaSesion(s2, deps);

    // ── The ledger (the charge is fire-and-forget inside the close: give it a moment).
    await new Promise((r) => setTimeout(r, 2000));
    const ledger = await db
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.userId, userId))
      .orderBy(desc(schema.creditLedger.createdAt));
    const boxRows = ledger.filter((l) => l.surface === "sandbox");
    const cost = boxRows.reduce((n, l) => n + Number(l.costMicroUsd ?? 0), 0);
    // The ledger keeps cost and credits, not seconds: the seconds follow from the cost at the rate.
    const seconds = cost / (SANDBOX_USD_PER_SECOND * 1e6);
    const creditsMatch = boxRows.every((l) => l.centicredits === sandboxCenticredits(Number(l.costMicroUsd ?? 0) / (SANDBOX_USD_PER_SECOND * 1e6)));
    check(
      "9. the ledger has the box, surface sandbox, at $0.000046/s",
      boxRows.length === 2 && cost > 0 && boxRows.every((l) => l.provider === "e2b") && creditsMatch,
      `rows=${boxRows.length} cost=${cost}µ$ ≈ ${seconds.toFixed(1)} s · ${boxRows.map((l) => `${l.centicredits} cc ${l.provider}/${l.model}`).join(", ")}`,
    );

    // ── Latency (spec §5): a new box ≤ 5 s; a paused one ≤ 2 s more than today's terminal. Reported, not
    // blocking (plan task 14): a new box happens once per project, a paused one on every turn.
    const newBox = first.ms;
    const pausedBox = resumed.ms;
    const onTime = newBox <= 5000 && pausedBox - oldEcho.ms <= 2000;
    console.log(
      `${onTime ? "OK   " : "LATE "} 10. latency — today's terminal ${oldEcho.ms} ms · new box ${newBox} ms (goal ≤ 5000) · paused box ${pausedBox} ms (goal ≤ ${oldEcho.ms + 2000})`,
    );
  } finally {
    if (sandboxId) await sandboxCleanupDriver()?.kill(sandboxId).catch(() => undefined);
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await db.delete(schema.creditLedger).where(eq(schema.creditLedger.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} OK`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ""}` : e);
  process.exit(1);
});
