"use client";
// Los dos botones de la aprobación. POST con la cookie de la web.
import { useState } from "react";
import { useTranslations } from "next-intl";

export function Decision({ id }: { id: string }) {
  const t = useTranslations("projects.mcpApproval");
  const [state, setState] = useState<"idle" | "busy" | "approved" | "denied" | "failed">("idle");
  const decide = async (decision: "approve" | "deny") => {
    setState("busy");
    const res = await fetch(`/api/mcp/approvals/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    }).catch(() => null);
    setState(res?.ok ? (decision === "approve" ? "approved" : "denied") : "failed");
  };
  if (state === "approved") return <p className="text-base">{t("approved")}</p>;
  if (state === "denied") return <p className="text-base">{t("denied")}</p>;
  if (state === "failed") return <p className="text-base">{t("failed")}</p>;
  return (
    <div className="flex gap-3">
      <button
        type="button"
        disabled={state === "busy"}
        onClick={() => decide("approve")}
        className="rounded-full bg-black px-5 py-2.5 font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        {t("approve")}
      </button>
      <button
        type="button"
        disabled={state === "busy"}
        onClick={() => decide("deny")}
        className="rounded-full border px-5 py-2.5 font-semibold disabled:opacity-50"
      >
        {t("deny")}
      </button>
    </div>
  );
}
