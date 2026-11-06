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
    expect(leaveFirstMessage({ brief: BRIEF, kind: "app" }, T0)).toBe(true);
    expect(takeFirstMessage(BRIEF, T0 + 5_000)).toEqual({ brief: BRIEF, kind: "app" });
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
    expect(leaveFirstMessage({ brief: BRIEF, kind: "pagina" }, T0)).toBe(false);
    expect(takeFirstMessage(BRIEF, T0)).toBeNull();
    expect(() => dropFirstMessage()).not.toThrow();
  });
});
