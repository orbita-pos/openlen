// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveRelease } from "./serve-release";

let subDir: string;
const SHA = "abc123";

beforeAll(async () => {
  subDir = await mkdtemp(path.join(tmpdir(), "serve-release-"));
  const rel = path.join(subDir, "releases", SHA);
  await mkdir(path.join(rel, "src"), { recursive: true });
  await mkdir(path.join(rel, "precios"), { recursive: true });
  await mkdir(path.join(subDir, "assets"), { recursive: true });
  await writeFile(path.join(rel, "index.html"), '<script type="module" src="/src/main.tsx"></script>');
  await writeFile(path.join(rel, "src", "main.tsx"), "console.log('app');");
  await writeFile(path.join(rel, "precios", "index.html"), "<h1>Precios</h1>");
  await writeFile(path.join(subDir, "assets", "f-1.woff2"), "font");
  await writeFile(path.join(subDir, "secreto.txt"), "no");
});
afterAll(async () => {
  await rm(subDir, { recursive: true, force: true });
});

describe("serveRelease — like Caddy's *.openlen.app block", () => {
  it("🔴 serves an app's compiled /src/main.tsx as JavaScript (it was a 404: the Flight Check measured an empty app)", async () => {
    const s = await serveRelease(subDir, SHA);
    try {
      const r = await fetch(`${s.url}src/main.tsx`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("text/javascript");
      expect(await r.text()).toBe("console.log('app');");
    } finally {
      s.server.close();
    }
  });

  it("try_files: a site page's /<slug>/, the shared /assets/, and /index.html for the rest; nothing outside the release", async () => {
    const s = await serveRelease(subDir, SHA);
    try {
      expect(await (await fetch(`${s.url}precios/`)).text()).toBe("<h1>Precios</h1>");
      expect(await (await fetch(`${s.url}assets/f-1.woff2`)).text()).toBe("font");
      expect(await (await fetch(`${s.url}no/existe`)).text()).toContain("/src/main.tsx");
      expect(await (await fetch(`${s.url}%2e%2e/%2e%2e/secreto.txt`)).text()).not.toBe("no");
      expect((await fetch(`${s.url}assets/..%2Fsecreto.txt`)).status).toBe(404);
    } finally {
      s.server.close();
    }
  });
});
