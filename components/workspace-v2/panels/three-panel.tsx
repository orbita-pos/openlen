"use client";

import { useEffect, useState } from "react";
import { GOLDEN } from "@/lib/three3d/golden-specs";
import type { MaterialKind, ShaderVariant } from "@/lib/three3d/scene-spec";
import { SHADER_VARIANTS } from "@/lib/three3d/scene-spec";
import { Loader, Sparkles } from "../icons";
import { useToast } from "../toast";

interface Scene3d {
  enabled?: boolean;
  spec?: unknown;
}

interface ThreePanelProps {
  currentProjectId: string | null;
  scene3d?: Scene3d;
  accent?: string;
  onApplyScene3d: (next: { enabled: boolean; spec: unknown } | null) => void;
}

const CHIPS: { label: string; value: MaterialKind }[] = [
  { label: "Vidrio", value: "glass" },
  { label: "Metal", value: "metal" },
  { label: "Cromo", value: "chrome" },
  { label: "Neón", value: "emissive" },
  { label: "Holográfico", value: "iridescent" },
  { label: "Mate", value: "matte" },
  { label: "Degradado", value: "gradient" },
];

const SHADER_CHIPS: { label: string; value: ShaderVariant }[] = [
  { label: "Gradiente", value: "gradient" },
  { label: "Fluido", value: "fluid" },
  { label: "Aurora", value: "aurora" },
];

// Base spec for shader backgrounds (golden: "un fondo degradado animado")
const SHADER_BASE = GOLDEN[GOLDEN.length - 1].spec;

