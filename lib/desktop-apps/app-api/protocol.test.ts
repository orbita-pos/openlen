// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  APP_API_CHANNEL,
  APP_API_PATH,
  appApiFail,
  appApiOk,
  isAppApiRequest,
  isAppApiResponse,
  parseRequestArgs,
  parseShowArgs,
  parseStateArgs,
  SHOW_BODY_MAX_CHARS,
} from "./protocol";

describe("the constants", () => {
  it("path and channel are the ones the frame and the window agree on", () => {
    expect(APP_API_PATH).toBe("/openlen-app.js");
    expect(APP_API_CHANNEL).toBe("openlen-app/1");
    expect(SHOW_BODY_MAX_CHARS).toBe(300);
  });
});

describe("parseShowArgs", () => {
  it("accepts {body:\"x\"}", () => {
    expect(parseShowArgs({ body: "x" })).toEqual({ body: "x" });
    expect(parseShowArgs({ body: "x".repeat(300) })).toEqual({ body: "x".repeat(300) });
  });

  it("rejects extra keys, empty, over 300, non-string with EINVAL", () => {
    const bad: unknown[] = [
      { body: "x", title: "t" },
      { body: "x", icon: "https://evil.example/i.png" },
      { body: "x", tag: "t" },
      { title: "t" },
      {},
      { body: "" },
      { body: "x".repeat(301) },
      { body: 1 },
      { body: null },
      { body: undefined },
      { body: ["x"] },
      { body: { toString: () => "x" } },
      "x",
      null,
      undefined,
      42,
      ["x"],
      [{ body: "x" }],
      new Map([["body", "x"]]),
    ];
    for (const args of bad) {
      const r = parseShowArgs(args);
      expect(r, JSON.stringify(args)).toMatchObject({ code: "EINVAL" });
      expect((r as { message: string }).message.length).toBeGreaterThan(0);
    }
  });

  it("an inherited or symbol key is not a way around the strict shape", () => {
    const withProto = Object.create({ body: "x" }) as object;
    expect(parseShowArgs(withProto)).toMatchObject({ code: "EINVAL" });
    expect(parseShowArgs({ body: "x", [Symbol("s")]: 1 })).toEqual({ body: "x" });
  });

  it("returns a fresh object holding only the body", () => {
    const given = { body: "hi" };
    const r = parseShowArgs(given);
    expect(r).not.toBe(given);
    expect(Object.keys(r)).toEqual(["body"]);
  });
});

describe("parseStateArgs and parseRequestArgs", () => {
  it("state takes no name (the whole map) or one of the five names", () => {
    expect(parseStateArgs({})).toEqual({ name: null });
    expect(parseStateArgs(undefined)).toEqual({ name: null });
    expect(parseStateArgs({ name: "notifications" })).toEqual({ name: "notifications" });
    expect(parseStateArgs({ name: "full-access" })).toEqual({ name: "full-access" });
  });

  it("state rejects an unknown name, a non-string, a null and extra keys with EINVAL", () => {
    for (const args of [{ name: "camera" }, { name: 1 }, { name: null }, { name: "" }, { name: "notifications", x: 1 }, "notifications", [], 7]) {
      expect(parseStateArgs(args), JSON.stringify(args)).toMatchObject({ code: "EINVAL" });
    }
  });

  it("request takes no names (everything declared) or a list of the five names, without repeats", () => {
    expect(parseRequestArgs({})).toEqual({ names: null });
    expect(parseRequestArgs(undefined)).toEqual({ names: null });
    expect(parseRequestArgs({ names: ["notifications"] })).toEqual({ names: ["notifications"] });
    expect(parseRequestArgs({ names: ["notifications", "notifications", "overlay"] })).toEqual({ names: ["notifications", "overlay"] });
    expect(parseRequestArgs({ names: [] })).toEqual({ names: [] });
  });

  it("request rejects a string, an unknown name, a non-array, extra keys and a long list with EINVAL", () => {
    for (const args of [{ names: "notifications" }, { names: ["camera"] }, { names: [1] }, { names: null }, { names: {} }, { names: [], x: 1 }, { names: Array(33).fill("notifications") }, "x", [], 7]) {
      expect(parseRequestArgs(args), JSON.stringify(args)).toMatchObject({ code: "EINVAL" });
    }
  });
});

