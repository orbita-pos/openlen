import { describe, it, expect } from "vitest";
import { EMAIL_OFF, EMAIL_OFF_END, optOutOfEmailObfuscation } from "./cloudflare-email";

const DOC = `<!doctype html><html lang="es"><head><title>Taller</title></head><body><footer><a href="mailto:hola@taller.mx">hola@taller.mx</a></footer></body></html>`;

describe("optOutOfEmailObfuscation", () => {
  it("envuelve el documento entero, dentro de <html>", () => {
    const out = optOutOfEmailObfuscation(DOC);
    expect(out).toContain(`<html lang="es">${EMAIL_OFF}<head>`);
    expect(out).toContain(`${EMAIL_OFF_END}</html>`);
  });

  it("el correo sigue siendo un mailto de verdad", () => {
    const out = optOutOfEmailObfuscation(DOC);
    expect(out).toContain('href="mailto:hola@taller.mx"');
  });

  it("es idempotente — publicar dos veces no anida marcadores", () => {
    const una = optOutOfEmailObfuscation(DOC);
    expect(optOutOfEmailObfuscation(una)).toBe(una);
    expect(una.split(EMAIL_OFF).length - 1).toBe(1);
  });

  it("no toca el doctype ni nada anterior a <html>", () => {
    expect(optOutOfEmailObfuscation(DOC).startsWith("<!doctype html><html")).toBe(true);
  });

  it("un documento sin <html> sale envuelto igual", () => {
    const out = optOutOfEmailObfuscation("<p>hola@x.mx</p>");
    expect(out).toBe(`${EMAIL_OFF}<p>hola@x.mx</p>${EMAIL_OFF_END}`);
  });

  it("sin </html> de cierre no pierde el marcador de apertura", () => {
    const out = optOutOfEmailObfuscation("<html><body><p>x</p></body>");
    expect(out).toContain(`<html>${EMAIL_OFF}`);
  });

  // El sellado hashea el CONTENIDO de cada <script>. Un comentario fuera de
  // ellos no puede mover un hash — pero es justo el fallo que dejaría páginas
  // sin política, así que se comprueba en vez de suponerse.
  it("no toca el contenido de los scripts ni la meta de la CSP", () => {
    const conCsp = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src 'sha256-x'"></head><body><script>const a=1;</script></body></html>`;
    const out = optOutOfEmailObfuscation(conCsp);
    expect(out).toContain("<script>const a=1;</script>");
    expect(out).toContain(`content="script-src 'sha256-x'"`);
  });
});
