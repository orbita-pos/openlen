import { describe, expect, it } from "vitest";
import type { ProjectData } from "@/lib/projects/types";
import { documentoDeVista, type ContextoDeVista } from "./documento";

const DOC =
  '<!doctype html><html><head><title>t</title><base href="https://otro.example/"></head><body>' +
  '<a href="https://instagram.com/x" target="_blank">ig</a>' +
  '<form><input name="email"><button type="submit">Enviar</button></form>' +
  "</body></html>";

const ctx = (extra: Partial<ContextoDeVista> = {}): ContextoDeVista => ({
  projectId: "4f9c10cb-8781-48f1-b291-c5d146579f09",
  title: "Mi negocio",
  sub: null,
  pagina: null,
  settings: undefined,
  logoUrl: null,
  ...extra,
});

describe("documentoDeVista: lo que se replica de la publicación", () => {
  it("el sello: quita <base> y pone noopener en target=_blank", () => {
    const out = documentoDeVista(DOC, ctx());
    expect(out).not.toMatch(/<base\b/i);
    expect(out).toMatch(/<a [^>]*rel="[^"]*noopener/);
  });

  it("el logo, cuando lo hay", () => {
    const out = documentoDeVista(DOC, ctx({ logoUrl: "https://uploads.example/logo.png" }));
    expect(out).toContain('rel="icon"');
    expect(out).toContain("https://uploads.example/logo.png");
  });

  it("el chat, cuando está activo", () => {
    const settings = { chat: { enabled: true } } as unknown as ProjectData["settings"];
    expect(documentoDeVista(DOC, ctx({ settings }))).toContain("data-ol-chat-widget");
  });
});

describe("documentoDeVista: lo que NO se replica", () => {
  it("🔴 el formulario no se cablea — cada envío sería un lead real", () => {
    expect(documentoDeVista(DOC, ctx())).not.toContain("/api/f/");
  });

  it("ni analítica ni tira de rastreo", () => {
    const out = documentoDeVista(DOC, ctx());
    expect(out).not.toContain("data-ol-cid-stamp");
    expect(out).not.toMatch(/\/c\/[0-9a-f-]{36}/);
  });
});
