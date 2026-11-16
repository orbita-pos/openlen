// lib/len-bench/fresh-cookie.test.ts
// @vitest-environment node
//
// 16/11: the base column of battery 1 ran ~9 h on ONE cookie minted at start, which lives 6 h (`acunarCookie`).
// Its last 27 runs got 401 before Len saw a word. The real `decode` of Auth.js says whether a cookie still opens.
import { decode } from "next-auth/jwt";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freshCookie } from "./fresh-cookie";
import { acunarCookie } from "./sesion";

const ENV = { AUTH_SECRET: "secreto-de-prueba-de-treinta-y-dos-bytes" };
const OWNER = { id: "u-1", email: "eval@example.test" };
const HOUR = 60 * 60 * 1000;

async function opens(cookie: string): Promise<boolean> {
  const i = cookie.indexOf("=");
  const token = await decode({ token: cookie.slice(i + 1), secret: ENV.AUTH_SECRET, salt: cookie.slice(0, i) }).catch(() => null);
  return token?.sub === OWNER.id;
}

afterEach(() => vi.useRealTimers());

describe("freshCookie", () => {
  it("a cookie minted at the start of a column no longer opens after hour six", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T18:42:00Z"));
    const atStart = await acunarCookie({ userId: OWNER.id, email: OWNER.email, entorno: ENV });
    vi.setSystemTime(new Date(Date.now() + 6 * HOUR + 60_000));
    expect(await opens(atStart)).toBe(false);
  });

  it("a run that starts at hour nine gets a cookie that opens", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T18:42:00Z"));
    const mint = freshCookie(OWNER, ENV);
    expect(await opens(await mint())).toBe(true);
    vi.setSystemTime(new Date(Date.now() + 9 * HOUR));
    expect(await opens(await mint())).toBe(true);
  });
});
