// The real git binary in a throwaway repository, with a fixed author and clock: what every
// differential test compares our git against (spec local 2026-10-15-git-for-len, "Pruebas").
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const AUTHOR = { name: "Ana Lopez", email: "ana@users.noreply.openlen.com" } as const;
/** 2025-10-15 03:46:40 UTC: every test clock starts here. */
export const START = 1_760_500_000;

export interface GitOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export function requireRealGit(): void {
  const r = spawnSync("git", ["--version"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("These tests compare against the real git binary, and `git` is not on PATH.");
}

export class RealRepo {
  readonly dir: string;
  private readonly home: string;
  /** Seconds since the epoch, for the next author and committer date. */
  timestamp = START;

  constructor() {
    requireRealGit();
    this.home = mkdtempSync(path.join(os.tmpdir(), "len-git-home-"));
    writeFileSync(path.join(this.home, ".gitconfig"), "");
    this.dir = mkdtempSync(path.join(os.tmpdir(), "len-git-"));
    this.git(["init", "-q", "-b", "main"]);
    this.git(["config", "core.autocrlf", "false"]);
    this.git(["config", "core.filemode", "false"]);
    // OpenLen's git doesn't detect renames (a deliberate difference, ledgered): compare like for like.
    this.git(["config", "diff.renames", "false"]);
    this.git(["config", "status.renames", "false"]);
  }

  private env(): NodeJS.ProcessEnv {
    const date = `${this.timestamp} +0000`;
    return {
      NODE_ENV: "test",
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      HOME: this.home,
      USERPROFILE: this.home,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: path.join(this.home, ".gitconfig"),
      GIT_AUTHOR_NAME: AUTHOR.name,
      GIT_AUTHOR_EMAIL: AUTHOR.email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: AUTHOR.name,
      GIT_COMMITTER_EMAIL: AUTHOR.email,
      GIT_COMMITTER_DATE: date,
      LANG: "C",
      LC_ALL: "C",
      TZ: "UTC",
      GIT_PAGER: "cat",
      PAGER: "cat",
      GIT_EDITOR: "false",
      GIT_TERMINAL_PROMPT: "0",
    };
  }

  git(args: readonly string[], o: { readonly cwd?: string; readonly input?: string } = {}): GitOutput {
    const r = spawnSync("git", [...args], {
      cwd: o.cwd ? path.join(this.dir, o.cwd) : this.dir,
      env: this.env(),
      input: o.input,
      encoding: "utf8",
    });
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.status ?? 1 };
  }

  /** Repository paths ("src/App.tsx"); `null` deletes the file. */
  write(files: Readonly<Record<string, string | null>>): void {
    for (const [p, content] of Object.entries(files)) {
      const abs = path.join(this.dir, ...p.split("/"));
      if (content === null) rmSync(abs, { force: true });
      else {
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, content);
      }
    }
  }

  /** Every file outside .git: repository path → content. */
  snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (dir: string, prefix: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (prefix === "" && entry.name === ".git") continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs, `${prefix}${entry.name}/`);
        else out[`${prefix}${entry.name}`] = readFileSync(abs, "utf8");
      }
    };
    walk(this.dir, "");
    return out;
  }

  dispose(): void {
    rmSync(this.dir, { recursive: true, force: true });
    rmSync(this.home, { recursive: true, force: true });
  }
}
