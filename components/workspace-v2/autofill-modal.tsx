"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Tab = "image" | "text";

type Stage =
  | "idle"
  | "extracting"
  | "tagging"
  | "calling-model"
  | "applying"
  | "persisting"
  | "done"
  | "error";

const STAGE_LABELS: Record<Exclude<Stage, "idle">, string> = {
  extracting: "Leyendo imagen…",
  tagging: "Preparando template…",
  "calling-model": "Kimi K2.6 escribiendo…",
  applying: "Aplicando cambios…",
  persisting: "Guardando…",
  done: "Listo",
  error: "Error",
};

interface TextFormState {
  business_name: string;
  industry: string;
  tagline: string;
  pitch: string;
  hero_keyword: string;
  cta_primary: string;
}

const EMPTY_TEXT_FORM: TextFormState = {
  business_name: "",
  industry: "",
  tagline: "",
  pitch: "",
  hero_keyword: "",
  cta_primary: "",
};

export interface AutofillModalProps {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onApplied: (newHtml: string) => void;
}

export function AutofillModal({
  open,
  projectId,
  onClose,
  onApplied,
}: AutofillModalProps) {
  const [tab, setTab] = useState<Tab>("image");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageBytes, setImageBytes] = useState(0);
  const [imageMime, setImageMime] = useState<"image/jpeg" | "image/png">("image/jpeg");
  const [textForm, setTextForm] = useState<TextFormState>(EMPTY_TEXT_FORM);
  const [stage, setStage] = useState<Stage>("idle");
  const [bytes, setBytes] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [, tickElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (stage === "calling-model" || stage === "extracting" || stage === "applying") {
      const id = window.setInterval(() => tickElapsed((n) => n + 1), 1000);
      return () => window.clearInterval(id);
    }
  }, [stage]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!open) {
      setStage("idle");
      setErrorMessage(null);
      setBytes(0);
      setStartedAt(null);
    }
  }, [open]);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setErrorMessage("El archivo no es una imagen.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setErrorMessage(`Imagen muy grande (${(file.size / 1024 / 1024).toFixed(1)} MB, máximo 8 MB).`);
      return;
    }
    setErrorMessage(null);
    setImageBytes(file.size);
    setImageMime(file.type === "image/png" ? "image/png" : "image/jpeg");
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setImageDataUrl(reader.result);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  useEffect(() => {
    if (!open || tab !== "image") return;
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (file) handleFile(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open, tab, handleFile]);

  const buildBody = useCallback((): Record<string, unknown> | null => {
    if (tab === "image") {
      if (!imageDataUrl) {
        setErrorMessage("Subí una imagen primero.");
        return null;
      }
      return {
        projectId,
        source: "image",
        image: imageDataUrl,
        imageMime,
      };
    }
    if (!textForm.business_name.trim()) {
      setErrorMessage("Necesitás al menos el nombre del negocio.");
      return null;
    }
    const data = {
      business_name: textForm.business_name.trim() || null,
      industry: textForm.industry.trim() || null,
      tagline_es: textForm.tagline.trim() || null,
      tagline_en: null,
      pitch: textForm.pitch.trim() || null,
      hero_keyword: textForm.hero_keyword.trim() || null,
      features: [],
      pricing: [],
      testimonials: [],
      cta_primary: textForm.cta_primary.trim() || null,
      cta_secondary: null,
      faq_questions: [],
      language_detected: "es",
    };
    return { projectId, source: "text", data };
  }, [tab, imageDataUrl, imageMime, projectId, textForm]);

  const submit = useCallback(async () => {
    const body = buildBody();
    if (!body) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setErrorMessage(null);
    setStartedAt(Date.now());
    setBytes(0);
    setStage(tab === "image" ? "extracting" : "tagging");

    let response: Response;
    try {
      response = await fetch("/api/templates/autofill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      setStage("error");
      setErrorMessage(err instanceof Error ? err.message : "Network error");
      return;
    }
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      setStage("error");
      setErrorMessage(`Servidor ${response.status}: ${text.slice(0, 200)}`);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (controller.signal.aborted) return;
        setStage("error");
        setErrorMessage(err instanceof Error ? err.message : "Stream read failed");
        return;
      }
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        let eventName = "message";
        let dataLine = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) eventName = line.slice(7);
          else if (line.startsWith("data: ")) dataLine = line.slice(6);
        }
        if (!dataLine) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(dataLine);
        } catch {
          continue;
        }
        if (eventName === "progress") {
          const s = (parsed as { stage?: Stage }).stage;
          if (s) setStage(s);
        } else if (eventName === "delta") {
          setBytes((parsed as { bytes?: number }).bytes ?? 0);
        } else if (eventName === "done") {
          const newHtml = (parsed as { newHtml?: string }).newHtml;
          setStage("done");
          if (newHtml) onApplied(newHtml);
          window.setTimeout(() => {
            onClose();
          }, 1200);
          return;
        } else if (eventName === "error") {
          setStage("error");
          setErrorMessage((parsed as { message?: string }).message ?? "Unknown error");
          return;
        }
      }
    }
  }, [buildBody, onApplied, onClose, tab]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setStage("idle");
    setBytes(0);
    setStartedAt(null);
  }, []);

  if (!open) return null;

  const isBusy =
    stage === "extracting" ||
    stage === "tagging" ||
    stage === "calling-model" ||
    stage === "applying" ||
    stage === "persisting";

  const elapsedSec = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => {
        if (!isBusy) onClose();
      }}
    >
      <div
        className="relative w-full max-w-2xl mx-4 rounded-2xl bg-zinc-900 border border-white/10 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div>
            <div className="text-[15px] font-semibold text-white">Llenar con tu info</div>
            <div className="text-[12px] text-white/40 mt-0.5">
              Subí una imagen de referencia o escribí los datos de tu negocio. Tu template se llena con tu contenido real.
            </div>
          </div>
          <button
            type="button"
            onClick={() => !isBusy && onClose()}
            disabled={isBusy}
            className="text-white/50 hover:text-white/80 text-lg leading-none disabled:opacity-30"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="px-5 pt-4 flex gap-1.5 text-[13px]">
          <button
            type="button"
            onClick={() => setTab("image")}
            disabled={isBusy}
            className={`px-3 py-1.5 rounded-md transition ${
              tab === "image"
                ? "bg-white/10 text-white"
                : "text-white/50 hover:text-white/80"
            } disabled:opacity-40`}
          >
            📷 Subir imagen
          </button>
          <button
            type="button"
            onClick={() => setTab("text")}
            disabled={isBusy}
            className={`px-3 py-1.5 rounded-md transition ${
              tab === "text" ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"
            } disabled:opacity-40`}
          >
            ✍️ Escribir info
          </button>
        </div>

        <div className="px-5 py-4 min-h-[280px]">
          {tab === "image" && (
            <div>
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-white/[0.12] rounded-xl p-8 text-center cursor-pointer hover:border-white/[0.25] transition"
              >
                {imageDataUrl ? (
                  <div>
                    <img
                      src={imageDataUrl}
                      alt="Preview"
                      className="max-h-48 mx-auto rounded-md"
                    />
                    <div className="mt-3 text-[12px] text-white/40">
                      {(imageBytes / 1024).toFixed(0)} KB · click para cambiar
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="text-3xl mb-2">📷</div>
                    <div className="text-[13px] text-white/80">
                      Arrastrá una imagen aquí, click para elegir, o pegá del portapapeles
                    </div>
                    <div className="text-[11px] text-white/40 mt-2">
                      JPG o PNG · máximo 8 MB · screenshots, fotos de menú, brochures, etc.
                    </div>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
              </div>
            </div>
          )}

          {tab === "text" && (
            <div className="space-y-2.5">
              <Field
                label="Nombre del negocio *"
                value={textForm.business_name}
                onChange={(v) => setTextForm((s) => ({ ...s, business_name: v }))}
                placeholder="Tacos de Juan"
              />
              <Field
                label="Industria / tipo"
                value={textForm.industry}
                onChange={(v) => setTextForm((s) => ({ ...s, industry: v }))}
                placeholder="Taquería tradicional mexicana"
              />
              <Field
                label="Tagline (1 línea punchy)"
                value={textForm.tagline}
                onChange={(v) => setTextForm((s) => ({ ...s, tagline: v }))}
                placeholder="Auténticos tacos al pastor desde 1989"
              />
              <FieldTextarea
                label="Pitch (1-2 frases sobre tu negocio)"
                value={textForm.pitch}
                onChange={(v) => setTextForm((s) => ({ ...s, pitch: v }))}
                placeholder="Más de 30 años sirviendo los mejores tacos al pastor de Monterrey. Tradición familiar, ingredientes frescos."
              />
              <div className="grid grid-cols-2 gap-2">
                <Field
                  label="Palabra clave del hero (para destacar)"
                  value={textForm.hero_keyword}
                  onChange={(v) => setTextForm((s) => ({ ...s, hero_keyword: v }))}
                  placeholder="tradición"
                />
                <Field
                  label="CTA principal"
                  value={textForm.cta_primary}
                  onChange={(v) => setTextForm((s) => ({ ...s, cta_primary: v }))}
                  placeholder="Pide por WhatsApp"
                />
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/[0.06] bg-black/30 flex items-center justify-between">
          <div className="text-[11.5px] text-white/50 flex items-center gap-2">
            {isBusy && (
              <>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span>
                  {STAGE_LABELS[stage as Exclude<Stage, "idle">]} · {elapsedSec}s
                  {bytes > 0 && stage === "calling-model"
                    ? ` · ${(bytes / 1024).toFixed(1)} KB`
                    : ""}
                </span>
              </>
            )}
            {stage === "done" && (
              <span className="text-emerald-400">✓ Listo · {elapsedSec}s</span>
            )}
            {stage === "error" && errorMessage && (
              <span className="text-rose-400 truncate max-w-[400px]">
                ✗ {errorMessage}
              </span>
            )}
            {stage === "idle" && !errorMessage && (
              <span>
                {tab === "image"
                  ? "Tip: una screenshot del sitio que querés copiar, o foto de tu menú, funciona bien."
                  : "Tip: con solo nombre + tagline + pitch alcanza. El resto del template queda intacto."}
              </span>
            )}
            {stage === "idle" && errorMessage && (
              <span className="text-rose-400">✗ {errorMessage}</span>
            )}
          </div>
          <div className="flex gap-2">
            {isBusy ? (
              <button
                type="button"
                onClick={cancel}
                className="px-3 py-1.5 text-[12.5px] text-white/60 hover:text-white/90 rounded-md"
              >
                Cancelar
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-[12.5px] text-white/60 hover:text-white/90 rounded-md"
              >
                Cerrar
              </button>
            )}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={isBusy || stage === "done"}
              className="px-4 py-1.5 text-[12.5px] font-medium rounded-md bg-white text-black hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isBusy ? "Procesando…" : "Aplicar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-white/60 uppercase tracking-wider">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full px-3 py-2 text-[13px] text-white bg-black/40 border border-white/[0.08] rounded-md focus:border-white/[0.25] focus:outline-none placeholder:text-white/25"
      />
    </label>
  );
}

function FieldTextarea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-white/60 uppercase tracking-wider">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="mt-1 w-full px-3 py-2 text-[13px] text-white bg-black/40 border border-white/[0.08] rounded-md focus:border-white/[0.25] focus:outline-none placeholder:text-white/25 resize-none"
      />
    </label>
  );
}
