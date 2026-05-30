"use client";

import { useEffect } from "react";

// Same workspace-lock as /new — keep document at viewport height so the
// three-region layout owns scroll inside its panels.
export default function NewV2Layout({
  children,
}: {
  children: React.ReactNode;
}) {
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
