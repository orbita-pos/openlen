"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ModalShell } from "./modal-shell";

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
  const [description, setDescription] = useState("");
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

  // El `Escape` lo lleva `ModalShell` — junto con el aspa y el clic en el velo,
  // las tres salidas apagadas por el mismo `dismissable`. Aquí eran tres sitios
  // distintos que había que acordarse de mantener a la vez.

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
    const desc = description.trim();
    if (desc.length < 10) {
      setErrorMessage(t("autofill.errors.needDescription"));
      return null;
    }
    return { projectId, source: "text", description: desc };
  }, [tab, imageDataUrl, imageMime, projectId, description, t]);

  const submit = useCallback(async () => {
    const body = buildBody();
    if (!body) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setErrorMessage(null);
    setStartedAt(Date.now());
    setBytes(0);
    // Both paths now extract first (image → vision, text → description parse).
    setStage("extracting");

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

  if (!open) return null;

  const isBusy =
    stage === "extracting" ||
    stage === "tagging" ||
    stage === "calling-model" ||
    stage === "applying" ||
    stage === "persisting";

  const elapsedSec = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      // Mientras trabaja no se cierra: el aspa, el velo y Escape, los tres a la
      // vez. Antes cada salida se acordaba por su cuenta.
      dismissable={!isBusy}
      titleId="autofill-modal-title"
      closeLabel={t("common.close")}
      title={t("autofill.title")}
      subtitle={t("autofill.subtitle")}
    >
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
          <div className="space-y-2">
            <label className="block">
              <span className="text-[10.5px] font-medium fg-muted uppercase tracking-wider">
                {t("autofill.describe.label")}
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("autofill.describe.placeholder")}
                rows={6}
                className="mt-1.5 w-full px-3 py-2.5 text-[13px] fg bg-app border bd rounded-md focus:bd-strong focus:outline-none placeholder:fg-faint resize-y min-h-[150px] leading-relaxed transition"
              />
            </label>
            <p className="text-[11px] fg-faint leading-relaxed">
              {t("autofill.describe.hint")}
            </p>
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
    </ModalShell>
  );
}

// Field / FieldTextarea were removed when the Text tab became a single
// free-text description box (the AI now structures it).
