import { expect, it } from "vitest";
import { artifactIdsOfTurn, centerContent } from "./center-content";

it("keeps the conversation in the center while there is nothing to show, as Claude does", () => {
  expect(centerContent({ hasPage: false, isApp: false, deliverables: 0 })).toBe("conversation");
});

it("shows a deliverable in the center when it is all the project has", () => {
  expect(centerContent({ hasPage: false, isApp: false, deliverables: 2 })).toBe("deliverable");
});

it("keeps the canvas for a page or an app, with or without deliverables", () => {
  expect(centerContent({ hasPage: true, isApp: false, deliverables: 0 })).toBe("canvas");
  expect(centerContent({ hasPage: true, isApp: false, deliverables: 3 })).toBe("canvas");
  expect(centerContent({ hasPage: false, isApp: true, deliverables: 1 })).toBe("canvas");
});

it("names the pieces a turn created or rendered, once each and in order", () => {
  const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222";
  expect(artifactIdsOfTurn([
    { tool: "Read", status: "done", summary: "" },
    { tool: "create_artifact", status: "done", summary: "draft", valores: JSON.stringify({ artifactId: a, revision: 0 }) },
    { tool: "create_artifact", status: "done", summary: "draft", valores: JSON.stringify({ artifactId: b, revision: 0 }) },
    { tool: "render_artifact", status: "done", summary: "queued", valores: JSON.stringify({ artifactId: a, revision: 2, jobId: "j" }) },
    { tool: "render_artifact", status: "error", summary: "invalid_slide_deck" },
  ])).toEqual([a, b]);
  // `valores` is cut at 200 characters on the client: the id is read even from a cut JSON.
  expect(artifactIdsOfTurn([{ tool: "render_artifact", status: "done", summary: "queued", valores: `{"artifactId":"${a}","revision":2,"jobId":"3333` }])).toEqual([a]);
  expect(artifactIdsOfTurn(undefined)).toEqual([]);
});
