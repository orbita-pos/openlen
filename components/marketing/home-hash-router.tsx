"use client";

// Acts on the home's hash (`lib/marketing/home-hash.ts`) on mount and on every later `hashchange`. The mount covers a
// fresh load and a client navigation from another page (Next updates the URL before effects run). `hashchange` covers
// what changes the hash while the home is open: a plain `<a href="#pricing">`, an edit in the address bar, back and
// forward. (A Next `<Link>` to `/#pricing` rendered ON the home would use `pushState`, which fires no `hashchange`:
// none exists, and none should.) Renders nothing.

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
