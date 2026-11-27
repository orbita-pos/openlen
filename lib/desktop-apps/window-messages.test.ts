// @vitest-environment node
import { describe, expect, it } from "vitest";

import { windowMessages } from "./window-messages";

type Sent = { wsChrome: { desktop: Record<string, unknown>; tools?: Record<string, unknown> } };

describe("windowMessages — what travels to the window's browser", () => {
  it("an ordinary app gets the window's own texts and nothing else", async () => {
    const sent = (await windowMessages("en", { tool: false })) as Sent;
    expect(Object.keys(sent)).toEqual(["wsChrome"]);
    expect(Object.keys(sent.wsChrome)).toEqual(["desktop"]);
    expect(Object.keys(sent.wsChrome.desktop)).toEqual(["install", "about", "gone", "planRequired"]);
  });

  it("🔴 a tool also gets the texts of the dialogs OpenLen draws around its frame: the data change, the job confirmation and its line, the file picker", async () => {
    const sent = (await windowMessages("en", { tool: true })) as Sent;
    expect(Object.keys(sent.wsChrome)).toEqual(["desktop", "tools"]);
    expect(Object.keys(sent.wsChrome.tools!).sort()).toEqual(["change", "files", "jobs"]);
    expect(Object.keys((sent.wsChrome.tools!.jobs as Record<string, unknown>)).sort()).toEqual(["confirm", "running"]);
    expect(Object.keys((sent.wsChrome.tools!.files as Record<string, unknown>))).toEqual(["pick"]);
    // The tools page and the connectors are the workspace's, not the window's.
    expect(sent.wsChrome.tools).not.toHaveProperty("page");
    expect(sent.wsChrome.tools).not.toHaveProperty("connectors");
  });

  it("in the person's language", async () => {
    const es = (await windowMessages("es", { tool: true })) as Sent;
    expect(JSON.stringify(es.wsChrome.desktop)).toContain("Acerca de");
    expect(JSON.stringify(es.wsChrome.tools)).toContain("Aplicar");
  });
});
