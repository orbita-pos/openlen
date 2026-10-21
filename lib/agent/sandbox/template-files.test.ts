// @vitest-environment node
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SYSTEM_TOP_LEVEL } from "./paths";
import { BRIDGED_PROGRAMS, bridgeScript, manifestScript, templateFiles, wrapperScript } from "./template-files";

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
      ["/opt/openlen/bin/openlen-bridge", "/opt/openlen/bin/openlen-manifest", ...BRIDGED_PROGRAMS.map((p) => `/opt/openlen/bin/${p}`)].sort(),
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
