// @vitest-environment jsdom
//
// The account menu offers to resend the email that confirms the address (2026-10-22) when the person's
// email is still to confirm, with the real Spanish texts. Whether it is pending is the server's call
// (app/api/auth/verify-email, with its own test); this checks what the menu does with it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import topbar from "@/messages/es/topbar.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "u1", email: "ana@openlen.test", name: "Ana" } } }),
  signOut: vi.fn(),
}));
vi.mock("@/components/locale-switcher", () => ({ LocaleSwitcher: () => null }));

import { AccountMenu } from "./account-menu";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
let pending = true;
let postOk = true;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  pending = true;
  postOk = true;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/auth/verify-email" && init?.method === "POST") return { ok: postOk, json: async () => ({}) };
    if (url === "/api/auth/verify-email") return { ok: true, json: async () => ({ pending }) };
    return { ok: false, json: async () => null };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

async function openMenu(): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="es" messages={{ topbar }}>
        <AccountMenu dark={false} onToggleDark={() => {}} />
      </NextIntlClientProvider>,
    ),
  );
  await act(async () => {
    host.querySelector<HTMLButtonElement>("button[aria-haspopup='menu']")!.click();
  });
  return host;
}
const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

describe("🔴 the account menu and the email still to confirm", () => {
  it("says the email is not confirmed and resends the link on request", async () => {
    const host = await openMenu();
    expect(host.textContent).toContain(topbar.account.emailPending);
    await act(async () => {
      button(host, topbar.account.resend)!.click();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/verify-email", { method: "POST" });
    expect(host.textContent).toContain(topbar.account.resendSent);
    expect(button(host, topbar.account.resend)).toBeUndefined();
  });

  it("with the email confirmed (or a Google account), there is nothing to resend", async () => {
    pending = false;
    const host = await openMenu();
    expect(host.textContent).not.toContain(topbar.account.emailPending);
    expect(button(host, topbar.account.resend)).toBeUndefined();
  });

  it("if sending fails, it says so and the button stays to try again", async () => {
    postOk = false;
    const host = await openMenu();
    await act(async () => {
      button(host, topbar.account.resend)!.click();
    });
    expect(host.textContent).toContain(topbar.account.resendFailed);
    expect(button(host, topbar.account.resend)).toBeDefined();
  });
});
