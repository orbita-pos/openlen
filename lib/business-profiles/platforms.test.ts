import { describe, it, expect } from "vitest";
import { PLATFORMS, PLATFORM_ORDER, PLATFORM_ICON_PATHS, platformHref } from "./platforms";

describe("platformHref — las 4 formas de escribir lo mismo", () => {
  const esperado = "https://twitch.tv/kira";
  it("handle pelado", () => expect(platformHref("twitch", "kira")).toBe(esperado));
  it("con arroba", () => expect(platformHref("twitch", "@kira")).toBe(esperado));
  it("con espacios", () => expect(platformHref("twitch", "  kira  ")).toBe(esperado));
  it("dominio sin protocolo", () => expect(platformHref("twitch", "twitch.tv/kira")).toBe("https://twitch.tv/kira"));
  it("URL completa se respeta tal cual", () =>
    expect(platformHref("twitch", "https://www.twitch.tv/kira?ref=x")).toBe("https://www.twitch.tv/kira?ref=x"));
});

describe("platformHref — prefijos por plataforma", () => {
  it("tiktok antepone @", () => expect(platformHref("tiktok", "kira")).toBe("https://tiktok.com/@kira"));
  it("youtube antepone @", () => expect(platformHref("youtube", "kira")).toBe("https://youtube.com/@kira"));
  it("discord usa discord.gg", () => expect(platformHref("discord", "laguarida")).toBe("https://discord.gg/laguarida"));
  it("telegram usa t.me", () => expect(platformHref("telegram", "kira")).toBe("https://t.me/kira"));
  it("kofi", () => expect(platformHref("kofi", "kira")).toBe("https://ko-fi.com/kira"));
});

describe("platformHref — subdominio", () => {
  it("bandcamp arma subdominio", () => expect(platformHref("bandcamp", "kira")).toBe("https://kira.bandcamp.com"));
  it("gumroad arma subdominio", () => expect(platformHref("gumroad", "kira")).toBe("https://kira.gumroad.com"));
  it("bandcamp respeta una URL completa", () =>
    expect(platformHref("bandcamp", "https://kira.bandcamp.com/album/x")).toBe("https://kira.bandcamp.com/album/x"));
});

describe("platformHref — solo URL", () => {
  it("spotify acepta la URL", () =>
    expect(platformHref("spotify", "https://open.spotify.com/artist/abc")).toBe("https://open.spotify.com/artist/abc"));
  it("spotify acepta dominio sin protocolo", () =>
    expect(platformHref("spotify", "open.spotify.com/artist/abc")).toBe("https://open.spotify.com/artist/abc"));
  it("spotify RECHAZA un handle pelado (no hay forma de adivinar la URL)", () =>
    expect(platformHref("spotify", "kira")).toBeNull());
});

describe("platformHref — entradas basura", () => {
  it("cadena vacía", () => expect(platformHref("twitch", "")).toBeNull());
  it("solo espacios", () => expect(platformHref("twitch", "   ")).toBeNull());
  it("solo arroba", () => expect(platformHref("twitch", "@")).toBeNull());
  it("plataforma 'otro' cae a URL genérica", () => expect(platformHref("otro", "midominio.com")).toBe("https://midominio.com"));
  it("plataforma 'otro' con handle pelado es null", () => expect(platformHref("otro", "kira")).toBeNull());
  it("rechaza javascript:", () => expect(platformHref("otro", "javascript:alert(1)")).toBeNull());
  it("rechaza data:", () => expect(platformHref("otro", "data:text/html,<script>")).toBeNull());
});

describe("platformHref — fallback con type inexistente", () => {
  it("type inexistente con dominio cae a URL genérica", () => expect(platformHref("plataforma-inexistente", "midominio.com")).toBe("https://midominio.com"));
  it("type inexistente con handle pelado es null", () => expect(platformHref("plataforma-inexistente", "kira")).toBeNull());
});

describe("registry", () => {
  it("PLATFORM_ORDER solo contiene ids que existen", () => {
    for (const id of PLATFORM_ORDER) expect(PLATFORMS[id], `falta ${id}`).toBeTruthy();
  });
  it("toda plataforma tiene un icono", () => {
    for (const id of Object.keys(PLATFORMS)) {
      expect(PLATFORM_ICON_PATHS[PLATFORMS[id].icon], `falta icono de ${id}`).toBeTruthy();
    }
  });
  it("incluye las 15 de v1 + los 3 heredados", () => {
    for (const id of ["youtube","twitch","kick","tiktok","discord","telegram","x","instagram",
                      "spotify","soundcloud","bandcamp","applemusic","kofi","patreon","gumroad",
                      "website","menu","otro"]) {
      expect(PLATFORMS[id], `falta ${id}`).toBeTruthy();
    }
  });
});
