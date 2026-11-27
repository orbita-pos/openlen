// The logo a publish bakes into a project's pages (favicon + og:image fallback). Seen on 27/11 in an app ("Aurora"): its
// first publish found no icon in the shell, so the page got OpenLen's default mark (the coral initial), and that mark was
// SAVED as the project's logo; later Len wrote the app's own icon in /index.html, and every publish kept swapping it back
// for the saved coral mark — Len ended up re-adding the icon from JavaScript 600 ms after load. In an app the shell is
// CODE: what it declares is the truth, as Claude Code takes the file as written. A page keeps the inspector's choice first.
import { beforeEach, describe, expect, it, vi } from "vitest";

const updates: unknown[] = [];
vi.mock("@/lib/db", () => ({
  db: { update: () => ({ set: (v: unknown) => ({ where: async () => void updates.push(v) }) }) },
  schema: { projects: { id: "id", userId: "userId" } },
}));
vi.mock("./upload-data-uri", () => ({
  uploadDataUriToStorage: vi.fn(async (uri: string) => `https://uploads.openlen.com/logos/${uri.length}.svg`),
}));

import { resolveProjectLogo } from "./resolve-project-logo";

const SAVED = "https://uploads.openlen.com/logos/153a0d9e6a12d953.svg";
const shell = (icon: string | null) =>
  `<!doctype html><html><head><title>Aurora</title>${icon ? `<link rel="icon" href="${icon}">` : ""}</head><body><div id="root"></div></body></html>`;

beforeEach(() => {
  updates.length = 0;
});

describe("resolveProjectLogo", () => {
  it("🔴 in an app, the icon the shell declares wins over the saved logo, and becomes the saved one", async () => {
    const own = "https://pomodoro.openlen.app/icon.svg";
    const logo = await resolveProjectLogo({ projectId: "p", userId: "u", currentLogoUrl: SAVED, html: shell(own), isApp: true });
    expect(logo).toBe(own);
    expect(updates).toEqual([expect.objectContaining({ logoUrl: own })]);
  });

  it("in an app, an icon declared as a data: URI is uploaded and that URL wins", async () => {
    const own = "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E";
    const logo = await resolveProjectLogo({ projectId: "p", userId: "u", currentLogoUrl: SAVED, html: shell(own), isApp: true });
    expect(logo).toMatch(/^https:\/\/uploads\.openlen\.com\/logos\//);
    expect(logo).not.toBe(SAVED);
  });

  it("in an app whose shell declares no icon, the saved logo still serves, untouched", async () => {
    const logo = await resolveProjectLogo({ projectId: "p", userId: "u", currentLogoUrl: SAVED, html: shell(null), isApp: true });
    expect(logo).toBe(SAVED);
    expect(updates).toEqual([]);
  });

  it("in an app, the same icon as the saved one writes nothing", async () => {
    const logo = await resolveProjectLogo({ projectId: "p", userId: "u", currentLogoUrl: SAVED, html: shell(SAVED), isApp: true });
    expect(logo).toBe(SAVED);
    expect(updates).toEqual([]);
  });

  it("on a page, the saved logo (the inspector's choice) still wins, as before", async () => {
    const logo = await resolveProjectLogo({ projectId: "p", userId: "u", currentLogoUrl: SAVED, html: shell("https://x.example/fav.png") });
    expect(logo).toBe(SAVED);
    expect(updates).toEqual([]);
  });

  it("with nothing saved, the declared icon is found and saved, for a page and an app alike", async () => {
    for (const isApp of [false, true]) {
      updates.length = 0;
      const logo = await resolveProjectLogo({ projectId: "p", userId: "u", currentLogoUrl: null, html: shell("https://x.example/fav.png"), isApp });
      expect(logo).toBe("https://x.example/fav.png");
      expect(updates).toEqual([expect.objectContaining({ logoUrl: "https://x.example/fav.png" })]);
    }
  });
});
