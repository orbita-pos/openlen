"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { ToastProvider } from "@/components/workspace-v2/toast";

// Same workspace-lock as /new — keep document at viewport height so the
// three-region layout owns scroll inside its panels.
export default function NewV2Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("common");
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
  // ToastProvider wraps the whole workspace so TopBar, the page orchestrator,
  // and every modal can surface success/error toasts via useToast().
  return <ToastProvider dismissLabel={t("close")}>{children}</ToastProvider>;
}
