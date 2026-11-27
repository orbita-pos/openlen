// THE WINDOW OF AN APP ON THE DESKTOP (spec local 2026-11-26-apps-en-el-escritorio, §4.3): `/desktop/<id>`, outside the
// locale segment like `app/p/` — its `scope` and `start_url` can't depend on the language, or switching it would break the
// installed app. The state (`desktopWindow`) decides everything: the frame of the frozen release, or a notice when there is no
// app to show; no session goes to the login and back, and an id that is not the person's is the same page as one that
// never existed. Never cached, never indexed.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";

import { DesktopNotice } from "@/components/desktop-apps/desktop-notice";
import { DesktopWindow } from "@/components/desktop-apps/desktop-window";
import { desktopRequest, requestLocale } from "@/lib/desktop-apps/page-request";
import { windowMessages } from "@/lib/desktop-apps/window-messages";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { state } = await desktopRequest(id);
  const name = state.kind === "ready" || state.kind === "plan_required" || state.kind === "gone" ? state.name : undefined;
  const shown = state.kind === "ready" || state.kind === "plan_required";
  return {
    title: name ?? "OpenLen",
    // The window's own manifest link is in the layout (it needs the cookie, which Next's metadata link can't ask for): this
    // keeps OpenLen's own manifest off a window that is another app.
    manifest: null,
    robots: { index: false, follow: false },
    ...(shown ? { icons: { icon: [{ url: `/desktop/${id}/icon`, sizes: "any" }] } } : {}),
  };
}

export default async function DesktopPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [locale, { state, personName }] = await Promise.all([requestLocale(), desktopRequest(id)]);
  if (state.kind === "off") notFound();
  // `next`, which the login reads: it comes back through `/<locale>/desktop/<id>`, which the middleware sends here.
  if (state.kind === "sign_in") redirect(`/${locale}/login?next=${encodeURIComponent(`/desktop/${id}`)}`);
  // Its own texts and, for a tool framed with OpenLen's dialogs around it, theirs (`lib/desktop-apps/window-messages.ts`).
  const messages = await windowMessages(locale, { tool: state.kind === "ready" && state.toolInstallationId !== null });
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {state.kind === "ready" ? (
        <DesktopWindow
          name={state.name}
          frameUrl={state.frameUrl}
          frameOrigin={state.frameOrigin}
          projectId={state.projectId}
          releaseSha={state.releaseSha}
          toolInstallationId={state.toolInstallationId}
          installedAt={state.installedAt}
          locale={locale}
          personName={personName}
        />
      ) : state.kind === "plan_required" ? (
        <DesktopNotice kind="plan_required" name={state.name} locale={locale} />
      ) : (
        <DesktopNotice kind="gone" name={state.name} locale={locale} />
      )}
    </NextIntlClientProvider>
  );
}
