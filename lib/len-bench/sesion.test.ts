// lib/len-bench/sesion.test.ts
// @vitest-environment node
//
// Sin `fetch` simulado: eso sólo comprobaría que el simulacro contesta lo que
// se le dijo. La ida y vuelta al servidor la prueba el humo de Len-Bench. Aquí
// se prueba lo que NO necesita servidor: que la cookie la abre el `decode`
// real de Auth.js, y que el nombre y el secreto salen como los saca Auth.js.
import { decode } from "next-auth/jwt";
import { describe, expect, it } from "vitest";
import { acunarCookie, herramientasDeLen, nombreDeCookie, secretoDeAuth, tarjetaDePublicar, textoDeLen, tocarPublicar } from "./sesion";

const SECRETO = "secreto-de-prueba-de-treinta-y-dos-bytes";

function partir(cookie: string): { nombre: string; token: string } {
  const i = cookie.indexOf("=");
  return { nombre: cookie.slice(0, i), token: cookie.slice(i + 1) };
}

describe("nombreDeCookie", () => {
  it("sin AUTH_URL ni NEXTAUTH_URL, en http, va sin prefijo: Next pone x-forwarded-proto=http", () => {
    expect(nombreDeCookie({})).toBe("authjs.session-token");
    expect(nombreDeCookie({ NEXTAUTH_URL: "http://127.0.0.1:3007" })).toBe("authjs.session-token");
  });
  it("con AUTH_URL o NEXTAUTH_URL en https, Auth.js reescribe la petición a https y espera la __Secure-", () => {
    expect(nombreDeCookie({ NEXTAUTH_URL: "https://openlen.com" })).toBe("__Secure-authjs.session-token");
    expect(nombreDeCookie({ AUTH_URL: "https://openlen.com", NEXTAUTH_URL: "http://127.0.0.1:3007" })).toBe(
      "__Secure-authjs.session-token",
    );
  });
});

describe("secretoDeAuth", () => {
  it("AUTH_SECRET antes que NEXTAUTH_SECRET, como `setEnvDefaults` de next-auth", () => {
    expect(secretoDeAuth({ AUTH_SECRET: "a", NEXTAUTH_SECRET: "b" })).toBe("a");
    expect(secretoDeAuth({ NEXTAUTH_SECRET: "b" })).toBe("b");
  });
  it("sin ninguno lo dice, en vez de firmar con nada", () => {
    expect(() => secretoDeAuth({})).toThrow(/NEXTAUTH_SECRET/);
  });
});

describe("acunarCookie", () => {
  it("el decode de Auth.js la abre con el mismo secreto y la sal = el nombre de la cookie, y lleva el id", async () => {
    const { nombre, token } = partir(
      await acunarCookie({ userId: "u-1", email: "eval@x.test", entorno: { NEXTAUTH_SECRET: SECRETO } }),
    );
    expect(nombre).toBe("authjs.session-token");
    const t = await decode({ token, secret: SECRETO, salt: nombre });
    expect(t?.sub).toBe("u-1");
  });
  it("con otro secreto NO se abre: la prueba de arriba no pasa por casualidad", async () => {
    const { nombre, token } = partir(
      await acunarCookie({ userId: "u-1", email: "eval@x.test", entorno: { NEXTAUTH_SECRET: SECRETO } }),
    );
    await expect(decode({ token, secret: "otro-secreto-de-treinta-y-dos-bytes!!", salt: nombre })).rejects.toThrow();
  });
});

describe("textoDeLen", () => {
  it("suma los eventos `text` en orden e ignora los demás", () => {
    expect(
      textoDeLen([
        { nombre: "text", datos: { type: "text", text: "Ho" } },
        { nombre: "action", datos: { type: "action", tool: "editar_texto" } },
        { nombre: "text", datos: { type: "text", text: "la" } },
      ]),
    ).toBe("Hola");
  });

  it("un `retry` retira lo que el intento fallido llegó a escribir (no se puntúa lo descartado)", () => {
    expect(
      textoDeLen([
        { nombre: "text", datos: { type: "text", text: "Miro. " } },
        { nombre: "text", datos: { type: "text", text: "Ya v" } },
        { nombre: "retry", datos: { type: "retry", attempt: 1, maxAttempts: 5, delayMs: 500, discardChars: 4 } },
        { nombre: "text", datos: { type: "text", text: "Ya está." } },
      ]),
    ).toBe("Miro. Ya está.");
  });

  it("una `compaction` con descarte también retira lo del intento (desborde a media vuelta)", () => {
    expect(
      textoDeLen([
        { nombre: "text", datos: { type: "text", text: "Miro. " } },
        { nombre: "text", datos: { type: "text", text: "Ya v" } },
        { nombre: "compaction", datos: { type: "compaction", pruned: 0, summarized: true, discardChars: 4 } },
        { nombre: "text", datos: { type: "text", text: "Ya está." } },
      ]),
    ).toBe("Miro. Ya está.");
  });
});

