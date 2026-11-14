/**
 * THE RETURN BENCH's server (spec local 2026-11-13-conversar-todo-el-mes, §8.2): the dev server of OpenLen,
 * prepared as every Len-Bench server is (lib/len-bench/entorno.ts: nothing that reaches R2, Cloudflare,
 * Resend or Exa; turns recorded; the fixed web) and started with the environment of ONE step of the bench
 * (lib/len-bench/cold-return/arms.ts):
 *
 *   npm run bench:return:server -- --config=build   → the cases are built; the summary's job goes to a file
 *   npm run bench:return:server -- --config=today   → run --arm=today
 *   npm run bench:return:server -- --config=new     → run --arm=trim and --arm=trim_summary
 *
 * `--dir` is the bench's folder if it is not the default one (it must be the same the runner is given).
 * webpack, never Turbopack. It needs a LOCAL throwaway database in DATABASE_URL — the runner refuses any
 * other — and the same AUTH_SECRET the runner has. Stop the usual dev server first: same port, same .next.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { SERVER_ENV, type ServerConfig } from "@/lib/len-bench/cold-return/arms";
import { BENCH_DIR, capturesDir } from "@/lib/len-bench/cold-return/store";
import { DIR_GRABACIONES, DIR_PUBLICADAS, entornoDeLenBench, PUERTO_LEN_BENCH, variablesApagadas } from "@/lib/len-bench/entorno";

function arg(name: string): string | undefined {
  const found = process.argv.find((a) => a === name || a.startsWith(`${name}=`));
  return found?.includes("=") ? found.slice(found.indexOf("=") + 1) : found ? "" : undefined;
}

function main(): void {
  const config = arg("--config") as ServerConfig | undefined;
  if (!config || !(config in SERVER_ENV)) throw new Error(`--config must be one of ${Object.keys(SERVER_ENV).join(", ")}`);
  const root = process.cwd();
  const dir = arg("--dir") ?? BENCH_DIR;
  fs.mkdirSync(path.join(root, DIR_PUBLICADAS), { recursive: true });
  fs.mkdirSync(path.join(root, DIR_GRABACIONES), { recursive: true });

  const env = entornoDeLenBench(process.env, root);
  // The step's own switches. One set REPLACES another's: a variable only another step sets must not survive
  // from the shell this was started in.
  for (const set of Object.values(SERVER_ENV)) for (const key of Object.keys(set)) delete env[key];
  for (const [key, value] of Object.entries(SERVER_ENV[config])) env[key] = key === "OPENLEN_IDLE_SUMMARY_CAPTURE_DIR" ? path.resolve(capturesDir(dir)) : value;
  // A second lock on the box of the real terminal, besides OPENLEN_SANDBOX=0: without its key nothing opens.
  env.E2B_API_KEY = "";

  console.log(`[return-bench] config ${config} · port ${PUERTO_LEN_BENCH}`);
  for (const key of Object.keys(SERVER_ENV[config])) console.log(`[return-bench] ${key}=${env[key]}`);
  console.log(`[return-bench] switched off: ${variablesApagadas(root).join(", ")}, E2B_API_KEY`);
  if (!env.DATABASE_URL || !/@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(env.DATABASE_URL)) {
    throw new Error("DATABASE_URL is not a local database: the return bench only runs on a throwaway one on this machine");
  }

  // `next` from wherever this checkout resolves it (a worktree has no node_modules of its own).
  const next = createRequire(path.join(root, "package.json")).resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [next, "dev", "-p", String(PUERTO_LEN_BENCH)], { env: env as NodeJS.ProcessEnv, stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
}

main();
