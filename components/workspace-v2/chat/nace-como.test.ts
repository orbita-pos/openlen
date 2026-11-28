// La portada pide nacer como app por la URL: `/new?brief=…&kind=app`.
import { describe, expect, it } from "vitest";
import { camposDeNacer, homeArrival, homeHref, kindFromParam, naceComoDisponible, newProjectHref } from "./nace-como";

describe("el tipo que trae la URL de /new", () => {
  it("sólo `app` es app; lo demás, o nada, es página", () => {
    expect(kindFromParam("app")).toBe("app");
    expect(kindFromParam(null)).toBe("pagina");
    expect(kindFromParam("")).toBe("pagina");
    expect(kindFromParam("pagina")).toBe("pagina");
    expect(kindFromParam("APP ")).toBe("pagina");
  });
});

describe("el enlace de la portada a /new", () => {
  it("una página va sólo con el brief, como siempre", () => {
    expect(newProjectHref("hola mundo", "pagina")).toBe("/new?brief=hola%20mundo");
  });
  it("🔴 una app lleva además `kind=app`", () => {
    expect(newProjectHref("un punto de venta", "app")).toBe("/new?brief=un%20punto%20de%20venta&kind=app");
  });
  it("🔴 a message too long for a URL goes as its ticket's id; a short one as always, ticket or not", () => {
    const long = "á".repeat(5_000);
    expect(newProjectHref(long, "pagina", "0123456789abcdef")).toBe("/new?first=0123456789abcdef");
    expect(newProjectHref(long, "app", "0123456789abcdef")).toBe("/new?first=0123456789abcdef&kind=app");
    expect(newProjectHref(long, "agent", "0123456789abcdef")).toBe("/space?first=0123456789abcdef");
    expect(newProjectHref("hola mundo", "pagina", "0123456789abcdef")).toBe("/new?brief=hola%20mundo");
  });
  it("y el brief va recortado de espacios y escapado", () => {
    expect(newProjectHref("  a&b=c  ", "app")).toBe("/new?brief=a%26b%3Dc&kind=app");
  });
});

describe("los campos de nacer en el cuerpo del primer mensaje", () => {
  it("una herramienta viaja como una app: `naceComo` y el idioma", () => {
    expect(camposDeNacer({ naceComo: "tool", idioma: "es" })).toEqual({ naceComo: "tool", idioma: "es" });
    expect(camposDeNacer({ naceComo: "app" })).toEqual({ naceComo: "app" });
    expect(camposDeNacer(null)).toEqual({});
  });
});

describe("a game in the URL and in the first message (spec local 2026-11-05-modo-juego-design, §8.2)", () => {
  it("kind=game is a game; its link carries it", () => {
    expect(kindFromParam("game")).toBe("game");
    expect(newProjectHref("naves", "game")).toBe("/new?brief=naves&kind=game");
  });
  it("a game travels like an app: `naceComo` and the language", () => {
    expect(camposDeNacer({ naceComo: "game", idioma: "es" })).toEqual({ naceComo: "game", idioma: "es" });
  });
});

describe("a game asked for while games are off (final review, 05/11)", () => {
  it("a stale kind=game is a page when the server says games are off, and stays as it is otherwise", () => {
    expect(naceComoDisponible("game", false)).toBe("pagina");
    expect(naceComoDisponible("game", true)).toBe("game");
    expect(naceComoDisponible("app", false)).toBe("app");
    expect(naceComoDisponible("tool", false)).toBe("tool");
  });
});

// AGENTS FOR EVERYONE (spec local 2026-11-19-agentes-para-todos, §6.3): Agente in the home's pill goes to the space,
// never to /new, and is never a way a project is born.
describe("an agent from the home", () => {
  it("kind=agent is an agent, and its link from the home goes to the space with the brief", () => {
    expect(kindFromParam("agent")).toBe("agent");
    expect(newProjectHref("  un profe de inglés ", "agent")).toBe("/space?brief=un+profe+de+ingl%C3%A9s");
  });
  it("🔴 never asks the server to be born as anything", () => {
    expect(camposDeNacer({ naceComo: "agent", idioma: "es" })).toEqual({});
  });
  it("a link back to the home's box carries it, and the box reads it", () => {
    expect(homeHref("un profe", "agent")).toBe("/?brief=un+profe&kind=agent");
    expect(homeArrival("?kind=agent")).toEqual({ brief: "", kind: "agent" });
  });
});

// A THEME (spec local 2026-11-27-temas-del-workspace, §4.1): reached only from Herramientas → Temas → «Nuevo tema», as a
// link with `kind=theme`, and born like an app: `naceComo` and the language in the first message.
describe("a theme in the URL and in the first message", () => {
  it("kind=theme is a theme; its link carries it", () => {
    expect(kindFromParam("theme")).toBe("theme");
    expect(newProjectHref("un bosque", "theme")).toBe("/new?brief=un%20bosque&kind=theme");
    expect(newProjectHref("á".repeat(5_000), "theme", "0123456789abcdef")).toBe("/new?first=0123456789abcdef&kind=theme");
  });
  it("a theme travels like an app: `naceComo` and the language", () => {
    expect(camposDeNacer({ naceComo: "theme", idioma: "es" })).toEqual({ naceComo: "theme", idioma: "es" });
  });
  it("a link back to the home's box carries it, and the box reads it", () => {
    expect(homeHref("un bosque", "theme")).toBe("/?brief=un+bosque&kind=theme");
    expect(homeArrival("?kind=theme")).toEqual({ brief: "", kind: "theme" });
  });
  it("is never made unavailable by the games switch", () => {
    expect(naceComoDisponible("theme", false)).toBe("theme");
  });
});

describe("a tool in the URL (spec local 2026-11-04-herramientas-hechas-por-len)", () => {
  it("kind=tool is a tool; its link carries it", () => {
    expect(kindFromParam("tool")).toBe("tool");
    expect(newProjectHref("reservas", "tool")).toBe("/new?brief=reservas&kind=tool");
  });
});
