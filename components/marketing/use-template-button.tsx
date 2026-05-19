"use client";

import { useRouter } from "next/navigation";
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
  label = "Usar este template",
}: UseTemplateButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setError(`Error ${res.status}: ${body.slice(0, 120)}`);
        setLoading(false);
        return;
      }
      const data = (await res.json()) as { projectId?: string };
      if (data.projectId) {
        router.push(`/new-v2?project=${data.projectId}`);
      } else {
        setError("Respuesta inesperada del servidor");
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
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
            <span>Creando proyecto…</span>
          </>
        ) : (
          <>
            <span>{label}</span>
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
