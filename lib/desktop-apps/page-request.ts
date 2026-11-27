// WHAT THE WINDOW'S LAYOUT AND PAGE ASK OF THE REQUEST (spec local 2026-11-26-apps-en-el-escritorio, §4.3), once per request:
// the language (NEXT_LOCALE cookie, then Accept-Language, then English — this page is outside the locale segment) and the
// state of the window for the person who is asking. `cache` makes the layout, `generateMetadata` and the page share one
// answer instead of reading the row three times.
import "server-only";

import { cookies, headers } from "next/headers";
import { cache } from "react";

import { auth } from "@/auth";

import { desktopLocale, type DesktopLocale } from "./locale";
import { desktopWindow, type DesktopPageState } from "./page-state";

export const requestLocale = cache(async (): Promise<DesktopLocale> => {
  const [jar, list] = await Promise.all([cookies(), headers()]);
  return desktopLocale({ cookie: jar.get("NEXT_LOCALE")?.value, acceptLanguage: list.get("accept-language") });
});

export const desktopRequest = cache(async (id: string): Promise<{ state: DesktopPageState; personName: string }> => {
  const [session, list] = await Promise.all([auth(), headers()]);
  const { state } = await desktopWindow({ id, sessionUserId: session?.user?.id ?? null, requestHost: list.get("host") });
  return { state, personName: session?.user?.name ?? "" };
});
