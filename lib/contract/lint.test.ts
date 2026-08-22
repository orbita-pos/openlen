import { describe, expect, it } from "vitest";

import { lintContract } from "./lint";

function doc(rootCss: string, extra = ""): string {
  return `<!doctype html><html><head><style>:root{${rootCss}}${extra}</style></head><body></body></html>`;
}

const REQUIRED = "--bg:#000;--surface:#111;--fg:#fff;--accent:#f00;--radius:8px;--font-display:serif;--font-body:sans-serif;";

function tokenWarnings(html: string): string[] {
  return lintContract(html, { kind: "document" }).violations
    .filter((v) => v.rule === "non-canonical-token")
    .map((v) => /:root defines (--[\w-]+)/.exec(v.detail)?.[1] ?? "?");
}

describe("el vocabulario del contrato", () => {
  it("acepta el namespace --ol- que escribe el normalizador", () => {
    const html = doc(
      `${REQUIRED}--ol-bg:#000;--ol-surface-2:#222;--ol-fg-muted:#999;--ol-accent-ink:#000;--ol-border-strong:#333;--ol-font-mono:monospace;`,
    );
    expect(tokenWarnings(html)).toEqual([]);
  });

  it("acepta las escalas generadas a máquina y sus perillas", () => {
    const html = doc(
      `${REQUIRED}--ol-space-scale:1;--ol-space-0_5:2px;--ol-space-24:6rem;--ol-r-scale:1;--ol-r-2xl:1rem;--ol-r:4px;--ol-text-scale:1;--ol-text-lg:1.125rem;--ol-lh-base:1.5;`,
    );
    expect(tokenWarnings(html)).toEqual([]);
  });

  it("sigue marcando un dialecto que sólo lleva el prefijo puesto", () => {
    // El prefijo no es un pase: `--ol-background` es un `:root` vivo que nada
    // lee, y aceptarlo por el prefijo volvería inútil la regla.
    const html = doc(`${REQUIRED}--ol-background:#000;--ol-accentink:#fff;`);
    expect(tokenWarnings(html)).toEqual(["--ol-background", "--ol-accentink"]);
  });

  it("sigue marcando el dialecto sin prefijo", () => {
    const html = doc(`${REQUIRED}--ink:#000;--paper:#fff;`);
    expect(tokenWarnings(html)).toEqual(["--ink", "--paper"]);
  });

  it("no confunde la reconciliación con permitir color a mano", () => {
    const html = doc(REQUIRED, `.hero{color:#ff0000}`);
    const res = lintContract(html, { kind: "document" });
    expect(res.ok).toBe(false);
    expect(res.violations.some((v) => v.rule === "color-from-token")).toBe(true);
  });
});
