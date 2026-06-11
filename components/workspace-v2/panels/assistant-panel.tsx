// Site-assistant settings panel (editing mode). Owner toggles the visitor-
// facing AI chat on, writes the "business brain" (facts the page doesn't
// spell out), and picks a tone. Self-contained: fetches + persists via
// /api/projects/[id]/assistant, so left-sidebar only has to render it with
// the current project id.
//
// Strings are ES-hardcoded by deliberate v1 scope (ES-first product); folds
// into the i18n catalogs during the next localization pass. Only the sidebar
// tab label/title are catalogued (wsChrome.sidebar.tabs.assistant).

"use client";

import { useEffect, useState } from "react";
import { MessageSq, Sparkles, X } from "../icons";

interface AssistantConfig {
  enabled: boolean;
  facts: string;
  tone: string;
}

const FACTS_MAX = 4000;

export function AssistantPanel({
  currentProjectId,
}: {
  currentProjectId?: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [facts, setFacts] = useState("");
  const [tone, setTone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!currentProjectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`/api/projects/${currentProjectId}/assistant`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: AssistantConfig) => {
        if (cancelled) return;
        setEnabled(d.enabled);
        setFacts(d.facts);
        setTone(d.tone);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentProjectId]);

  const patch = async (body: Partial<AssistantConfig>) => {
    if (!currentProjectId) return false;
    const res = await fetch(`/api/projects/${currentProjectId}/assistant`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  };

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next); // optimistic
    setError(null);
    const ok = await patch({ enabled: next });
    if (!ok) {
      setEnabled(!next); // revert
      setError("No se pudo guardar. Intenta de nuevo.");
    }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    const ok = await patch({ facts, tone });
    setSaving(false);
    if (ok) {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } else {
      setError("No se pudo guardar. Intenta de nuevo.");
    }
  };

  if (!currentProjectId) {
    return (
      <div className="h-full flex items-center justify-center px-6 text-center">
        <p className="text-[11.5px] fg-muted leading-relaxed max-w-[200px]">
          Guarda o publica tu página primero para activar el asistente.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <MessageSq size={13} className="text-accent" />
          <h2 className="text-[11px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
            Asistente del sitio
          </h2>
        </div>
        <p className="text-[11px] fg-muted leading-snug">
          Un chat con IA que responde preguntas de tus visitantes — solo con la
          información de tu negocio — y captura sus datos cuando muestran
          interés.
        </p>
      </div>

      {/* Enable toggle */}
      <div className="px-3 pb-3 shrink-0">
        <button
          type="button"
          onClick={toggle}
          disabled={loading}
          aria-pressed={enabled}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-md ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] hover:ring-[color:var(--border-strong)] transition disabled:opacity-50"
        >
          <span className="text-[12.5px] fg font-medium">
            {enabled ? "Activado" : "Activar asistente"}
          </span>
          <span
            className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition ${
              enabled ? "bg-[var(--accent-strong)]" : "bg-black/20 dark:bg-white/20"
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                enabled ? "left-[18px]" : "left-0.5"
              }`}
            />
          </span>
        </button>
      </div>

      {/* Business brain */}
      <div className="px-3 pb-2 flex-1 min-h-0 flex flex-col">
        <label className="block text-[10px] uppercase tracking-[0.14em] fg-faint font-semibold mb-1.5">
          Información del negocio
        </label>
        <p className="text-[10.5px] fg-faint leading-snug mb-1.5">
          Lo que tu página no dice: horarios, precios, envíos, políticas,
          preguntas frecuentes. El asistente responde solo con esto.
        </p>
        <textarea
          value={facts}
          onChange={(e) => setFacts(e.target.value.slice(0, FACTS_MAX))}
          placeholder={
            "Ej.:\n• Horario: martes a domingo, 1pm–11pm.\n• Envíos a domicilio solo en Monterrey ($40).\n• Pedidos por WhatsApp al 81 1234 5678.\n• Aceptamos tarjeta y efectivo."
          }
          disabled={loading}
          spellCheck
          className="flex-1 min-h-[120px] w-full px-2.5 py-2 text-[12px] leading-relaxed rounded-md ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] fg placeholder:fg-faint focus:outline-none focus:ring-[color:var(--border-strong)] resize-none disabled:opacity-50 nice-scroll"
        />
        <div className="mt-1 flex items-center justify-between">
          <label className="text-[10px] uppercase tracking-[0.14em] fg-faint font-semibold">
            Tono
          </label>
          <span className="text-[10px] fg-faint font-mono tabular-nums">
            {facts.length}/{FACTS_MAX}
          </span>
        </div>
        <input
          type="text"
          value={tone}
          onChange={(e) => setTone(e.target.value.slice(0, 80))}
          placeholder="Ej.: cálido y cercano"
          disabled={loading}
          className="mt-1.5 w-full h-8 px-2.5 text-[12.5px] rounded-md ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] fg placeholder:fg-faint focus:outline-none focus:ring-[color:var(--border-strong)] disabled:opacity-50"
        />
      </div>

      {error && (
        <div className="mx-3 mb-2 shrink-0 flex items-start gap-2 px-2.5 py-2 rounded-md ring-1 ring-red-300 dark:ring-red-500/30 bg-red-50 dark:bg-red-500/5">
          <X size={12} className="text-red-600 dark:text-red-400 shrink-0 mt-px" />
          <span className="text-[11px] text-red-700 dark:text-red-300 leading-snug">
            {error}
          </span>
        </div>
      )}

      <div className="px-3 pb-3 shrink-0">
        <button
          type="button"
          onClick={save}
          disabled={saving || loading}
          className="w-full h-9 inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--accent-strong)] text-white text-[12.5px] font-medium hover:brightness-105 active:brightness-95 shadow-coral transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <>
              <span className="inline-block w-2 h-2 rounded-full bg-white/80 animate-pulse" />
              Guardando…
            </>
          ) : saved ? (
            "Guardado ✓"
          ) : (
            <>
              <Sparkles size={12} />
              Guardar
            </>
          )}
        </button>
        <p className="mt-2 text-[10px] fg-faint leading-relaxed text-center">
          El asistente aparece en tu página al publicar. Tus datos del negocio
          nunca se incluyen en el código de la página.
        </p>
      </div>
    </div>
  );
}
