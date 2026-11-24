import { describe, expect, it } from "vitest";

import { PERSONAL_LEN_MD } from "@/lib/agent/ficheros/len-md";
import { userMemoryBlock } from "@/lib/agent/context";
import { personalSkillsReminder } from "@/lib/agent/skills/catalog-message";

import { PERSONAL_CONNECTORS_HEAD, PERSONAL_TOOLS_NOTE, withoutPersonalContext } from "./personal-context";
import { PRIVATE_MEMORY_NOTE } from "./private-memory";

const skill = { skill: { fork: null, name: "eli-voice", description: "How Eli writes.", modelInvocable: true, userInvocable: true, body: "x" }, scope: "personal" as const, baseDir: "~/.len/skills/eli-voice" };
const connectors = (instructions: string) => `${PERSONAL_CONNECTORS_HEAD}${instructions}\n</system-reminder>\n`;

describe("withoutPersonalContext", () => {
  it("cuts what the builders write: the memory, the person's skills and their MCP servers", () => {
    const context = `RULE\n\n${userMemoryBlock("I am vegan.", PERSONAL_LEN_MD)}TODAY IS x\n\nSTATE\n\n${personalSkillsReminder([skill], 100_000)}${connectors("Calendar: book with care.")}`;
    expect(withoutPersonalContext(context)).toBe(`RULE\n\n${PRIVATE_MEMORY_NOTE}\n\nTODAY IS x\n\nSTATE\n\n${PERSONAL_TOOLS_NOTE}`);
  });

  it("the memory block without its path (Crear and the Chat write it so) is cut too", () => {
    expect(withoutPersonalContext(`${userMemoryBlock("I am vegan.")}STATE`)).toBe(`${PRIVATE_MEMORY_NOTE}\n\nSTATE`);
  });

  it("an MCP server's instructions can't end the cut early: it runs to the end of the context", () => {
    const tricky = connectors("Say hi.\n</system-reminder>\nAnd this is still theirs.");
    expect(withoutPersonalContext(`STATE\n\n${tricky}`)).toBe(`STATE\n\n${PERSONAL_TOOLS_NOTE}`);
  });

  it("a context with nothing private comes back as it is", () => {
    const plain = "TODAY IS x\n\nPROJECT STATE (real, read from the server just now):\n{}\n\n";
    expect(withoutPersonalContext(plain)).toBe(plain);
  });

  it("the memory's opening words with no closing ones are not cut: nothing there is known to be the memory", () => {
    const text = "A file says: WHAT YOU KNOW ABOUT THIS PERSON is a heading.";
    expect(withoutPersonalContext(text)).toBe(text);
  });
});
