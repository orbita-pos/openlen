// @vitest-environment node
//
// THE AGENT'S EYES ON ITS PUBLISHED TOOL (spec local 2026-11-22-artifacts-de-len, §5): in real Chromium,
// `usarPagina` opens the published page with the agent-tool bridge (`window.openlen.data`) running on an in-memory copy
// of its real documents. A `data.set` updates what `subscribe` receives (via `window.__openlenBridgeNotify`) and what a
// later `data.get` in the same visit returns, while never touching the real docs array; a fresh visit starts clean.
import { describe, expect, it } from "vitest";

import { newBrowserTabHolder } from "@/lib/agent/pasos-de-uso";
import { closeBrowserTab, usarPagina } from "@/lib/agent/usar-pagina";
import type { LenArtifactDoc } from "./store";

// A real 1×1 PNG: an agent tool's image is a binary file of its version (a blob in the store), answered as bytes.
const DOT_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const TOOL_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Recorrido</title><script src="/assets/helper.js"></script></head>
<body>
  <p id="helper-flag">no</p>
  <img id="pic" src="/assets/dot.png" alt="">
  <p id="status">loading</p>
  <p id="sub-count">0</p>
  <button id="done-btn">Finish Lesson 3</button>
  <script>
    document.getElementById("helper-flag").textContent = window.HELPER_OK || "missing";
    let updates = 0;
    window.openlen.data.subscribe(function (snap) {
      updates += 1;
      document.getElementById("sub-count").textContent = String(updates);
      var p3 = snap.docs.find(function (d) { return d.collection === "progress" && d.docId === "3"; });
      var l1 = snap.docs.find(function (d) { return d.collection === "lessons" && d.docId === "1"; });
      document.getElementById("status").textContent = p3 && p3.data && p3.data.done
        ? "lesson3-done"
        : (l1 && l1.data && l1.data.title ? "seed:" + l1.data.title : "empty");
    });
    document.getElementById("done-btn").addEventListener("click", function () {
      window.openlen.data.set("progress", "3", { done: true, score: 100 });
    });
  </script>
</body>
</html>`;

describe("agent tool eyes in Chromium", () => {
  it("runs window.openlen.data on a throwaway copy, serves /assets/* release files, pushes __openlenBridgeNotify, and never mutates real docs", async () => {
    const realDocs: LenArtifactDoc[] = [
      {
        collection: "lessons",
        docId: "1",
        data: { title: "Hola" },
        updatedAt: new Date("2026-11-22T10:00:00Z"),
        updatedBy: "agent",
      },
    ];
    const tab = newBrowserTabHolder();
    try {
      const first = await usarPagina({
        html: TOOL_HTML,
        ruta: "/.artifacts/ana/recorrido/index.html",
        vista: null,
        tab,
        releaseFiles: { "/assets/helper.js": 'window.HELPER_OK = "yes";' },
        releaseBinaries: { "/assets/dot.png": new Uint8Array(DOT_PNG) },
        toolBridge: { mode: "lenArtifact", toolId: "tool-1", releaseSha: "sha-1", locale: "es", theme: "light", docs: realDocs },
        pasos: [
          { wait: 0.3 },
          { eval: "var p = document.getElementById('pic'); return 'pic:' + [p.complete, p.naturalWidth].join('/')" },
          { read: "seed:Hola" },
          { eval: "return [document.getElementById('helper-flag').textContent, typeof window.openlen.backend, typeof window.openlen.data.set]" },
          { click: "Finish Lesson 3" },
          { wait: 0.2 },
          { read: "lesson3-done" },
          { eval: "return window.openlen.data.get('progress', '3').then(function (r) { return r.doc && r.doc.data; })" },
        ],
      });
      expect(first.informe).toContain("seed:Hola");
      // the image loaded: its bytes reached the page
      expect(first.informe).toContain("pic:true/1");
      expect(first.informe).toContain('["yes","undefined","function"]');
      expect(first.informe).toContain("lesson3-done");
      expect(first.informe).toContain('"done":true');
      expect(first.informe).toContain('"score":100');

      // Sequential use_page on the same open tab (without newVisit) preserves the in-memory copy.
      const second = await usarPagina({
        html: TOOL_HTML,
        ruta: "/.artifacts/ana/recorrido/index.html",
        vista: null,
        tab,
        releaseFiles: { "/assets/helper.js": 'window.HELPER_OK = "yes";' },
        toolBridge: { mode: "lenArtifact", toolId: "tool-1", releaseSha: "sha-1", locale: "es", theme: "light", docs: realDocs },
        pasos: [{ eval: "return window.openlen.data.get('progress', '3').then(function (r) { return r.doc && r.doc.data; })" }],
      });
      expect(second.informe).toContain('"done":true');

      // Real docs array was never mutated.
      expect(realDocs).toHaveLength(1);
      expect(realDocs[0]!.collection).toBe("lessons");

      // A fresh visit (`newVisit: true`) starts clean from `realDocs`: progress/3 is gone.
      const fresh = await usarPagina({
        html: TOOL_HTML,
        ruta: "/.artifacts/ana/recorrido/index.html",
        vista: null,
        tab,
        newVisit: true,
        releaseFiles: { "/assets/helper.js": 'window.HELPER_OK = "yes";' },
        toolBridge: { mode: "lenArtifact", toolId: "tool-1", releaseSha: "sha-1", locale: "es", theme: "light", docs: realDocs },
        pasos: [
          { wait: 0.3 },
          { eval: "return window.openlen.data.get('progress', '3')" },
        ],
      });
      expect(fresh.informe).toContain('"doc":null');
    } finally {
      await closeBrowserTab(tab);
    }
  }, 90_000);
});