export function ThreePanel({
  currentProjectId,
  scene3d,
  accent,
  onApplyScene3d,
}: ThreePanelProps) {
  const toast = useToast();

  const [describe, setDescribe] = useState("");
  const [register, setRegister] = useState<MaterialKind>("glass");
  const [flotar, setFlotar] = useState(true);
  const [brandMatch, setBrandMatch] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [draft, setDraft] = useState<unknown>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [shaderVariant, setShaderVariant] = useState<ShaderVariant | null>(null);

  // Seed from existing scene on mount / when scene3d changes.
  useEffect(() => {
    if (scene3d?.spec) {
      setDraft(scene3d.spec);
      const s = scene3d.spec as Record<string, unknown>;
      if (typeof s?.shader === "string" && (SHADER_VARIANTS as readonly string[]).includes(s.shader)) {
        setShaderVariant(s.shader as ShaderVariant);
      } else if (s?.material && typeof s.material === "object") {
        const mat = s.material as Record<string, unknown>;
        if (typeof mat.kind === "string") {
          const k = mat.kind as MaterialKind;
          if (CHIPS.some((c) => c.value === k)) setRegister(k);
        }
      }
    }
  }, []);

  const handleGenerate = async () => {
    if (!currentProjectId) return;
    setGenerating(true);
    setInlineError(null);
    try {
      const res = await fetch("/api/generate-3d", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          describe: describe.trim() || undefined,
          register,
          behavior: flotar ? "float-rotate" : "still",
          brandMatch: brandMatch && !!accent,
          accent: brandMatch && accent ? accent : undefined,
        }),
      });
      if (!res.ok) {
        let errCode = "";
        try {
          const j = await res.json();
          errCode = j?.error ?? "";
        } catch {
          // ignore
        }
        if (res.status === 402 && errCode === "pro_required") {
          setInlineError("Esta función es Pro. Actualiza para generar escenas 3D con IA.");
          return;
        }
        if (errCode === "insufficient_credits") {
          toast.error("Créditos insuficientes para generar una escena 3D.");
          return;
        }
        toast.error("No se pudo generar la escena 3D. Inténtalo de nuevo.");
        return;
      }
      const data = await res.json();
      setDraft(data.spec);
      setProvider(data.provider ?? null);
    } catch {
      toast.error("Error de red al generar la escena 3D.");
    } finally {
      setGenerating(false);
    }
  };

  const handleShaderSelect = (v: ShaderVariant | null) => {
    setShaderVariant(v);
    if (v === null) {
      setDraft(null);
    } else {
      setDraft({ ...SHADER_BASE, shader: v });
    }
  };

  const isMock = provider === "mock";
  const hasDraft = draft !== null;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-1.5 shrink-0">
        <div className="text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
          3D
        </div>
        <div className="text-[11px] fg-faint mt-0.5">Añade una escena 3D decorativa a tu página</div>
      </div>

      <div className="flex-1 overflow-y-auto nice-scroll px-3 pb-3 space-y-3">
        {/* Gallery */}
        <div>
          <div className="text-[11px] font-semibold fg mb-1.5">Galería</div>
          <div className="grid grid-cols-2 gap-1.5">
            {GOLDEN.map((g, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  setDescribe(g.brief);
                  const mat = g.spec.material.kind;
                  setRegister(mat);
                  setShaderVariant(null);
                  setDraft(null);
                }}
                className="text-left rounded-lg ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1.5 hover:bg-hover transition"
              >
                <div className="text-[10px] fg-faint mb-0.5 capitalize">
                  {CHIPS.find((c) => c.value === g.spec.material.kind)?.label ?? g.spec.material.kind}
                </div>
                <div className="text-[11px] fg leading-snug line-clamp-2">{g.brief}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Fondo animado — shader picker */}
        <div>
          <div className="text-[11px] font-medium fg mb-1.5">Fondo animado</div>
          <div className="flex flex-wrap gap-1">
            {SHADER_CHIPS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => handleShaderSelect(shaderVariant === c.value ? null : c.value)}
                className={`h-6 px-2 rounded-md text-[10.5px] font-medium transition ring-1 ${
                  shaderVariant === c.value
                    ? "bg-[var(--accent-strong)] text-white ring-transparent"
                    : "bg-elev fg-muted ring-[color:var(--border)] hover:fg"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          {shaderVariant && (
            <p className="text-[10px] fg-faint mt-1">Selecciona Aplicar para activarlo.</p>
          )}
        </div>

        {/* Geometry section — de-emphasized when shader active */}
        <div className={shaderVariant ? "opacity-40 pointer-events-none" : undefined}>
          {/* Describe */}
          <div className="mb-3">
            <label className="block">
              <span className="text-[11px] font-medium fg block mb-1">Descripción</span>
              <textarea
                className="w-full rounded-md px-2.5 py-2 text-[12px] bg-[color:var(--bg)] ring-1 ring-[color:var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)] resize-none min-h-[60px]"
                placeholder="una esfera holográfica que gira lento"
                value={describe}
                onChange={(e) => setDescribe(e.target.value)}
              />
            </label>
          </div>

          {/* Register chips */}
          <div className="mb-3">
            <div className="text-[11px] font-medium fg mb-1.5">Material</div>
            <div className="flex flex-wrap gap-1">
              {CHIPS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => {
                    setRegister(c.value);
                    if (shaderVariant !== null) {
                      setShaderVariant(null);
                      setDraft(null);
                    }
                  }}
                  className={`h-6 px-2 rounded-md text-[10.5px] font-medium transition ring-1 ${
                    register === c.value && !shaderVariant
                      ? "bg-[var(--accent-strong)] text-white ring-transparent"
                      : "bg-elev fg-muted ring-[color:var(--border)] hover:fg"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-2">
            <Toggle
              label="Flotar"
              hint="La escena flota y rota suavemente"
              value={flotar}
              onChange={setFlotar}
            />
            <Toggle
              label="Usar mi marca"
              hint={accent ? `Aplica tu color ${accent}` : "Sin color de marca detectado"}
              value={brandMatch}
              onChange={setBrandMatch}
              disabled={!accent}
            />
          </div>
        </div>

        {/* Inline error */}
        {inlineError && (
          <div className="rounded-md ring-1 ring-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
            {inlineError}
          </div>
        )}

        {/* Actions */}
        <div className="space-y-1.5 pt-1">
          {!shaderVariant && (
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={generating || !currentProjectId || !describe.trim()}
              className="w-full h-8 rounded-md text-[11.5px] font-semibold text-white bg-[var(--accent-strong)] hover:brightness-105 transition disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
            >
              {generating ? (
                <Loader size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              {generating ? "Generando…" : isMock ? "Vista previa · gratis" : "Generar · IA · 3 cr"}
            </button>
          )}

          {hasDraft && (
            <button
              type="button"
              onClick={() => onApplyScene3d({ enabled: true, spec: draft })}
              className="w-full h-8 rounded-md text-[11.5px] font-semibold fg bg-elev ring-1 ring-[color:var(--border)] hover:bg-hover transition inline-flex items-center justify-center"
            >
              Aplicar escena
            </button>
          )}

          {scene3d?.enabled && (
            <button
              type="button"
              onClick={() =>
                onApplyScene3d({ enabled: false, spec: scene3d.spec })
              }
              className="w-full h-7 rounded-md text-[11px] fg-faint hover:fg hover:bg-hover ring-1 ring-[color:var(--border)] bg-transparent transition"
            >
              Quitar 3D
            </button>
          )}
          <p className="text-[10px] fg-faint text-center pt-0.5">Se aplica como fondo del hero, en todo el sitio.</p>
        </div>

        {provider && (
          <p className="text-[10px] fg-faint text-center">
            {isMock ? "Vista previa generada (mock gratuito)" : "Generado con IA · 3 créditos"}
          </p>
        )}
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 ${disabled ? "opacity-40" : ""}`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={value}
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors ${
          value ? "bg-[var(--accent-strong)]" : "bg-zinc-300 dark:bg-zinc-600"
        }`}
      >
        <span
          className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform mt-0.5 ${
            value ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </button>
      <div className="min-w-0">
        <div className="text-[11.5px] fg font-medium">{label}</div>
        {hint && <div className="text-[10px] fg-faint leading-snug">{hint}</div>}
      </div>
    </div>
  );
}
