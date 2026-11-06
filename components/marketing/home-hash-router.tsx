"use client";

// Acts on the home's hash (`lib/marketing/home-hash.ts`) on load and on every later `hashchange`: a client navigation
// to `/#pricing` doesn't reload the page, so reading it once on mount would miss it. Renders nothing.

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { homeHashAction } from "@/lib/marketing/home-hash";

export function HomeHashRouter() {
  const router = useRouter();

  useEffect(() => {
    const act = () => {
      const action = homeHashAction(window.location.hash);
      if (!action) return;
      if (action.kind === "go") {
        router.replace(action.path);
        return;
      }
      document.getElementById(action.id)?.focus({ preventScroll: true });
      history.replaceState(null, "", window.location.pathname + window.location.search);
    };
    act();
    window.addEventListener("hashchange", act);
    return () => window.removeEventListener("hashchange", act);
  }, [router]);

  return null;
}
