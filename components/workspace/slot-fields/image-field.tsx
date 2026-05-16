"use client";

import { useCallback, useState } from "react";
import { ImageIcon, Loader2, Upload, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ImageFormField } from "@/lib/zod-to-form";
import { useEditorContext } from "../slot-editor-context";

export interface ImageFieldProps {
  field: ImageFormField;
  value: string;
  onChange: (value: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// ImageField — drop zone + file picker + URL paste fallback. Detected by the
// zod-to-form walker when the slot key matches `imageSrc` / `mockupSrc` /
// `logoSrc` / `src` (logo-strip).
//
// Three input modes:
//   1. Drag & drop a file onto the dashed area.
//   2. Click the area → native file picker.
//   3. Paste any public URL into the text input (lets the user reference an
//      Unsplash / R2 / S3 asset without uploading).
//
// Upload writes to /api/upload which routes to whichever storage adapter is
// configured (filesystem default, R2 when env vars set). The returned URL is
// pushed up via `onChange` — the parent reassembles + persists to localStorage
// like any other slot edit.
// ─────────────────────────────────────────────────────────────────────────────

export function ImageField({ field, value, onChange }: ImageFieldProps) {
  const { generationId } = useEditorContext();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      setUploading(true);
      try {
        const form = new FormData();
        form.append("file", file);
        if (generationId) form.append("generationId", generationId);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `Upload failed (${res.status})`);
        }
        const data = (await res.json()) as { url: string };
        onChange(data.url);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setUploading(false);
      }
    },
    [generationId, onChange],
  );

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void upload(file);
    // Reset so re-selecting the same file fires the change event again.
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragOver) setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    // Ignore inner-child enter/leave by checking we left the dropzone itself.
    if (e.currentTarget === e.target) setDragOver(false);
  };

  const hasImage = value && value.length > 0;

  return (
    <div className="flex flex-col gap-2">
      {hasImage && (
        <div className="relative group rounded-md overflow-hidden ring-1 ring-zinc-200 dark:ring-zinc-800 bg-zinc-50 dark:bg-zinc-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Current"
            className="block w-full h-28 object-cover"
            onError={(e) => {
              // Hide the broken-image silhouette by detaching the failed src.
              // The empty state of the dropzone below still lets them retry.
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute top-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md bg-zinc-900/70 text-white hover:bg-zinc-900 transition opacity-0 group-hover:opacity-100"
            aria-label="Clear image"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <label
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={cn(
          "relative flex items-center justify-center h-16 rounded-md border border-dashed transition cursor-pointer",
          dragOver
            ? "border-coral-500 bg-coral-50 dark:bg-coral-500/10"
            : "border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-600 bg-zinc-50/50 dark:bg-zinc-900/30",
        )}
      >
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={onFileInput}
          className="sr-only"
          disabled={uploading}
        />
        {uploading ? (
          <span className="flex items-center gap-1.5 text-[12px] text-zinc-600 dark:text-zinc-400">
            <Loader2 size={13} className="animate-spin" />
            Uploading…
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[12px] text-zinc-500 dark:text-zinc-400">
            {hasImage ? <ImageIcon size={13} /> : <Upload size={13} />}
            {hasImage ? "Replace image" : "Drop image or click to upload"}
          </span>
        )}
      </label>

      <div className="flex items-center gap-1.5">
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="…or paste an image URL"
          className="block flex-1 h-7 px-2 text-[11.5px] rounded-md bg-white dark:bg-[#0a0a0a] ring-1 ring-zinc-200 dark:ring-zinc-800 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-coral-500 transition-shadow font-mono truncate"
        />
      </div>

      {error && (
        <span className="text-[10.5px] text-red-600 dark:text-red-400">
          {error}
        </span>
      )}

      {!error && typeof field.maxLength === "number" && value.length > field.maxLength && (
        <span className="text-[10.5px] text-amber-600 dark:text-amber-400">
          URL is longer than {field.maxLength} chars
        </span>
      )}
    </div>
  );
}
