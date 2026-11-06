"use client";

// THE HOME IN THE START FRAME (Jesús, 06/11, on Gemini's sidebar: «/new y / quiero que sea compartido»): the same rail
// and top row as /new without a project (`components/workspace-v2/start-rail.tsx`), around the hero. It replaces the
// marketing menu on the home; every other marketing page keeps `MarketingChrome`.
//
// Without an account its places go to their public pages (Plantillas, Comunidad) or to sign in (Mis páginas), and the
// corner offers Precios, Iniciar sesión and Pruébalo gratis, like Gemini's «Get app» and «Upgrade». With one, they
// open in the workspace, the corner shows the credits and the account sits at the rail's foot. While the session
// loads the corner stays empty, so nobody signed in sees «sign in» flash. Features, Docs, GitHub and the legal pages
// live in the footer row: the rail is for using OpenLen, not a site menu.
//
// The workspace's tokens come with it (`.workspace-v2` here, under the home's fixed `.dark`): the rail, the credits
// pill and the account menu are the workspace's own.

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { ArrowRight } from "lucide-react";
import "@/app/[locale]/new/tokens.css";
import { Link } from "@/i18n/navigation";
import { useDarkMode } from "@/lib/use-dark-mode";
import { CreditPill } from "@/components/app/credit-pill";
import { AccountMenu } from "@/components/workspace-v2/account-menu";
import { StartRail, StartTopRow, type StartItem } from "@/components/workspace-v2/start-rail";
import { HeroLenMark } from "./hero-len";
import { HomeFooter } from "./home-footer";

/** Where «Mis páginas» lands after signing in. */
const MINE = "/new?view=projects";

export function HomeShell({ children }: { children: ReactNode }) {
  const t = useTranslations("marketing");
  const tw = useTranslations("wsChrome");
  const { status } = useSession();
  const [dark, toggleDark] = useDarkMode();
  const [menuOpen, setMenuOpen] = useState(false);
  const signedIn = status === "authenticated";

  const items: StartItem[] = [
    // The home IS where you create: Crear brings you back to the box (`#ask` focuses it, `home-hash.ts`).
    { key: "crear", label: tw("startTabs.crear"), href: "/#ask" },
    { key: "plantillas", label: tw("startTabs.plantillas"), href: signedIn ? "/new?mode=template" : "/templates" },
    { key: "mispaginas", label: tw("startTabs.mispaginas"), href: signedIn ? MINE : `/login?next=${encodeURIComponent(MINE)}` },
    { key: "comunidad", label: tw("startTabs.comunidad"), href: signedIn ? "/new?view=explore" : "/explore" },
  ];

  const corner =
    status === "loading" ? null : signedIn ? (
      <CreditPill />
    ) : (
      <>
        <Link
          href="/pricing"
          className="hidden h-9 items-center rounded-full px-3 text-[14px] font-medium text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white sm:inline-flex"
        >
          {t("nav.links.pricing")}
        </Link>
        <Link
          href="/login"
          className="hidden h-9 items-center rounded-full bg-white/10 px-4 text-[14px] font-medium text-zinc-100 transition-colors hover:bg-white/[0.15] sm:inline-flex"
        >
          {t("nav.signIn")}
        </Link>
        <Link
          href="/register"
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-coral-700 px-4 text-[14px] font-medium text-white transition-colors hover:bg-coral-800 active:bg-coral-900"
        >
          {t("nav.tryFree")} <ArrowRight size={14} />
        </Link>
      </>
    );

  return (
    // `!bg-transparent`: `.workspace-v2` paints the workspace's background, which covered the home's light (it sits at
    // z-index -1, under every in-flow background of the home).
    <div className="workspace-v2 flex min-h-[100svh] flex-1 !bg-transparent">
      <StartRail
        items={items}
        active="crear"
        mark={
          <Link href="/" aria-label="OpenLen" className="flex">
            <HeroLenMark className="h-8 w-8 shrink-0" />
          </Link>
        }
        {...(signedIn ? { account: <AccountMenu dark={dark} onToggleDark={toggleDark} /> } : {})}
        drawerOpen={menuOpen}
        onCloseDrawer={() => setMenuOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <StartTopRow homeHref="/" onOpenMenu={() => setMenuOpen(true)} right={corner} />
        <main className="flex flex-1 flex-col">{children}</main>
        <HomeFooter />
      </div>
    </div>
  );
}
