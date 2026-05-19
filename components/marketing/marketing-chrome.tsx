"use client";

import type { ReactNode } from "react";
import { useDarkMode } from "@/lib/use-dark-mode";
import { Nav } from "./nav";
import { Footer } from "./footer";

/**
 * Client-side wrapper that owns the dark-mode hook + renders Nav + Footer
 * around its children. Lets server-rendered marketing pages compose the
 * standard chrome without each one needing to be `"use client"` themselves.
 */
export function MarketingChrome({ children }: { children: ReactNode }) {
  const [dark, toggleDark] = useDarkMode();
  return (
    <>
      <Nav dark={dark} onToggleDark={toggleDark} />
      <main className="flex-1">{children}</main>
      <Footer />
    </>
  );
}
