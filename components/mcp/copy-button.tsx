"use client";
// Copiar un fragmento de la página de instalación.
import { useState } from "react";
import { useTranslations } from "next-intl";

export function CopyButton({ text }: { text: string }) {
  const t = useTranslations("projects.mcpInstall");
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
      }}
      className="rounded-full border px-3 py-1 text-xs"
    >
      {copied ? t("copied") : t("copy")}
    </button>
  );
}
