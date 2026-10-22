// @vitest-environment node
//
// The unsubscribe link of an app or form email (spec local
// 2026-10-22-email-integration, 6.7): the page asks first (a mail scanner opening
// the link unsubscribes nobody), the one-click POST of the headers (RFC 8058)
// unsubscribes without a page, and a link only works for its own project.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { memoryEmailStore } from "@/lib/project-email/store";
import { unsubscribeToken } from "@/lib/project-email/unsubscribe";

const m = vi.hoisted(() => ({ store: null as unknown }));
vi.mock("@/lib/project-email/real", () => ({
  realUnsubscribeDeps: () => ({ store: m.store, secret: "secret", senderOf: async (projectId: string) => (projectId === "pA" ? "taller.mx" : "otro.mx") }),
}));

import { GET, POST } from "./route";

const store = () => m.store as ReturnType<typeof memoryEmailStore>;
const call = (method: "GET" | "POST", token: string, lang = "es-MX,es;q=0.9") =>
  (method === "GET" ? GET : POST)(
    new Request(`https://openlen.com/u/${token}`, { method, headers: { "accept-language": lang, ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}) }, body: method === "POST" ? "List-Unsubscribe=One-Click" : undefined }),
    { params: Promise.resolve({ token }) },
  );

beforeEach(() => {
  m.store = memoryEmailStore(() => new Date("2026-10-22T10:00:00Z"));
});

describe("/u/[token]", () => {
  it("opening the link asks, in the reader's language, and unsubscribes nobody", async () => {
    const r = await call("GET", unsubscribeToken("pA", "ana@x.com", "secret"));
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("taller.mx");
    expect(html).toContain("ana@x.com");
    expect(html).toMatch(/<form method="post"/);
    expect(html).toContain('lang="es"');
    expect(await store().isSuppressed("pA", "ana@x.com", "app")).toBe(false);
  });

  it("the one-click POST unsubscribes without a page", async () => {
    const r = await call("POST", unsubscribeToken("pA", "ana@x.com", "secret"));
    expect(r.status).toBe(200);
    expect(await store().isSuppressed("pA", "ana@x.com", "app")).toBe(true);
    // An unsubscribe stops the app and form emails, never the sign-in ones (spec 6.7).
    expect(await store().isSuppressed("pA", "ana@x.com", "auth")).toBe(false);
  });

  it("a token for project A can't unsubscribe from project B", async () => {
    await call("POST", unsubscribeToken("pA", "ana@x.com", "secret"));
    expect(await store().isSuppressed("pB", "ana@x.com", "app")).toBe(false);
    const forged = unsubscribeToken("pB", "ana@x.com", "otra-clave");
    const r = await call("POST", forged);
    expect(r.status).toBe(400);
    expect(await store().isSuppressed("pB", "ana@x.com", "app")).toBe(false);
  });

  it("an address that can't be read is escaped, not run", async () => {
    const r = await call("GET", unsubscribeToken("pA", '<img src=x onerror=alert(1)>@x.com', "secret"), "en");
    const html = await r.text();
    expect(html).not.toContain("<img");
    expect(html).toContain('lang="en"');
  });
});
