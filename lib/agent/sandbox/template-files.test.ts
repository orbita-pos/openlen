// @vitest-environment node
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";


import { SYSTEM_TOP_LEVEL } from "./paths";
import { SANDBOX_TEMPLATE } from "./config";
import {
  BIG_FILE_PREFIX,
  BOX_BIN,
  BRIDGED_PROGRAMS,
  PLAYWRIGHT_BROWSERS,
  PLAYWRIGHT_DIR,
  PLAYWRIGHT_RESOLVER,
  OFFICE_PYTHON_PACKAGES, PDF_FONT_FILES, PDF_PYTHON_PACKAGES, PLAYWRIGHT_VERSION,
  bridgeScript,
  manifestScript,
  playwrightResolverScript,
  templateFiles,
  BOX_TEXT_FILE_BYTES,
  wrapperScript,
} from "./template-files";

// A POSIX shell, as the box's (Git's on Windows); without one, the shell tests are skipped.
const SH = spawnSync("sh", ["-c", "printf ok"], { encoding: "utf8" }).stdout === "ok" ? "sh" : null;
// The scripts run in the box with python3; here, with whatever Python this machine has.
const PYTHON =["python3", "python"].find((p) => spawnSync(p, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8" }).stdout?.trim() === "3");

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
    expect(BRIDGED_PROGRAMS).toEqual(["git", "supabase", "stripe", "tsc", "eslint", "vitest", "npm", "npx", "curl"]);
  });

  it("the template carries the two scripts, one wrapper per program, executable, and Playwright's resolver", () => {
    const files = templateFiles();
    const programs = ["/opt/openlen/bin/openlen-bridge", "/opt/openlen/bin/openlen-manifest", "/opt/openlen/bin/playwright", ...BRIDGED_PROGRAMS.map((p) => `/opt/openlen/bin/${p}`)];
    expect(Object.keys(files).sort()).toEqual([...programs, PLAYWRIGHT_RESOLVER].sort());
    for (const p of programs) expect(files[p]!.mode).toBe(0o755);
    expect(files[PLAYWRIGHT_RESOLVER]!.content).toBe(playwrightResolverScript());
  });

  // The template's runner and the files it loads must be one Playwright (measured 21/10 in a real box:
  // «did not expect test() to be called here» with two). `runner.js` stands in for it, inside its folder.
  describe("🔴 the resolver: one Playwright with the runner that loads the project's files", () => {
    const pkg = `{ "name": "@playwright/test", "main": "index.js" }`;
    const root = tempRoot({
      "/pinned/node_modules/@playwright/test/package.json": pkg,
      "/pinned/node_modules/@playwright/test/index.js": `module.exports = { who: "pinned" };`,
      "/pinned/runner.js": `const f = process.argv[2];\nif (f.endsWith(".mjs") || f.includes("esm")) import(require("node:url").pathToFileURL(f).href);\nelse require(f);\n`,
      "/own/node_modules/@playwright/test/package.json": pkg,
      "/own/node_modules/@playwright/test/index.js": `module.exports = { who: "own" };`,
      "/own/node_modules/a-lib/index.js": `module.exports = require("@playwright/test").who;`,
      "/own/test.js": `console.log(require("@playwright/test").who, require("a-lib"));`,
      "/esm/package.json": `{ "type": "module" }`,
      "/esm/test.js": `import pw from "@playwright/test";\nconsole.log(pw.who);`,
      "/bare/test.js": `console.log(require("@playwright/test").who);`,
    });
    const resolver = join(root, "resolver.cjs");
    writeFileSync(resolver, playwrightResolverScript(join(root, "pinned")));
    const node = (...files: string[]) => {
      const r = spawnSync(process.execPath, ["--require", resolver, ...files.map((f) => join(root, f))], { encoding: "utf8" });
      return { out: r.stdout.trim(), err: r.stderr };
    };

    it("under the template's runner, a project's file gets the template's even next to its own copy; a package keeps its own", () => {
      expect(node("pinned/runner.js", "own/test.js")).toEqual({ out: "pinned own", err: "" });
      expect(node("pinned/runner.js", "esm/test.js")).toEqual({ out: "pinned", err: "" });
    });

    it("under its own runner (npm test, ./node_modules/.bin/playwright), a project with its own copy keeps it", () => {
      expect(node("own/test.js")).toEqual({ out: "own own", err: "" });
    });

    it("a project without one gets the template's, ESM too (NODE_PATH only reaches require)", () => {
      expect(node("esm/test.js")).toEqual({ out: "pinned", err: "" });
      expect(node("bare/test.js")).toEqual({ out: "pinned", err: "" });
    });
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

  it("`playwright` runs the template's own version", () => {
    expect(templateFiles()[`/opt/openlen/bin/playwright`]?.content).toContain(`exec ${PLAYWRIGHT_DIR}/node_modules/.bin/playwright "$@"`);
  });

  // Measured 21/10 in a real box: `npx -y playwright test` went to npx, which runs a Playwright of its own.
  it.skipIf(!SH)("🔴 `npx playwright …` is the template's, also with -y and at any @version; the rest goes to the bridge", () => {
    const script = wrapperScript("npx").split(`${PLAYWRIGHT_DIR}/node_modules/.bin/playwright`).join("echo PIN").split(`${BOX_BIN}/openlen-bridge`).join("echo BRIDGE");
    const file = join(mkdtempSync(join(tmpdir(), "openlen-npx-")), "npx");
    writeFileSync(file, script);
    const npx = (...args: string[]) => spawnSync(SH!, [file.replace(/\\/g, "/"), ...args], { encoding: "utf8" }).stdout.trim();
    expect(npx("playwright", "test")).toBe("PIN test");
    expect(npx("-y", "playwright", "test")).toBe("PIN test");
    expect(npx("--yes", "playwright@latest", "test", "--headed")).toBe("PIN test --headed");
    expect(npx("@playwright/test", "test")).toBe("PIN test");
    expect(npx("-p", "playwright", "playwright", "test")).toBe("BRIDGE npx -p playwright playwright test");
    expect(npx("-y", "create-vite")).toBe("BRIDGE npx -y create-vite");
    expect(npx("tsx", "a.ts")).toBe("BRIDGE npx tsx a.ts");
    expect(npx()).toBe("BRIDGE npx");
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
    expect(SANDBOX_TEMPLATE).toBe("openlen-terminal-v4");
  });

  // THE PDF SKILL (spec local 2026-10-27-len-pdf-skill, §4.4 and §4.7): qpdf, tesseract in Len's ten
  // languages, fonts reportlab can embed for Japanese, Korean and Chinese, and the PDF Python packages.
  it("the template installs qpdf, tesseract with the ten languages and the CJK fonts", async () => {
    const { APT_PACKAGES } = await import("@/infra/e2b/openlen-terminal/template");
    for (const p of [
      "qpdf", "tesseract-ocr", "tesseract-ocr-spa", "tesseract-ocr-por", "tesseract-ocr-fra", "tesseract-ocr-deu", "tesseract-ocr-ita",
      "tesseract-ocr-jpn", "tesseract-ocr-kor", "tesseract-ocr-chi-sim", "tesseract-ocr-nld",
      "fonts-ipafont-gothic", "fonts-nanum", "fonts-wqy-zenhei",
    ]) expect(APT_PACKAGES).toContain(p);
  });

  it("the template pins the pdf python packages", async () => {
    const { defineTemplate } = await import("@/infra/e2b/openlen-terminal/template");
    const ran: string[] = [];
    const builder: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ["fromUbuntuImage", "aptInstall", "copy"]) builder[m] = () => builder;
    builder.runCmd = (c: unknown) => (ran.push(String(c)), builder);
    defineTemplate(() => builder as never, "x");
    const pip = ran.find((c) => c.includes("pip install"))!;
    for (const [name, version] of Object.entries(PDF_PYTHON_PACKAGES)) expect(pip).toContain(`${name}==${version}`);
    expect(Object.keys(PDF_PYTHON_PACKAGES).sort()).toEqual(["cryptography", "pdfplumber", "pypdf", "reportlab"]);
  });

  it("names a font file for every script Len writes in", () => {
    expect(Object.keys(PDF_FONT_FILES).sort()).toEqual(["ja", "ko", "latin", "zh"]);
    for (const path of Object.values(PDF_FONT_FILES)) expect(path).toMatch(/^\/usr\/share\/fonts\/.+\.tt[fc]$/);
  });

  // OFFICE SKILLS (spec local 2026-10-26-len-skills, §4.7): what DeepSeek's office skills need, in the box.
  it("the template installs LibreOffice, its Python bridge and poppler", async () => {
    const { APT_PACKAGES } = await import("@/infra/e2b/openlen-terminal/template");
    for (const p of ["libreoffice-calc", "libreoffice-writer", "libreoffice-impress", "python3-uno", "poppler-utils", "fonts-dejavu"]) expect(APT_PACKAGES).toContain(p);
  });

  it("the template pins the office python packages", async () => {
    const { defineTemplate } = await import("@/infra/e2b/openlen-terminal/template");
    const ran: string[] = [];
    const builder: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ["fromUbuntuImage", "aptInstall", "copy"]) builder[m] = () => builder;
    builder.runCmd = (c: unknown) => (ran.push(String(c)), builder);
    defineTemplate(() => builder as never, "x");
    const pip = ran.find((c) => c.includes("pip install"))!;
    for (const [name, version] of Object.entries(OFFICE_PYTHON_PACKAGES)) expect(pip).toContain(`${name}==${version}`);
    expect(Object.keys(OFFICE_PYTHON_PACKAGES).sort()).toEqual(["openpyxl", "pandas", "python-docx", "python-pptx"]);
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
    const big = "x".repeat(BOX_TEXT_FILE_BYTES + 1);
    const root = tempRoot({ "/data/big.csv": big, "/index.html": "a" });
    const r = spawnSync(PYTHON!, ["-c", manifestScript()], { encoding: "utf8", env: { ...process.env, OPENLEN_ROOT: root } });
    expect(r.status, r.stderr).toBe(0);
    const manifest = JSON.parse(r.stdout) as Record<string, string>;
    expect(manifest["/data/big.csv"]).toMatch(new RegExp(`^${BIG_FILE_PREFIX}${BOX_TEXT_FILE_BYTES + 1}:`));
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

  it.skipIf(!PYTHON)("asked for a line, the bridge reads ONE line of its stdin and asks again with it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "openlen-bridge-"));
    mkdirSync(join(dir, "requests"));
    mkdirSync(join(dir, "responses"));
    const child = spawn(PYTHON!, ["-c", bridgeScript(), "stripe", "delete", "/v1/webhook_endpoints/we_1"], { env: { ...process.env, OPENLEN_BRIDGE_DIR: dir } });
    child.stdin.write("yes\nno\n");
    child.stdin.end();
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    const answered = new Set<string>();
    const nextRequest = async () => {
      for (let i = 0; i < 100; i++) {
        const name = readdirSync(join(dir, "requests")).find((f) => f.endsWith(".json") && !answered.has(f));
        if (name) {
          answered.add(name);
          return JSON.parse(spawnSync(PYTHON!, ["-c", `print(open(r"${join(dir, "requests", name)}").read())`], { encoding: "utf8" }).stdout) as Record<string, unknown>;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error("no request");
    };
    const first = await nextRequest();
    expect(first).toMatchObject({ program: "stripe", args: ["delete", "/v1/webhook_endpoints/we_1"] });
    expect(first.stdinLine).toBeUndefined();
    writeFileSync(join(dir, "responses", `${String(first.id)}.json`), JSON.stringify({ readLine: true }));
    const second = await nextRequest();
    expect(second).toMatchObject({ program: "stripe", args: ["delete", "/v1/webhook_endpoints/we_1"], stdinLine: "yes\n" });
    writeFileSync(join(dir, "responses", `${String(second.id)}.json`), JSON.stringify({ stdout: "deleted\n", stderr: "", exitCode: 0 }));
    const code = await new Promise<number | null>((r) => child.on("close", r));
    expect(stdout.replace(/\r\n/g, "\n")).toBe("deleted\n");
    expect(code).toBe(0);
  }, 20_000);
});
