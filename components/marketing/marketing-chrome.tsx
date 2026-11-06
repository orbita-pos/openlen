"use client";

import type { ReactNode } from "react";
import { useDarkMode } from "@/lib/use-dark-mode";
import { Nav } from "./nav";
import { Footer } from "./footer";
import { HomeFooter } from "./home-footer";

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
      <Nav dark={dark} onToggleDark={toggleDark} themeToggle={!home} />
      <main className="flex-1">{children}</main>
      {home ? <HomeFooter /> : <Footer />}
    </>
  );
}