describe("herramientasDeLen", () => {
  it("el `tool` de los eventos `action`, una vez cada una y en el orden en que empezó", () => {
    expect(
      herramientasDeLen([
        { nombre: "action", datos: { type: "action", tool: "ver_mensajes", status: "running" } },
        { nombre: "text", datos: { type: "text", text: "Juan te escribió" } },
        { nombre: "action", datos: { type: "action", tool: "ver_mensajes", status: "done" } },
        { nombre: "action", datos: { type: "action", tool: "preparar_respuesta", status: "running" } },
        { nombre: "confirm", datos: { type: "confirm", action: "responder", tool: "no-es-una-accion" } },
      ]),
    ).toEqual(["ver_mensajes", "preparar_respuesta"]);
  });
});

describe("tarjetaDePublicar", () => {
  it("lee la tarjeta de publicar que Len dejó en el turno (la última)", () => {
    expect(
      tarjetaDePublicar([
        { nombre: "text", datos: { type: "text", text: "toca Publicar" } },
        { nombre: "confirm", datos: { type: "confirm", action: "publicar", subdominio: "robleyluz", idiomas: [], republicar: false } },
      ]),
    ).toEqual({ subdominio: "robleyluz", idiomas: [], republicar: false });
  });
  it("sin tarjeta de publicar, nada que tocar", () => {
    expect(tarjetaDePublicar([{ nombre: "text", datos: { type: "text", text: "ya quedó publicada" } }])).toBeNull();
  });
});

describe("tocarPublicar — lo mismo que hace agent-confirm-card.tsx al tocarla", () => {
  function red(respuestas: Record<string, { status: number; json: unknown }>) {
    const llamadas: { url: string; body: unknown }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      llamadas.push({ url, body: JSON.parse(String(init?.body ?? "null")) });
      const r = respuestas[new URL(url).pathname];
      return new Response(JSON.stringify(r.json), { status: r.status });
    }) as typeof fetch;
    return { f, llamadas };
  }
  const base = "http://localhost:3007";

  it("un subdominio nuevo: primero mira si está libre, luego publica (sin `languages` si no hay idiomas)", async () => {
    const { f, llamadas } = red({
      "/api/subdomains/check": { status: 200, json: { available: true } },
      "/api/projects/p1/publish": { status: 200, json: { url: "https://robleyluz.openlen.app" } },
    });
    const r = await tocarPublicar({ base, cookie: "c", projectId: "p1", tarjeta: { subdominio: "robleyluz", idiomas: [], republicar: false }, fetch: f });
    expect(r).toEqual({ ok: true });
    expect(llamadas).toEqual([
      { url: `${base}/api/subdomains/check`, body: { subdomain: "robleyluz" } },
      { url: `${base}/api/projects/p1/publish`, body: { subdomain: "robleyluz" } },
    ]);
  });
  it("re-publicar el suyo se salta la comprobación y manda los idiomas si los hay", async () => {
    const { f, llamadas } = red({ "/api/projects/p1/publish": { status: 200, json: {} } });
    await tocarPublicar({ base, cookie: "c", projectId: "p1", tarjeta: { subdominio: "robleyluz", idiomas: ["en"], republicar: true }, fetch: f });
    expect(llamadas).toEqual([{ url: `${base}/api/projects/p1/publish`, body: { subdomain: "robleyluz", languages: ["en"] } }]);
  });
  it("si el nombre está ocupado no publica, y dice por qué", async () => {
    const { f, llamadas } = red({ "/api/subdomains/check": { status: 200, json: { available: false, reason: "taken" } } });
    const r = await tocarPublicar({ base, cookie: "c", projectId: "p1", tarjeta: { subdominio: "x", idiomas: [], republicar: false }, fetch: f });
    expect(r).toEqual({ ok: false, motivo: "subdominio no disponible: taken" });
    expect(llamadas).toHaveLength(1);
  });
});
