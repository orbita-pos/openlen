// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FIRST_MESSAGE_TTL_MS,
  dropFirstMessage,
  leaveFirstMessage,
  takeFirstMessage,
} from "./first-message-in-transit";

const BRIEF = "Una página para mi panadería, con pedidos por WhatsApp";
const T0 = 1_800_000_000_000;

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("the first message sent from the home", () => {
  it("comes back on arrival at /new with the same brief, with its kind", () => {
    expect(leaveFirstMessage({ brief: BRIEF, kind: "app" }, T0)).toMatch(/^[0-9a-f]{16}$/);
    expect(takeFirstMessage(BRIEF, T0 + 5_000)).toEqual({ brief: BRIEF, kind: "app" });
  });

  // 24/11: no cap on what the home sends (Claude Code has none). A message too long for a URL travels only in the ticket, and
  // /new arrives with the ticket's id (`?first=<id>`) instead of the brief; the id is what a link from elsewhere can't forge.
  it("🔴 a long message comes back whole when /new arrives with the ticket's id, and never with another id", () => {
    const long = "x".repeat(20_000);
    const id = leaveFirstMessage({ brief: long, kind: "pagina" }, T0)!;
    expect(takeFirstMessage({ first: "0123456789abcdef" }, T0 + 5_000)).toBeNull();
    leaveFirstMessage({ brief: long, kind: "pagina" }, T0);
    const again = leaveFirstMessage({ brief: long, kind: "pagina" }, T0)!;
    expect(again).not.toBe(id);
    expect(takeFirstMessage({ first: again }, T0 + 5_000)).toEqual({ brief: long, kind: "pagina" });
  });

  // AGENTS FOR EVERYONE (spec local 2026-11-19-agentes-para-todos, §6.3): the home's Agente sends to the space.
  it("keeps an agent's kind, for the space to send it", () => {
    leaveFirstMessage({ brief: BRIEF, kind: "agent" }, T0);
    expect(takeFirstMessage(BRIEF, T0 + 5_000)).toEqual({ brief: BRIEF, kind: "agent" });
  });

  // WORKSPACE THEMES (spec local 2026-11-27-temas-del-workspace, §4.1): «Nuevo tema» sends the home's ticket with kind theme.
  it("keeps a theme's kind, for /new to be born as one", () => {
    leaveFirstMessage({ brief: BRIEF, kind: "theme" }, T0);
    expect(takeFirstMessage(BRIEF, T0 + 5_000)).toEqual({ brief: BRIEF, kind: "theme" });
  });

  it("is used once: reloading /new does not send it again", () => {
    leaveFirstMessage({ brief: BRIEF, kind: "pagina" }, T0);
    takeFirstMessage(BRIEF, T0);
    expect(takeFirstMessage(BRIEF, T0)).toBeNull();
  });

  it("compares the briefs trimmed, as /new reads the link's", () => {
    leaveFirstMessage({ brief: `  ${BRIEF}\n`, kind: "pagina" }, T0);
    expect(takeFirstMessage(`${BRIEF} `, T0)).toEqual({ brief: BRIEF, kind: "pagina" });
  });

  it("is not sent when /new arrives with another brief, or none (a link from elsewhere, the menu), and is gone", () => {
    leaveFirstMessage({ brief: BRIEF, kind: "pagina" }, T0);
    expect(takeFirstMessage("Otra cosa que alguien puso en un enlace", T0)).toBeNull();
    expect(takeFirstMessage(BRIEF, T0)).toBeNull();

    leaveFirstMessage({ brief: BRIEF, kind: "pagina" }, T0);
    expect(takeFirstMessage(null, T0)).toBeNull();
    expect(takeFirstMessage(BRIEF, T0)).toBeNull();
  });

  it("goes stale after 30 minutes", () => {
    leaveFirstMessage({ brief: BRIEF, kind: "pagina" }, T0);
    expect(takeFirstMessage(BRIEF, T0 + FIRST_MESSAGE_TTL_MS + 1)).toBeNull();
    expect(FIRST_MESSAGE_TTL_MS).toBe(30 * 60_000);
  });

  it("is not sent when the brief is too short to send", () => {
    leaveFirstMessage({ brief: "hola", kind: "pagina" }, T0);
    expect(takeFirstMessage("hola", T0)).toBeNull();
  });

  it("reads an unknown kind as a page", () => {
    sessionStorage.setItem(
      "openlen:first-message-in-transit",
      JSON.stringify({ brief: BRIEF, kind: "spaceship", at: T0 }),
    );
    expect(takeFirstMessage(BRIEF, T0)).toEqual({ brief: BRIEF, kind: "pagina" });
  });

  it("ignores what is not a ticket", () => {
    sessionStorage.setItem("openlen:first-message-in-transit", "{not json");
    expect(takeFirstMessage(BRIEF, T0)).toBeNull();
    sessionStorage.setItem("openlen:first-message-in-transit", JSON.stringify({ brief: 3, at: T0 }));
    expect(takeFirstMessage(BRIEF, T0)).toBeNull();
  });

  it("is dropped when the visitor closes the sign-in dialog", () => {
    leaveFirstMessage({ brief: BRIEF, kind: "pagina" }, T0);
    dropFirstMessage();
    expect(takeFirstMessage(BRIEF, T0)).toBeNull();
  });

  it("never throws when the storage does (a private window, a full quota)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(leaveFirstMessage({ brief: BRIEF, kind: "pagina" }, T0)).toBeNull();
    expect(takeFirstMessage(BRIEF, T0)).toBeNull();
    expect(() => dropFirstMessage()).not.toThrow();
  });
});
