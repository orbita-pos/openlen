"use client";

import type { ReactNode } from "react";
import { useDarkMode } from "@/lib/use-dark-mode";
import { Nav } from "./nav";
import { Footer } from "./footer";
import { HomeFooter } from "./home-footer";
import { HeroLenMark } from "./hero-len";

/**
 * Client-side wrapper that owns the dark-mode hook + renders Nav + Footer
 * around its children. Lets server-rendered marketing pages compose the
 * standard chrome without each one needing to be `"use client"` themselves.
 *
 * `variant="home"` (spec local 2026-11-06-portada-solo-input): the home is only the input and always dark, so no theme
 * toggle (it would do nothing there) and a one-row footer instead of the big one.
 */
export function MarketingChrome({ children, variant = "default" }: { children: ReactNode; variant?: "default" | "home" }) {
  const [dark, toggleDark] = useDarkMode();
  const home = variant === "home";
  return (
    <>
      <Nav
        dark={dark}
        onToggleDark={toggleDark}
        themeToggle={!home}
        {...(home ? { mark: <HeroLenMark className="h-7 w-7 shrink-0" /> } : {})}
      />
      {/* On the home, a flex column: its hero grows to fill the screen between the menu and the footer row. */}
      <main className={home ? "flex flex-1 flex-col" : "flex-1"}>{children}</main>
      {home ? <HomeFooter /> : <Footer />}
    </>
  );
}
