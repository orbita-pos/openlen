import { describe, expect, it } from "vitest";

import type { Message } from "@/lib/ai-gateway";

import { agentListingMessage, announcedAgentTypes } from "./agent-listing";
import { resolveAgentTypes } from "./agent-registry";

const file = (name: string, extra = "") => ({ name, text: `---\nname: ${name}\ndescription: ${name} does it\n${extra}---\nWork.`, updatedAt: new Date(0) });
const types = (project: string[], personal: string[] = []) => resolveAgentTypes({ project: project.map((n) => file(n)), personal: personal.map((n) => file(n)) });

describe("agentListingMessage (Claude Code 2.1.330's agent_listing_delta)", () => {
  it("nothing to say without custom types: OpenLen's and Claude Code's are in the declaration", () => {
    expect(agentListingMessage(types([]), [])).toBeNull();
  });

  it("announces the custom types the conversation hasn't, sorted, one line each with what they may use", () => {
    const m = agentListingMessage(types(["zeta", "alpha"]), [{ role: "user", content: "hola" } as Message])!;
    expect(m).toEqual({
      role: "user",
      content: "<system-reminder>\nNew agent types are now available for the subagent tool:\n- alpha: alpha does it (Tools: All tools)\n- zeta: zeta does it (Tools: All tools)\n</system-reminder>",
      agentListing: { added: ["alpha", "zeta"], removed: [] },
    });
  });

  it("once announced, the same conversation asks for nothing more — also with an edited description", () => {
    const first = agentListingMessage(types(["reviewer"]), [])!;
    expect(agentListingMessage(types(["reviewer"]), [first])).toBeNull();
    const edited = resolveAgentTypes({ project: [{ ...file("reviewer"), text: "---\nname: reviewer\ndescription: Something else\n---\nWork." }], personal: [] });
    expect(agentListingMessage(edited, [first])).toBeNull();
  });

  it("only what is new goes in a later delta", () => {
    const first = agentListingMessage(types(["reviewer"]), [])!;
    expect(agentListingMessage(types(["reviewer", "teacher"]), [first])!.agentListing).toEqual({ added: ["teacher"], removed: [] });
  });

  it("a type announced and gone is said gone, with Claude Code's ambient line", () => {
    const first = agentListingMessage(types(["reviewer", "teacher"]), [])!;
    const gone = agentListingMessage(types(["teacher"]), [first])!;
    expect(gone.content).toBe(
      "<system-reminder>\nThe following agent types are no longer available:\n- reviewer\n\nThis is ambient context — do not narrate it to the user unless they ask or it is directly relevant to their request.\n</system-reminder>",
    );
    expect(gone.agentListing).toEqual({ added: [], removed: ["reviewer"] });
    // And back again: new once more.
    expect(agentListingMessage(types(["reviewer", "teacher"]), [first, gone])!.agentListing).toEqual({ added: ["reviewer"], removed: [] });
  });

  it("a type that was never announced and is gone says nothing", () => {
    expect(agentListingMessage(types([]), [{ role: "user", content: "x" } as Message])).toBeNull();
  });

  it("Claude Code's (Tools: …), OpenLen's note on a personal type over the project's, and the 500 cap", () => {
    const set = resolveAgentTypes({
      project: [file("reviewer"), file("limited", "tools: Read, Grep, Bash\ndisallowedTools: Bash\n"), file("denied", "disallowedTools: Write\n")],
      personal: [{ ...file("reviewer"), text: `---\nname: reviewer\ndescription: ${"d".repeat(600)}\n---\nWork.` }],
    });
    const text = agentListingMessage(set, [])!.content;
    expect(text).toContain("- limited: limited does it (Tools: Read, Grep)\n");
    expect(text).toContain("- denied: denied does it (Tools: All tools except Write)\n");
    expect(text).toContain(`- reviewer (yours, over the project's reviewer): ${"d".repeat(500)} (Tools: All tools)\n`);
    expect(text).not.toContain("d".repeat(501));
  });

  it("folds from the conversation: added adds, removed takes away (Claude Code's WLi)", () => {
    const m = (added: string[], removed: string[] = []) => ({ agentListing: { added, removed } });
    expect([...announcedAgentTypes([m(["a", "b"]), {}, m([], ["a"]), m(["c"])])].sort()).toEqual(["b", "c"]);
  });
});
