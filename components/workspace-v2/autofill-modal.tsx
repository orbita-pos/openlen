"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useFocusTrap } from "./use-focus-trap";

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
  const t = useTranslations("modalsAsset");
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

  // ESC closes the modal — but only if no request is in flight. While busy
  // the user must click Cancel explicitly so they don't accidentally
  // abandon a partial run.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (
        stage === "extracting" ||
        stage === "tagging" ||
        stage === "calling-model" ||
        stage === "applying" ||
        stage === "persisting"
      ) {
        return;
      }
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, stage]);

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setErrorMessage(t("autofill.errors.notImage"));
      return;
    }
    if (file.type !== "image/jpeg" && file.type !== "image/png") {
      setErrorMessage(t("autofill.errors.onlyJpgPng"));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setErrorMessage(
        t("autofill.errors.tooLarge", { size: (file.size / 1024 / 1024).toFixed(1) }),
      );
      return;
    }
    if (file.size < 4 * 1024) {
      setErrorMessage(t("autofill.errors.tooSmallBytes"));
      return;
    }
    setErrorMessage(null);
    setImageBytes(file.size);
    setImageMime(file.type === "image/png" ? "image/png" : "image/jpeg");
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      // Dimension sanity check via a probe Image — rejects tiny meme images.
      const probe = new Image();
      probe.onload = () => {
        if (probe.naturalWidth < 200 || probe.naturalHeight < 200) {
          setErrorMessage(
            t("autofill.errors.tooSmallDims", {
              width: probe.naturalWidth,
              height: probe.naturalHeight,
            }),
          );
          setImageDataUrl(null);
          return;
        }
        setImageDataUrl(reader.result as string);
      };
      probe.onerror = () => {
        setErrorMessage(t("autofill.errors.cantRead"));
      };
      probe.src = reader.result;
    };
    reader.readAsDataURL(file);
  }, [t]);

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
        setErrorMessage(t("autofill.errors.uploadFirst"));
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
      setErrorMessage(t("autofill.errors.needBusinessName"));
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
  }, [tab, imageDataUrl, imageMime, projectId, textForm, t]);

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
      setErrorMessage(err instanceof Error ? err.message : t("autofill.errors.network"));
      return;
    }
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      setStage("error");
      setErrorMessage(t("autofill.errors.server", { status: response.status, detail: text.slice(0, 200) }));
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
        setErrorMessage(err instanceof Error ? err.message : t("autofill.errors.streamRead"));
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
          setErrorMessage((parsed as { message?: string }).message ?? t("autofill.errors.unknown"));
          return;
        }
      }
    }
  }, [buildBody, onApplied, onClose, tab, t]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setStage("idle");
    setBytes(0);
    setStartedAt(null);
  }, []);

  const trapRef = useFocusTrap(open);

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
      className="workspace-v2 fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm fade-in overflow-y-auto"
      onClick={() => {
        if (!isBusy) onClose();
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="autofill-modal-title"
        className="relative w-full max-w-2xl sm:mx-4 rounded-t-2xl sm:rounded-2xl bg-elev border bd shadow-elev overflow-hidden slide-down my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 sm:px-5 py-3 sm:py-4 border-b bd flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div id="autofill-modal-title" className="text-[14px] sm:text-[15px] font-semibold fg font-display">
              {t("autofill.title")}
            </div>
            <div className="hidden sm:block text-[12px] fg-faint mt-0.5 leading-snug">
              {t("autofill.subtitle")}
            </div>
            <div className="sm:hidden text-[11px] fg-faint mt-0.5 leading-snug">
              {t("autofill.subtitleShort")}
            </div>
          </div>
          <button
            type="button"
            onClick={() => !isBusy && onClose()}
            disabled={isBusy}
            className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md fg-faint hover:fg hover:bg-hover transition disabled:opacity-30"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>

        <div className="px-4 sm:px-5 pt-3 sm:pt-3.5 flex gap-1 text-[12.5px]">
          <button
            type="button"
            onClick={() => setTab("image")}
            disabled={isBusy}
            className={`px-3 py-1.5 rounded-md transition disabled:opacity-40 ${
              tab === "image" ? "seg-active" : "fg-muted hover:fg hover:bg-hover"
            }`}
          >
            📷 {t("autofill.tabs.image")}
          </button>
          <button
            type="button"
            onClick={() => setTab("text")}
            disabled={isBusy}
            className={`px-3 py-1.5 rounded-md transition disabled:opacity-40 ${
              tab === "text" ? "seg-active" : "fg-muted hover:fg hover:bg-hover"
            }`}
          >
            ✍️ {t("autofill.tabs.text")}
          </button>
        </div>

        <div className="px-4 sm:px-5 py-3 sm:py-4 min-h-[240px] sm:min-h-[280px] max-h-[60vh] sm:max-h-[70vh] overflow-y-auto nice-scroll">
          {tab === "image" && (
            <div>
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed bd hover:bd-strong rounded-xl p-8 text-center cursor-pointer transition bg-app"
              >
                {imageDataUrl ? (
                  <div>
                    <img
                      src={imageDataUrl}
                      alt={t("autofill.image.previewAlt")}
                      className="max-h-48 mx-auto rounded-md shadow-card"
                    />
                    <div className="mt-3 text-[12px] fg-faint">
                      {t("autofill.image.sizeChange", { kb: (imageBytes / 1024).toFixed(0) })}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="text-3xl mb-2">📷</div>
                    <div className="text-[13px] fg">
                      {t("autofill.image.dropPrompt")}
                    </div>
                    <div className="text-[11px] fg-faint mt-2">
                      {t("autofill.image.hint")}
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
                label={t("autofill.fields.businessName.label")}
                value={textForm.business_name}
                onChange={(v) => setTextForm((s) => ({ ...s, business_name: v }))}
                placeholder={t("autofill.fields.businessName.placeholder")}
              />
              <Field
                label={t("autofill.fields.industry.label")}
                value={textForm.industry}
                onChange={(v) => setTextForm((s) => ({ ...s, industry: v }))}
                placeholder={t("autofill.fields.industry.placeholder")}
              />
              <Field
                label={t("autofill.fields.tagline.label")}
                value={textForm.tagline}
                onChange={(v) => setTextForm((s) => ({ ...s, tagline: v }))}
                placeholder={t("autofill.fields.tagline.placeholder")}
              />
              <FieldTextarea
                label={t("autofill.fields.pitch.label")}
                value={textForm.pitch}
                onChange={(v) => setTextForm((s) => ({ ...s, pitch: v }))}
                placeholder={t("autofill.fields.pitch.placeholder")}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Field
                  label={t("autofill.fields.heroKeyword.label")}
                  value={textForm.hero_keyword}
                  onChange={(v) => setTextForm((s) => ({ ...s, hero_keyword: v }))}
                  placeholder={t("autofill.fields.heroKeyword.placeholder")}
                />
                <Field
                  label={t("autofill.fields.ctaPrimary.label")}
                  value={textForm.cta_primary}
                  onChange={(v) => setTextForm((s) => ({ ...s, cta_primary: v }))}
                  placeholder={t("autofill.fields.ctaPrimary.placeholder")}
                />
              </div>
            </div>
          )}
        </div>

        <div className="px-4 sm:px-5 py-3 border-t bd bg-side flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3">
          <div className="text-[11.5px] fg-faint flex items-center gap-2 min-w-0 order-2 sm:order-1">
            {isBusy && (
              <>
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--accent)] animate-pulse" />
                <span className="truncate">
                  {t(`autofill.stages.${stage as Exclude<Stage, "idle">}`)} · {elapsedSec}s
                  {bytes > 0 && stage === "calling-model"
                    ? ` · ${(bytes / 1024).toFixed(1)} KB`
                    : ""}
                </span>
              </>
            )}
            {stage === "done" && (
              <span className="text-emerald-600 dark:text-emerald-400">
                {t("autofill.doneStatus", { seconds: elapsedSec })}
              </span>
            )}
            {stage === "error" && errorMessage && (
              <span className="text-red-600 dark:text-rose-400 truncate">
                ✗ {errorMessage}
              </span>
            )}
            {stage === "idle" && !errorMessage && (
              <span className="truncate">
                {tab === "image"
                  ? t("autofill.tips.image")
                  : t("autofill.tips.text")}
              </span>
            )}
            {stage === "idle" && errorMessage && (
              <span className="text-red-600 dark:text-rose-400 truncate">
                ✗ {errorMessage}
              </span>
            )}
          </div>
          <div className="flex gap-2 shrink-0 order-1 sm:order-2 justify-end">
            {isBusy ? (
              <button
                type="button"
                onClick={cancel}
                className="px-3 py-1.5 text-[12.5px] fg-muted hover:fg hover:bg-hover rounded-md transition"
              >
                {t("common.cancel")}
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-[12.5px] fg-muted hover:fg hover:bg-hover rounded-md transition"
              >
                {t("common.closeButton")}
              </button>
            )}
            <button
              type="button"
              onClick={() => void submit()}
              disabled={isBusy || stage === "done"}
              className="px-4 py-1.5 text-[12.5px] font-medium rounded-md bg-[color:var(--accent)] text-white shadow-coral hover:brightness-105 active:brightness-95 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
            >
              {isBusy ? t("autofill.processing") : t("common.apply")}
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
      <span className="text-[10.5px] font-medium fg-muted uppercase tracking-wider">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full px-3 py-2 text-[13px] fg bg-app border bd rounded-md focus:bd-strong focus:outline-none placeholder:fg-faint transition"
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
      <span className="text-[10.5px] font-medium fg-muted uppercase tracking-wider">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="mt-1 w-full px-3 py-2 text-[13px] fg bg-app border bd rounded-md focus:bd-strong focus:outline-none placeholder:fg-faint resize-none transition"
      />
    </label>
  );
}
