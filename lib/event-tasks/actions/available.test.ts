// What a task's card may propose (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.1): what its source
// offers, and a reply only with the project's email ready — DeepSeek's channels, declared by each source.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {}, schema: { formSubmissions: {}, projects: {} } }));
vi.mock("@/lib/backend/live-read", () => ({ queryLive: vi.fn() }));

import type { EventTaskRow } from "../store";
import { availableActions } from "./available";

const task = (source: EventTaskRow["source"]) => ({ id: "t1", projectId: "p1", source }) as EventTaskRow;
const ready = (yes: boolean) => ({ emailReady: vi.fn(async () => yes) });

describe("availableActions", () => {
  it("app_rows offers project, data_change and reply when email is ready", async () => {
    const deps = ready(true);
    expect(await availableActions(task("app_rows"), deps)).toEqual({ project: true, dataChange: true, reply: true });
    expect(deps.emailReady).toHaveBeenCalledWith("p1");
  });

  it("without project email no source offers reply", async () => {
    expect(await availableActions(task("app_rows"), ready(false))).toEqual({ project: true, dataChange: true, reply: false });
    expect(await availableActions(task("form_submissions"), ready(false))).toEqual({ project: true, dataChange: false, reply: false });
  });

  it("form_submissions never offers data_change", async () => {
    expect(await availableActions(task("form_submissions"), ready(true))).toEqual({ project: true, dataChange: false, reply: true });
  });
});
