// HER PLACE'S ADDRESS (spec local 2026-11-06-asistente-propio, §6.8, phase 4D): renaming her moves it, and the old one
// redirects for good to the new one, as a renamed GitHub repository does. A live name always wins over an old one.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  permanentRedirect: vi.fn((_a: { href: string; locale: string }) => {
    throw new Error("NEXT_REDIRECT");
  }),
  redirect: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  auth: vi.fn(async () => ({ user: { id: "u1" } })),
  assistantBySlug: vi.fn(async (): Promise<unknown> => null),
  assistantByOldSlug: vi.fn(async (): Promise<unknown> => null),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: m.notFound }));
vi.mock("@/i18n/navigation", () => ({ redirect: m.redirect, permanentRedirect: m.permanentRedirect }));
vi.mock("@/auth", () => ({ auth: m.auth }));
vi.mock("@/lib/assistants/enabled", () => ({ assistantsEnabled: () => true }));
vi.mock("@/lib/assistants/store", () => ({ assistantBySlug: m.assistantBySlug, assistantByOldSlug: m.assistantByOldSlug }));
vi.mock("@/lib/projects", () => ({ getProject: vi.fn() }));
vi.mock("@/lib/projects/chat", () => ({ getChatMessages: vi.fn() }));
vi.mock("@/lib/assistants/visitor/store", () => ({ assistantOnPage: vi.fn() }));
vi.mock("@/components/workspace-v2/assistant/assistant-home", () => ({ AssistantHome: () => null }));
vi.mock("@/app/[locale]/new/tokens.css", () => ({}));

const { default: AssistantPage } = await import("./page");
const open = (name: string) => AssistantPage({ params: Promise.resolve({ locale: "es", name }) });

beforeEach(() => vi.clearAllMocks());

describe("her place's address", () => {
  it("🔴 an old address redirects for good to her new one", async () => {
    m.assistantByOldSlug.mockResolvedValueOnce({ slug: "marta" });
    await expect(open("lucia")).rejects.toThrow("NEXT_REDIRECT");
    expect(m.assistantByOldSlug).toHaveBeenCalledWith("u1", "lucia");
    expect(m.permanentRedirect).toHaveBeenCalledWith({ href: "/assistant/marta", locale: "es" });
  });

  // Final review I1: a slug of another script (names.ts keeps them) goes into the Location header encoded — raw, Node
  // refuses the header and the redirect is a 500.
  it("🔴 an old address redirects to a new name in another script, encoded", async () => {
    m.assistantByOldSlug.mockResolvedValueOnce({ slug: "さくら" });
    await expect(open("lucia")).rejects.toThrow("NEXT_REDIRECT");
    expect(m.permanentRedirect).toHaveBeenCalledWith({ href: "/assistant/%E3%81%95%E3%81%8F%E3%82%89", locale: "es" });
  });

  it("an address that was never hers is 404", async () => {
    await expect(open("nadie")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(m.permanentRedirect).not.toHaveBeenCalled();
  });
});