describe("isAppApiRequest", () => {
  const ok = { channel: APP_API_CHANNEL, id: "a".repeat(36), method: "notification.show", args: { body: "x" } };

  it("accepts the four methods on the channel with a string id", () => {
    for (const method of ["permissions.state", "permissions.request", "permissions.manage", "notification.show"]) {
      expect(isAppApiRequest({ ...ok, method })).toBe(true);
    }
    expect(isAppApiRequest({ ...ok, args: undefined })).toBe(true);
  });

  it("rejects another channel, another method, a missing or odd id, and non-objects", () => {
    const bad: unknown[] = [
      { ...ok, channel: "openlen-tool" },
      { ...ok, channel: undefined },
      { ...ok, method: "notification.close" },
      { ...ok, method: undefined },
      { ...ok, id: 1 },
      { ...ok, id: "" },
      { ...ok, id: "x".repeat(129) },
      { ...ok, id: undefined },
      { jsonrpc: "2.0", id: 1, method: "context", channel: "openlen-tool" },
      null,
      undefined,
      "openlen-app/1",
      [],
    ];
    for (const m of bad) expect(isAppApiRequest(m), JSON.stringify(m)).toBe(false);
  });
});

describe("isAppApiResponse", () => {
  it("accepts an ok answer with or without a value, and an error answer with its code and message", () => {
    expect(isAppApiResponse({ channel: APP_API_CHANNEL, id: "i", ok: true, value: "granted" })).toBe(true);
    expect(isAppApiResponse({ channel: APP_API_CHANNEL, id: "i", ok: true })).toBe(true);
    for (const code of ["EPERM", "EINVAL", "ENOTSUP"]) {
      expect(isAppApiResponse({ channel: APP_API_CHANNEL, id: "i", ok: false, code, message: "no" })).toBe(true);
    }
  });

  it("rejects another channel, a non-string id, a missing ok, an unknown code or a missing message", () => {
    const bad: unknown[] = [
      { channel: "openlen-tool", id: "i", ok: true },
      { id: "i", ok: true },
      { channel: APP_API_CHANNEL, id: 1, ok: true },
      { channel: APP_API_CHANNEL, ok: true },
      { channel: APP_API_CHANNEL, id: "i" },
      { channel: APP_API_CHANNEL, id: "i", ok: "yes" },
      { channel: APP_API_CHANNEL, id: "i", ok: false, code: "EACCES", message: "no" },
      { channel: APP_API_CHANNEL, id: "i", ok: false, code: "EPERM" },
      { channel: APP_API_CHANNEL, id: "i", ok: false, message: "no" },
      { channel: APP_API_CHANNEL, id: "i", ok: false, code: "EPERM", message: 5 },
      null,
      undefined,
      "x",
      [],
    ];
    for (const m of bad) expect(isAppApiResponse(m), JSON.stringify(m)).toBe(false);
  });
});

describe("appApiOk and appApiFail", () => {
  it("build answers that pass the response check, for the id they answer", () => {
    expect(appApiOk("i1", "granted")).toEqual({ channel: APP_API_CHANNEL, id: "i1", ok: true, value: "granted" });
    expect(appApiFail("i2", "EPERM", "denied")).toEqual({ channel: APP_API_CHANNEL, id: "i2", ok: false, code: "EPERM", message: "denied" });
    expect(isAppApiResponse(appApiOk("i1", undefined))).toBe(true);
    expect(isAppApiResponse(appApiFail("i2", "ENOTSUP", "m"))).toBe(true);
  });
});
