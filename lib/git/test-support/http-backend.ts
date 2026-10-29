// A real git remote over smart HTTP for the differential tests (spec local 2026-10-28-ficheros-al-nivel-de-claude-code,
// §8): bare repositories under a temporary folder, served on 127.0.0.1 by `git http-backend` (git's own CGI), with
// receive-pack on and, if asked, Basic auth required. The real git and ours both talk to it.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { allowEgressOrigin } from "@/lib/security/egress-proxy";

import { AUTHOR } from "./real-git";

/** git without any of this machine's configuration, as the real-git harness runs it. */
function cleanEnv(home: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: home,
    USERPROFILE: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: path.join(home, ".gitconfig"),
    GIT_AUTHOR_NAME: AUTHOR.name,
    GIT_AUTHOR_EMAIL: AUTHOR.email,
    GIT_COMMITTER_NAME: AUTHOR.name,
    GIT_COMMITTER_EMAIL: AUTHOR.email,
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
    GIT_TERMINAL_PROMPT: "0",
  };
}

export class GitHttpServer {
  readonly root = mkdtempSync(path.join(os.tmpdir(), "len-git-remote-"));
  private readonly home = mkdtempSync(path.join(os.tmpdir(), "len-git-remote-home-"));
  private server: http.Server | null = null;
  private closeEgress: (() => void) | null = null;
  port = 0;
  /** "user:password" the server demands in Basic auth, or null for none. */
  requireAuth: string | null = null;
  /** One URL, two repositories: OpenLen's git (its User-Agent says "OpenLen") is served from `<root>/ours`, the real
   *  git from `<root>/real`. Commits that carry the URL (a pull's merge) then come out the same on both sides. */
  splitByAgent = false;

  /** A bare repository `<name>.git`, with receive-pack on. */
  bare(name: string, side?: "real" | "ours"): string {
    const dir = path.join(this.root, ...(side ? [side] : []), `${name}.git`);
    this.git(["init", "-q", "--bare", "-b", "main", dir]);
    this.git(["config", "http.receivepack", "true"], dir);
    return dir;
  }

  /** git in a folder of this server (a bare repository, or a clone the test makes), for what stays local: it blocks
   *  the event loop, so a command that talks to this server must go through `remoteGit`. */
  git(args: readonly string[], cwd: string = this.root, input?: string): { stdout: string; stderr: string; exitCode: number } {
    const r = spawnSync("git", [...args], { cwd, env: cleanEnv(this.home), encoding: "utf8", input });
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.status ?? 1 };
  }

  /** git that talks to this server (clone, push, fetch, ls-remote): without blocking the server it talks to. */
  remoteGit(args: readonly string[], cwd: string = this.root): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const child = spawn("git", [...args], { cwd, env: cleanEnv(this.home) });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on("data", (c: Buffer) => out.push(c));
      child.stderr.on("data", (c: Buffer) => err.push(c));
      child.on("close", (code) => resolve({ stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), exitCode: code ?? 1 }));
    });
  }

  url(name: string): string {
    return `http://127.0.0.1:${this.port}/${name}.git`;
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const auth = req.headers.authorization;
        const user = auth?.startsWith("Basic ") ? Buffer.from(auth.slice(6), "base64").toString("utf8") : null;
        if (this.requireAuth !== null && user !== this.requireAuth) {
          res.writeHead(401, { "WWW-Authenticate": 'Basic realm="test"' });
          res.end();
          return;
        }
        const u = new URL(req.url ?? "/", "http://127.0.0.1");
        const body = Buffer.concat(chunks);
        const env: NodeJS.ProcessEnv = {
          ...cleanEnv(this.home),
          GIT_PROJECT_ROOT: this.splitByAgent ? path.join(this.root, String(req.headers["user-agent"] ?? "").includes("OpenLen") ? "ours" : "real") : this.root,
          GIT_HTTP_EXPORT_ALL: "1",
          PATH_INFO: decodeURIComponent(u.pathname),
          QUERY_STRING: u.search.replace(/^\?/, ""),
          REQUEST_METHOD: req.method ?? "GET",
          CONTENT_TYPE: req.headers["content-type"] ?? "",
          CONTENT_LENGTH: String(body.length),
          REMOTE_USER: user?.split(":")[0] ?? "anonymous",
          REMOTE_ADDR: "127.0.0.1",
          ...(req.headers["git-protocol"] ? { HTTP_GIT_PROTOCOL: String(req.headers["git-protocol"]) } : {}),
        };
        const cgi = spawn("git", ["http-backend"], { env });
        const out: Buffer[] = [];
        cgi.stdout.on("data", (c: Buffer) => out.push(c));
        cgi.on("close", () => {
          const all = Buffer.concat(out);
          const split = all.indexOf("\r\n\r\n");
          const head = all.subarray(0, split).toString("latin1").split("\r\n");
          let status = 200;
          const headers: Record<string, string> = {};
          for (const line of head) {
            const colon = line.indexOf(":");
            const name = line.slice(0, colon).trim();
            const value = line.slice(colon + 1).trim();
            if (name.toLowerCase() === "status") status = Number(value.split(" ")[0]);
            else headers[name] = value;
          }
          res.writeHead(status, headers);
          res.end(all.subarray(split + 4));
        });
        cgi.stdin.end(body);
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as AddressInfo).port;
    // OpenLen's remotes refuse private addresses; this one test server is let through, the way the Chromium proxy
    // lets its measuring server through.
    this.closeEgress = allowEgressOrigin(`127.0.0.1:${this.port}`);
  }

  async dispose(): Promise<void> {
    this.closeEgress?.();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    rmSync(this.root, { recursive: true, force: true });
    rmSync(this.home, { recursive: true, force: true });
  }
}
