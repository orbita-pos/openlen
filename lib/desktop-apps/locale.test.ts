// @vitest-environment node
import { describe, expect, it } from "vitest";

import { desktopLocale } from "./locale";

describe("desktopLocale", () => {
  it("the NEXT_LOCALE cookie wins over the browser's languages", () => {
    expect(desktopLocale({ cookie: "es", acceptLanguage: "ja,en;q=0.5" })).toBe("es");
  });

  it("a cookie that is not one of ours is ignored", () => {
    expect(desktopLocale({ cookie: "xx", acceptLanguage: "fr-CA,fr;q=0.9" })).toBe("fr");
    expect(desktopLocale({ cookie: "", acceptLanguage: null })).toBe("en");
  });

  it("Accept-Language is read by quality, and a region falls back to its language", () => {
    expect(desktopLocale({ cookie: null, acceptLanguage: "de;q=0.4, pt-BR;q=0.9, en;q=0.1" })).toBe("pt");
    expect(desktopLocale({ cookie: undefined, acceptLanguage: "zh-TW,zh;q=0.8" })).toBe("zh");
  });

  it("skips the languages we don't have, and settles on English when none is ours", () => {
    expect(desktopLocale({ cookie: null, acceptLanguage: "sv,da;q=0.8,nl;q=0.5" })).toBe("nl");
    expect(desktopLocale({ cookie: null, acceptLanguage: "sv,da;q=0.8" })).toBe("en");
    expect(desktopLocale({ cookie: null, acceptLanguage: null })).toBe("en");
    expect(desktopLocale({ cookie: null, acceptLanguage: "*" })).toBe("en");
  });

  it("a q of 0 means «not acceptable»", () => {
    expect(desktopLocale({ cookie: null, acceptLanguage: "es;q=0, it;q=0.2" })).toBe("it");
  });
});
