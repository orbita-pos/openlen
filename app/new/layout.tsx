"use client";

import { useEffect } from "react";

// Lock the document to viewport height on md+ so the workspace's two panels
// own their scroll instead of the page scrolling underneath them. The
// marketing route still needs natural body scroll, so we apply this only
// while /new is mounted.
export default function NewLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.classList.add("workspace-locked");
    body.classList.add("workspace-locked");
    return () => {
      html.classList.remove("workspace-locked");
      body.classList.remove("workspace-locked");
    };
  }, []);
  return <>{children}</>;
}
