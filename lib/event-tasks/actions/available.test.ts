// What a task's card may propose (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.1): what its source
// offers, and a reply only with the project's email ready — DeepSeek's channels, declared by each source.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => ({ db: {}, schema: await import("@/lib/db/schema") }));
vi.mock("@/lib/backend/live-read", () => ({ queryLive: vi.fn() }));
const fakeSources = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../sources", async (original) => {
  const real = await original<typeof import("../sources")>();
  return { ...real, sourceOf: (kind: string) => fakeSources.get(kind) ?? real.sourceOf(kind as never) };
});

import type { EventTaskRow } from "../store";
import { availableActions } from "./available";

const task = (source: EventTaskRow["source"]) => ({ id: "t1", projectId: "p1", source }) as EventTaskRow;
const ready = (yes: boolean) => ({ emailReady: vi.fn(async () => yes) });

describe("availableActions", () => {
  it("app_rows offers project, data_change and reply when email is ready", async () => {
    const deps = ready(true);
    expect(await availableActions(task("app_rows"), "owner", deps)).toEqual({ project: true, dataChange: true, replyChannels: ["email"] });
    expect(deps.emailReady).toHaveBeenCalledWith("p1");
  });

  it("without project email no source offers reply", async () => {
    expect(await availableActions(task("app_rows"), "owner", ready(false))).toEqual({ project: true, dataChange: true, replyChannels: [] });
    expect(await availableActions(task("form_submissions"), "owner", ready(false))).toEqual({ project: true, dataChange: false, replyChannels: [] });
  });

  it("form_submissions never offers data_change", async () => {
    expect(await availableActions(task("form_submissions"), "owner", ready(true))).toEqual({ project: true, dataChange: false, replyChannels: ["email"] });
  });

  it("a GitHub check that fails offers no GitHub reply instead of failing the judge", async () => {
    fakeSources.set("app_rows", { kind: "app_rows", offers: { dataChange: false, replies: ["github"] } });
    const githubReady = vi.fn(async () => {
      throw new Error("connect ETIMEDOUT");
    });
    expect(await availableActions(task("app_rows"), "owner", { ...ready(true), githubReady })).toEqual({ project: true, dataChange: false, replyChannels: [] });
    fakeSources.clear();
  });

  it("GitHub replies are offered only while a token can be had", async () => {
    fakeSources.set("app_rows", { kind: "app_rows", offers: { dataChange: false, replies: ["github"] } });
    expect(await availableActions(task("app_rows"), "owner", { ...ready(true), githubReady: vi.fn(async () => false) })).toEqual({ project: true, dataChange: false, replyChannels: [] });
    const githubReady = vi.fn(async () => true);
    expect(await availableActions(task("app_rows"), "owner", { ...ready(true), githubReady })).toEqual({ project: true, dataChange: false, replyChannels: ["github"] });
    expect(githubReady).toHaveBeenCalledWith("p1", "owner");
    fakeSources.clear();
  });

  it("email is offered only with the project's email ready; other channels as the source offers them", async () => {
    fakeSources.set("app_rows", { kind: "app_rows", offers: { dataChange: false, replies: ["email", "chat"] } });
    expect(await availableActions(task("app_rows"), "owner", ready(false))).toEqual({ project: true, dataChange: false, replyChannels: ["chat"] });
    expect(await availableActions(task("app_rows"), "owner", ready(true))).toEqual({ project: true, dataChange: false, replyChannels: ["email", "chat"] });
    fakeSources.clear();
  });
});
