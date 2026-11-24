// The home's link to /new opens the workspace's send flow (`mode=ai`) — with the brief in the URL, as always, or, for a
// message too long for a URL (24/11: no 4,000 cap any more, as Claude Code), with the ticket's id in `?first=`. Without
// `mode=ai` the workspace wouldn't look for the ticket and the message would be lost.
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ default: () => ({ auth: (h: unknown) => h }) }));
vi.mock("@/auth.config", () => ({ default: {} }));
vi.mock("next-intl/middleware", async () => {
  const { NextResponse } = await import("next/server");
  return { default: () => () => NextResponse.next() };
});
vi.mock("@/i18n/routing", () => ({ routing: { locales: ["en", "es"], defaultLocale: "en" } }));

import middleware from "@/middleware";

const go = async (path: string) => {
  const res = await middleware(new NextRequest(new URL(path, "https://openlen.com"), { headers: { host: "openlen.com" } }));
  const location = res?.headers.get("location");
  return location ? new URL(location).search : null;
};

describe("the home's link to /new", () => {
  it("with the brief, opens the send flow as always", async () => {
    expect(await go("/es/new?brief=hola%20mundo")).toBe("?brief=hola+mundo&mode=ai");
  });

  it("🔴 with the ticket's id instead (a message too long for a URL), opens the same send flow", async () => {
    expect(await go("/es/new?first=0123456789abcdef")).toBe("?first=0123456789abcdef&mode=ai");
  });
});
