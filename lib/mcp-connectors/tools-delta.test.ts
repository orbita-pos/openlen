// THE CONNECTOR TOOLS DELTA (lib/mcp-connectors/tools-delta.ts): the tools a person's connectors give a turn change
// between turns — a server signs in, is removed, the project is shared —, and the conversation itself must say so. Seen
// on 25/11 in production: with Google Calendar's nine tools declared, Len read an old failure in the history and told the
// person they «hadn't arrived»; the same tools in a fresh chat were called at once.
import { describe, expect, it } from "vitest";

import type { Message } from "@/lib/ai-gateway";
import { AMBIENT } from "@/lib/agent/subagents/agent-listing";

import { announcedConnectorTools, connectorToolsMessage } from "./tools-delta";

const said = (text: string) => ({ role: "user", content: text }) as Message;
const CAL = ["mcp__google-calendar__list_events", "mcp__google-calendar__create_event"];

describe("connectorToolsMessage", () => {
  it("nothing to say without connector tools and nothing announced", () => {
    expect(connectorToolsMessage([], [said("hola")])).toBeNull();
  });

  it("🔴 announces the tools the conversation hasn't, sorted, as a reminder the model reads and the row keeps", () => {
    const m = connectorToolsMessage(CAL, [said("¿qué tengo esta semana?")])!;
    expect(m).toEqual({
      role: "user",
      content:
        "<system-reminder>\nThese tools from the person's connectors are available from now on; call them directly when they help:\n- mcp__google-calendar__create_event\n- mcp__google-calendar__list_events\n</system-reminder>",
      connectorTools: { added: ["mcp__google-calendar__create_event", "mcp__google-calendar__list_events"], removed: [] },
    });
  });

  it("once announced, the same conversation asks for nothing more", () => {
    const first = connectorToolsMessage(CAL, [])!;
    expect(connectorToolsMessage([...CAL].reverse(), [said("hola"), first, said("sigue")])).toBeNull();
  });

  it("🔴 a tool that is gone is said to be gone, so the model doesn't call it", () => {
    const first = connectorToolsMessage([...CAL, "mcp__google-calendar__authenticate"], [])!;
    const m = connectorToolsMessage(CAL, [first])!;
    expect(m.content).toBe(
      `<system-reminder>\nThese connector tools are no longer available; don't call them:\n- mcp__google-calendar__authenticate\n\n${AMBIENT}\n</system-reminder>`,
    );
    expect(m.connectorTools).toEqual({ added: [], removed: ["mcp__google-calendar__authenticate"] });
  });

  it("a sign-in that finishes swaps the authenticate tool for the server's real ones in one message", () => {
    const needsSignIn = connectorToolsMessage(["mcp__google-calendar__authenticate"], [])!;
    const m = connectorToolsMessage(CAL, [needsSignIn])!;
    expect(m.connectorTools).toEqual({ added: ["mcp__google-calendar__create_event", "mcp__google-calendar__list_events"], removed: ["mcp__google-calendar__authenticate"] });
    expect(m.content.indexOf("available from now on")).toBeLessThan(m.content.indexOf("no longer available"));
  });

  it("a tool that comes back is announced again", () => {
    const first = connectorToolsMessage(CAL, [])!;
    const gone = connectorToolsMessage([], [first])!;
    expect(gone.connectorTools).toEqual({ added: [], removed: ["mcp__google-calendar__create_event", "mcp__google-calendar__list_events"] });
    expect(connectorToolsMessage(CAL, [first, gone])?.connectorTools).toEqual({ added: ["mcp__google-calendar__create_event", "mcp__google-calendar__list_events"], removed: [] });
  });
});

describe("announcedConnectorTools", () => {
  it("folds what the conversation's messages announced, in order", () => {
    const history: Pick<Message, "connectorTools">[] = [
      { connectorTools: { added: ["a", "b"], removed: [] } },
      {},
      { connectorTools: { added: ["c"], removed: ["a"] } },
    ];
    expect([...announcedConnectorTools(history)].sort()).toEqual(["b", "c"]);
  });
});
