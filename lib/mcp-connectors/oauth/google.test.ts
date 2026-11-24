// lib/mcp-connectors/oauth/google.test.ts
// @vitest-environment node
//
// Google gives a refresh token only to a web client that asks for offline access, and only on a consent screen
// (`prompt=consent`); without one the connection lapses an hour later (spec local
// 2026-11-24-servidor-de-google-calendar, §5.2). A later token set without a refresh token keeps the one before.
import { describe, expect, it } from "vitest";
import { withGoogleOfflineAccess, withKeptRefreshToken } from "./google";

const GOOGLE = "https://accounts.google.com";

describe("withGoogleOfflineAccess", () => {
  it("Google: access_type=offline and prompt=consent", () => {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth?client_id=c&scope=s");
    withGoogleOfflineAccess(url, GOOGLE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("client_id")).toBe("c");
  });

  it("another issuer: the URL doesn't change", () => {
    const before = "https://auth.example.com/authorize?client_id=c&scope=s";
    const url = new URL(before);
    withGoogleOfflineAccess(url, "https://auth.example.com");
    expect(url.toString()).toBe(before);
  });
});

describe("withKeptRefreshToken", () => {
  it("a token set without a refresh token keeps the one before", () => {
    const next = withKeptRefreshToken({ access_token: "a", refresh_token: "r", token_type: "Bearer" }, { access_token: "b", token_type: "Bearer" });
    expect(next).toEqual({ access_token: "b", refresh_token: "r", token_type: "Bearer" });
  });

  it("a new refresh token wins", () => {
    const next = withKeptRefreshToken({ access_token: "a", refresh_token: "r", token_type: "Bearer" }, { access_token: "b", refresh_token: "r2", token_type: "Bearer" });
    expect(next.refresh_token).toBe("r2");
  });

  it("with nothing before, the tokens are saved as they are", () => {
    const tokens = { access_token: "b", token_type: "Bearer" };
    expect(withKeptRefreshToken(null, tokens)).toEqual(tokens);
  });
});
