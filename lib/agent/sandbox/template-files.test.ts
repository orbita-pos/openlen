// @vitest-environment node
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MAX_FOLDER_FILE_BYTES } from "@/lib/agent/ficheros/folder";

import { SYSTEM_TOP_LEVEL } from "./paths";
import { SANDBOX_TEMPLATE } from "./config";
import { BIG_FILE_PREFIX, BRIDGED_PROGRAMS, PLAYWRIGHT_BROWSERS, PLAYWRIGHT_DIR, PLAYWRIGHT_VERSION, bridgeScript, manifestScript, templateFiles, wrapperScript } from "./template-files";

// The scripts run in the box with python3; here, with whatever Python this machine has.
const PYTHON = ["python3", "python"].find((p) => spawnSync(p, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8" }).stdout?.trim() === "3");

function tempRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "openlen-manifest-"));
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, ...path.split("/").filter(Boolean));
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

describe("the box's scripts", () => {
  it("the manifest skips every system folder", () => {
    const script = manifestScript();
    for (const top of SYSTEM_TOP_LEVEL) expect(script).toContain(JSON.stringify(top));
    expect(script).toContain('".openlen"');
  });

  it("every bridged program goes through the bridge", () => {
    for (const p of BRIDGED_PROGRAMS) expect(wrapperScript(p)).toContain(`openlen-bridge ${p} "$@"`);
    expect(BRIDGED_PROGRAMS).toEqual(["git", "supabase", "tsc", "eslint", "vitest", "npm", "npx", "curl"]);
  });

  it("the template carries the two scripts and one wrapper per program, executable", () => {
    const files = templateFiles();
    expect(Object.keys(files).sort()).toEqual(
      ["/opt/openlen/bin/openlen-bridge", "/opt/openlen/bin/openlen-manifest", "/opt/openlen/bin/playwright", ...BRIDGED_PROGRAMS.map((p) => `/opt/openlen/bin/${p}`)].sort(),
    );
    for (const f of Object.values(files)) expect(f.mode).toBe(0o755);
  });

  it("the template has Python, Node, git and the usual tools, and copies the scripts into /opt/openlen/bin", async () => {
    const { defineTemplate, APT_PACKAGES } = await import("@/infra/e2b/openlen-terminal/template");
    const calls: [string, unknown[]][] = [];
    const builder: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ["fromUbuntuImage", "aptInstall", "runCmd", "copy"]) builder[m] = (...a: unknown[]) => (calls.push([m, a]), builder);
    defineTemplate(() => builder as never, "infra/e2b/openlen-terminal/.build");
    for (const p of ["python3", "python3-pip", "git", "ripgrep", "jq", "sqlite3", "curl", "unzip"]) expect(APT_PACKAGES).toContain(p);
    expect(calls).toContainEqual(["copy", ["infra/e2b/openlen-terminal/.build", "/opt/openlen/bin"]]);
    expect(calls.some(([m, a]) => m === "runCmd" && String(a[0]).includes("setup_22.x"))).toBe(true);
    expect(calls.some(([m, a]) => m === "runCmd" && String(a[0]).includes("/run/openlen/requests"))).toBe(true);
  });

  it("`npx playwright` and `playwright` run the template's own version, never one npx would fetch", () => {
    const npx = wrapperScript("npx");
    expect(npx).toContain(`"$1" = "playwright"`);
    expect(npx).toContain(`${PLAYWRIGHT_DIR}/node_modules/.bin/playwright`);
    expect(npx).toContain(`openlen-bridge npx "$@"`);
    expect(templateFiles()[`/opt/openlen/bin/playwright`]?.content).toContain(`exec ${PLAYWRIGHT_DIR}/node_modules/.bin/playwright "$@"`);
  });

  it("the template has Playwright at a fixed version with its Chromium, and certutil for E2B's authority", async () => {
    const { defineTemplate, APT_PACKAGES } = await import("@/infra/e2b/openlen-terminal/template");
    const ran: string[] = [];
    const builder: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ["fromUbuntuImage", "aptInstall", "copy"]) builder[m] = () => builder;
    builder.runCmd = (c: unknown) => (ran.push(String(c)), builder);
    defineTemplate(() => builder as never, "x");
    expect(APT_PACKAGES).toContain("libnss3-tools");
    const install = ran.find((c) => c.includes("@playwright/test@"))!;
    expect(install).toContain(`@playwright/test@${PLAYWRIGHT_VERSION}`);
    expect(install).toContain(`PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS}`);
    expect(install).toContain("install --with-deps chromium");
    expect(SANDBOX_TEMPLATE).toBe("openlen-terminal-v2");
  });

  it("the box's user can work at / (the project's root), pip installs and npm -g goes to its home", async () => {
    const { defineTemplate } = await import("@/infra/e2b/openlen-terminal/template");
    const ran: string[] = [];
    const builder: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ["fromUbuntuImage", "aptInstall", "copy"]) builder[m] = () => builder;
    builder.runCmd = (c: unknown) => (ran.push(String(c)), builder);
    defineTemplate(() => builder as never, "x");
    const all = ran.join("\n");
    // Measured in a real box on 21/10: / was root's 755, so `printf x > /nota.txt` and `rm` failed; with
    // 1777 (sticky) E2B's file service, as root, could no longer reopen the user's files there
    // (protected_regular). The user owns /, without the sticky bit.
    expect(all).toContain("chown user:user /");
    expect(all).not.toContain("1777");
    // Ubuntu 24.04 refuses pip outside a venv (PEP 668).
    expect(all).toContain("break-system-packages");
    expect(all).toContain("/home/user/.npm-global");
  });

  it.skipIf(!PYTHON)("the manifest hashes the project's files and the person's memory, nothing else", () => {
    const root = tempRoot({
      "/index.html": "a",
      "/src/main.tsx": "b",
      "/usr/bin/x": "c",
      "/tmp/y": "d",
      "/.openlen/docs/a.md": "e",
      "/home/user/.len/LEN.md": "f",
      "/home/user/.bashrc": "g",
    });
    const r = spawnSync(PYTHON!, ["-c", manifestScript()], { encoding: "utf8", env: { ...process.env, OPENLEN_ROOT: root } });
    expect(r.status, r.stderr).toBe(0);
    const manifest = JSON.parse(r.stdout) as Record<string, string>;
    expect(Object.keys(manifest).sort()).toEqual(["/home/user/.len/LEN.md", "/index.html", "/src/main.tsx"]);
    expect(manifest["/index.html"]).toBe("ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
  });

  it.skipIf(!PYTHON)("the manifest skips node_modules, .git and __pycache__ at any depth", () => {
    const root = tempRoot({
      "/scripts/gen.js": "a",
      "/scripts/node_modules/sharp/index.js": "b",
      "/vendor/lib/.git/config": "c",
      "/tools/__pycache__/x.pyc": "d",
    });
    const r = spawnSync(PYTHON!, ["-c", manifestScript()], { encoding: "utf8", env: { ...process.env, OPENLEN_ROOT: root } });
    expect(r.status, r.stderr).toBe(0);
    expect(Object.keys(JSON.parse(r.stdout) as Record<string, string>)).toEqual(["/scripts/gen.js"]);
  });

  it.skipIf(!PYTHON)("a file over the cap is not read: its entry says so, with its size", () => {
    const big = "x".repeat(MAX_FOLDER_FILE_BYTES + 1);
    const root = tempRoot({ "/data/big.csv": big, "/index.html": "a" });
    const r = spawnSync(PYTHON!, ["-c", manifestScript()], { encoding: "utf8", env: { ...process.env, OPENLEN_ROOT: root } });
    expect(r.status, r.stderr).toBe(0);
    const manifest = JSON.parse(r.stdout) as Record<string, string>;
    expect(manifest["/data/big.csv"]).toMatch(new RegExp(`^${BIG_FILE_PREFIX}${MAX_FOLDER_FILE_BYTES + 1}:`));
    expect(manifest["/index.html"]).toBe("ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
  });

  it.skipIf(!PYTHON)("the bridge leaves a request and prints the answer with its exit code", async () => {
    const dir = mkdtempSync(join(tmpdir(), "openlen-bridge-"));
    mkdirSync(join(dir, "requests"));
    mkdirSync(join(dir, "responses"));
    const child = spawn(PYTHON!, ["-c", bridgeScript(), "git", "status", "--short"], { env: { ...process.env, OPENLEN_BRIDGE_DIR: dir } });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    let name: string | undefined;
    for (let i = 0; i < 100 && !name; i++) {
      await new Promise((r) => setTimeout(r, 50));
      name = readdirSync(join(dir, "requests")).find((f) => f.endsWith(".json"));
    }
    expect(name).toBeDefined();
    const req = JSON.parse(spawnSync(PYTHON!, ["-c", `print(open(r"${join(dir, "requests", name!)}").read())`], { encoding: "utf8" }).stdout);
    expect(req).toMatchObject({ program: "git", args: ["status", "--short"] });
    writeFileSync(join(dir, "responses", `${req.id}.json`), JSON.stringify({ stdout: "M index.html\n", stderr: "", exitCode: 3 }));
    const code = await new Promise<number | null>((r) => child.on("close", r));
    expect(stdout.replace(/\r\n/g, "\n")).toBe("M index.html\n");
    expect(code).toBe(3);
  });
});
