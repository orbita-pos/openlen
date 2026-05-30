"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

interface UseTemplateButtonProps {
  templateId: string;
  className?: string;
  label?: string;
}

/**
 * Public-facing "Use this template" CTA. Posts to /api/projects/from-template
 * with the templateId. On 401 (unauthenticated), routes to /login with a
 * `next` param so post-login lands back on the template page.
 */
export function UseTemplateButton({
  templateId,
  className = "",
  label,
}: UseTemplateButtonProps) {
  const t = useTranslations("marketing");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctaLabel = label ?? t("useTemplate.cta");

  const onClick = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/projects/from-template", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      if (res.status === 401) {
        const next = encodeURIComponent(`/templates/${templateId}`);
        router.push(`/login?next=${next}`);
        return;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        setError(
          t("useTemplate.errorStatus", {
            status: res.status,
            detail: body.slice(0, 120),
          }),
        );
        setLoading(false);
        return;
      }
      const data = (await res.json()) as { projectId?: string };
      if (data.projectId) {
        router.push(`/new?project=${data.projectId}`);
      } else {
        setError(t("useTemplate.unexpectedResponse"));
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("useTemplate.networkError"));
      setLoading(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-stretch gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className={
          className ||
          "inline-flex items-center justify-center gap-1.5 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 px-5 py-2.5 text-sm font-medium hover:brightness-110 active:brightness-95 transition disabled:opacity-60 disabled:cursor-not-allowed"
        }
      >
        {loading ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            <span>{t("useTemplate.creating")}</span>
          </>
        ) : (
          <>
            <span>{ctaLabel}</span>
            <ArrowRight size={14} />
          </>
        )}
      </button>
      {error && (
        <span className="text-[11px] text-rose-600 dark:text-rose-400 px-2">
          {error}
        </span>
      )}
    </div>
  );
}
