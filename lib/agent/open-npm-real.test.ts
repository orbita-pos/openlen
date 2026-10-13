// Open npm through Len's real doors, against the real npm registry, OSV and
// esm.sh: saving a file with Write, `npm install` in Len's bash and in the
// user's terminal. Only the project's storage is in memory. Run on purpose:
//   OPENLEN_REAL_ESM=1 npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/agent/open-npm-real.test.ts
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { installForApp } from "@/lib/apps/npm/install";
import { readEsmLock, readPackageJson } from "@/lib/apps/npm/lock";
import { ESM_LOCK_PATH, PACKAGE_JSON_PATH } from "@/lib/apps/npm/paths";
import { memoryStore } from "@/lib/apps/npm/store";
import type { ProjectData } from "@/lib/projects/types";
import { cerrarTerminalDeLaSesion } from "./terminal/herramienta";
import { cerrarLasTerminalesDelUsuario, ejecutarEnLaTerminalDelUsuario } from "./terminal/terminal-del-usuario";
import { runAgentTool, type AgentDeps, type AgentSession } from "./tools";

const REAL = process.env.OPENLEN_REAL_ESM === "1";
const APP = { catalogo: "2026-11", entrada: "/src/main.tsx" };
const SHELL =
  '<!doctype html><html lang="en"><head><title>Probe</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';

/** A project in memory whose packages install for real. */
function realProject() {
  const files: Record<string, string> = { "/src/main.tsx": 'import "./App";\n' };
  let data: ProjectData = { html: SHELL, app: APP };
  const store = memoryStore();
  const deps = {
    async loadProject() {
      return { data, title: "Probe", subdomain: null, publishedAt: null, userBrief: null };
    },
    async saveProjectData(_p: string, _u: string, apply: (d: ProjectData) => ProjectData) {
      data = apply(data);
    },
    async snapshotVersion() {
      return "v1";
    },
    async projectFiles() {
      return { ...files };
    },
    async saveProjectFile(_p: string, path: string, contents: string) {
      files[path] = contents;
      return { versionPrevia: null };
    },
    async deleteProjectFile(_p: string, path: string) {
      delete files[path];
      return { versionPrevia: null };
    },
    cambiosSinPublicar: async () => false,
    async checkApp() {
      return null;
    },
    async installPackages(f: Readonly<Record<string, string>>, app: typeof APP, request: Parameters<typeof installForApp>[0]["request"]) {
      return installForApp({ files: f, app, request, deps: { fetch, now: () => new Date(), store } });
    },
  } as unknown as AgentDeps;
  return { deps, files };
}

const session = (): AgentSession => ({
  projectId: "p-real",
  userId: "u1",
  page: null,
  ownerEmail: null,
  imageEditsThisTurn: 0,
  photoSearchesThisTurn: 0,
  busquedasVaciasSeguidas: 0,
  app: APP,
});
const messages = (o: { diagnosticos?: readonly { mensaje: string }[] }) => (o.diagnosticos ?? []).map((d) => d.mensaje);
const text = (o: { response: Record<string, unknown> }) => String(o.response.tool_result);

describe("open npm through Len's doors, against the real esm.sh", { skip: !REAL }, () => {
  after(async () => {
    await cerrarLasTerminalesDelUsuario();
  });

  it("🔴 Len's Write: a file that imports a package installs it, says so, and compiles", async () => {
    const { deps, files } = realProject();
    const w = await runAgentTool(session(), deps, "Write", {
      file_path: "/src/App.tsx",
      content: 'import confetti from "canvas-confetti";\nexport default function App() {\n  return <button onClick={() => confetti()}>Party</button>;\n}\n',
    });
    assert.equal(w.response.ok, true, text(w));
    const said = messages(w);
    assert.ok(said.some((m) => /^Installed canvas-confetti@[\d.]+ from npm \(esm\.sh\)/.test(m)), JSON.stringify(said));
    assert.ok(!said.some((m) => /not installed/.test(m)), JSON.stringify(said));
    assert.match(readPackageJson(files)?.dependencies?.["canvas-confetti"] ?? "", /^\^\d/);
    assert.ok(readEsmLock(files).packages["canvas-confetti"]);
  });

  it("🔴 Len's Write: a part of a catalog package (react-dom/server) installs at the catalog's version", async () => {
    const { deps, files } = realProject();
    const w = await runAgentTool(session(), deps, "Write", {
      file_path: "/src/App.tsx",
      content: 'import { renderToString } from "react-dom/server";\nexport const html = renderToString(<p>hi</p>);\n',
    });
    assert.equal(w.response.ok, true, text(w));
    const said = messages(w);
    assert.ok(said.includes("Installed react-dom/server from npm (esm.sh), from the same react-dom@19.2.6 this app already has."), JSON.stringify(said));
    assert.ok(!said.some((m) => /not installed/.test(m)), JSON.stringify(said));
    assert.equal(readEsmLock(files).packages["react-dom"]?.catalogParts, true);
  });

  it("🔴 Len's bash: npm install, then npm ls sees it", async () => {
    const { deps, files } = realProject();
    const s = session();
    const before = process.env.OPENLEN_TERMINAL;
    process.env.OPENLEN_TERMINAL = "1";
    try {
      const install = await runAgentTool(s, deps, "bash", { command: "npm install dayjs" });
      assert.equal(install.response.ok, true, text(install));
      assert.match(text(install), /\+ dayjs@[\d.]+/);
      assert.match(readPackageJson(files)?.dependencies?.dayjs ?? "", /^\^\d/);
      assert.ok(files[ESM_LOCK_PATH]?.includes('"dayjs"'));
      const ls = await runAgentTool(s, deps, "bash", { command: "npm ls" });
      assert.match(text(ls), /dayjs@[\d.]+ \(esm\.sh\)/);
    } finally {
      await cerrarTerminalDeLaSesion(s);
      if (before === undefined) delete process.env.OPENLEN_TERMINAL;
      else process.env.OPENLEN_TERMINAL = before;
    }
  });

  it("🔴 the user's terminal: npm install saves /package.json and the lock", async () => {
    const { deps, files } = realProject();
    const before = process.env.OPENLEN_TERMINAL;
    process.env.OPENLEN_TERMINAL = "1";
    try {
      const out = await ejecutarEnLaTerminalDelUsuario("p-real-user", "u1", "npm install nanoid; echo rc=$?", deps);
      assert.match(out.salida, /\+ nanoid@[\d.]+/);
      assert.match(out.salida, /rc=0/);
      assert.match(readPackageJson(files)?.dependencies?.nanoid ?? "", /^\^\d/);
      assert.ok(readEsmLock(files).packages.nanoid);
      assert.ok(files[PACKAGE_JSON_PATH]);
    } finally {
      if (before === undefined) delete process.env.OPENLEN_TERMINAL;
      else process.env.OPENLEN_TERMINAL = before;
    }
  });
});
