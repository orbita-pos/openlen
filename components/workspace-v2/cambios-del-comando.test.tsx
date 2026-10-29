// @vitest-environment jsdom
// A binary a command made (spec local 2026-10-28-ficheros-al-nivel-de-claude-code): its card says its bytes as
// `git diff --stat` does, and never paints the pointer it is stored as. Manual react-dom + act() harness, like
// `terminal-view.test.tsx`.
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { cambiosDelComando } from "@/lib/agent/terminal/cambios-del-comando";
import { makePointer } from "@/lib/files/blob-pointer";

import { CambiosDelComandoView } from "./cambios-del-comando";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const labels = { creado: "Creado", actualizado: "Actualizado", borrado: "Borrado", masLineas: (n: number) => `+${n}`, masFicheros: (n: number) => `+${n}`, abrir: "Abrir" };

describe("the card of what a command changed", () => {
  it("🔴 a binary: «Bin 0 -> 74 bytes», no lines, no pointer", () => {
    const png = makePointer({ sha256: "a".repeat(64), size: 74, gitOid: "b".repeat(40) });
    const cambios = cambiosDelComando({}, { "/img/punto.png": png, "/nota.txt": "nota\n" })!;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<CambiosDelComandoView cambios={cambios} conLineas labels={labels} />));
    const text = host.textContent ?? "";
    expect(text).toContain("img/punto.png");
    expect(text).toContain("Bin 0 -> 74 bytes");
    expect(text).not.toContain("openlen-blob");
    // The text file next to it keeps its lines.
    expect(text).toContain("nota");
  });
});
