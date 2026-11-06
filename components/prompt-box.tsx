"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE ONE BOX — where you write what Len makes, on the home (Jesús, 06/11: «¿para qué tener 2 inputs?»).
//
// There were two: the home's (`hero-prompt-input.tsx`) and /new's (`HeroComposer` in `start-landing.tsx`), first as
// two copies, then as this component in two skins. On 06/11 /new's went away: /new has no box of its own — it opens
// the blank project only to send what the home sent (`useFirstMessageOnArrival`), and sends everything else back here.
// So this is the box, in the home's zinc and coral.
//
// WHAT IT TAKES IS EVERYTHING /new's took (Jesús, 06/11: «debe ser el que tenga todo»): photos AND files (PDF,
// video…) in the `+`, pasting a screenshot or a file into the text, dropping files anywhere on the screen
// (`addFilesRef`, lent to the home's drop zone), «Pegar HTML» for a page (`moreOptions`), the kind pill, dictation,
// and URLs painted blue as you type. The files cross to /new in IndexedDB (`lib/marketing/files-in-transit.ts`), since
// they can't be uploaded before the visitor has an account. What stays with the page (`hero-prompt-input.tsx`) is where
// the text lives and what «send» does: the examples typed while nobody touches it (`ghost`), Len's face watching it
// (`onActivity`), the create funnel (`onTyped`) and the ticket /new sends on arrival.
// ─────────────────────────────────────────────────────────────────────────────

import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
  type TextareaHTMLAttributes,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUp, FileText, Film, ImageIcon, Loader2, Mic, Plus, Square, X } from "lucide-react";
import "@/components/workspace-v2/chat/new-chat.css";
import { useMandoDesplegable } from "@/components/workspace-v2/use-mando-desplegable";
import { useToast } from "@/components/workspace-v2/toast";
import { useDictado } from "@/components/marketing/use-dictado";
import { reducirImagen } from "@/components/marketing/reducir-imagen";
import { HeroKindPicker } from "@/components/marketing/hero-kind-picker";
import { GenerationBriefLimitFeedback, useGenerationBriefLimit } from "@/components/generation-brief-limit";
import { MAX_REFERENCIAS } from "@/lib/ai/referencia-adjunta";
import { MAX_FILES_PER_MESSAGE, videoKindFromMime, videoKindFromName } from "@/lib/projects/chat-files";
import { ATTACHMENT_ACCEPT } from "@/lib/workspace-v2/upload-attachment";
import { classifyDroppedFiles, pastedFiles } from "@/lib/workspace-v2/classify-dropped-files";
import type { NaceComo } from "@/components/workspace-v2/tarjetas-nace-como";
import { splitLinks } from "@/lib/chat/links";
import { cn } from "@/lib/cn";

/** A photo for Len, already reduced (`reducirImagen`), as a `data:` URI. */
export interface PromptBoxPhoto {
  readonly dataUrl: string;
  readonly nombre: string;
}

/** What the project is born as: the pill in the box's row. */
export interface KindChoice {
  value: NaceComo;
  onChange: (v: NaceComo) => void;
  conJuego: boolean;
  conHerramienta?: boolean;
  herramientaBloqueada?: string;
}

/** THE BOX'S TEXT AREA: a URL turns blue while it's written, as in the chat, on both pages. A `textarea` can't colour
 *  part of its text, so with a link in it the text goes transparent (the caret and the selection still show) over a
 *  copy with the same measure that paints it — the chat's `CajaConMenciones`, without the mentions a first message
 *  has nobody for, and light enough for the home. Without a link it is a plain textarea: the SAME element, so the
 *  first link painting itself doesn't remount it or steal the focus. */
function LinkTextArea({
  cajaRef,
  value,
  medida,
  ink,
  caret,
  props,
}: {
  cajaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  /** The skin's size and line height: where each letter falls, worn by both layers. */
  medida: string;
  /** The skin's text colour: on the textarea, or —with a link— on the copy behind it while the textarea is clear. */
  ink: string;
  /** The caret's colour while the text is transparent. */
  caret: string;
  props: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value">;
}) {
  const copy = useRef<HTMLSpanElement>(null);
  const pieces = splitLinks(value);
  const painted = pieces.some((p) => p.href !== undefined);
  return (
    <span className="relative block">
      {painted && (
        <span
          ref={copy}
          aria-hidden="true"
          data-link-copy=""
          className={cn("pointer-events-none absolute inset-0 block overflow-hidden whitespace-pre-wrap break-words", medida, ink)}
        >
          {pieces.map((p, i) =>
            p.href ? (
              <span key={i} className="text-link" data-link="">
                {p.text}
              </span>
            ) : (
              p.text
            ),
          )}
          {/* A final break like the textarea's: otherwise an empty last line takes no room. */}
          {"\n"}
        </span>
      )}
      <textarea
        ref={cajaRef}
        value={value}
        {...props}
        onScroll={(e) => {
          if (copy.current) copy.current.scrollTop = e.currentTarget.scrollTop;
          props.onScroll?.(e);
        }}
        className={cn(
          "relative block w-full resize-none bg-transparent",
          medida,
          painted ? cn("text-transparent", caret) : ink,
          props.className,
        )}
      />
    </span>
  );
}

/** The box's look: the home's zinc and coral, its slightly bigger type. */
const SKIN = {
  box: "border-zinc-300 bg-white focus-within:border-coral-400 focus-within:shadow-[0_0_0_4px_rgb(255_90_54/0.13)] dark:border-zinc-700 dark:bg-zinc-950 dark:focus-within:border-coral-500",
  chip: "border-coral-500/30 bg-coral-500/[0.07] text-zinc-800 dark:text-zinc-100",
  chipRemove: "text-zinc-500 hover:bg-coral-500/15 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
  medida: "text-[15px] leading-normal",
  // The text's colour, apart from `medida`: with a link in it, it goes on the painted copy, and the textarea goes
  // transparent — `dark:text-zinc-100` on the textarea outranked `text-transparent` and covered the blue (06/11).
  ink: "text-zinc-900 dark:text-zinc-100",
  caret: "caret-zinc-900 dark:caret-zinc-100",
  text: "outline-none placeholder:text-zinc-500 dark:placeholder:text-zinc-500",
  minHeight: 52,
  maxHeight: 240,
  ghost: "text-[15px] leading-normal text-zinc-500 dark:text-zinc-400",
  listening: "text-[12.5px] italic text-zinc-500 dark:text-zinc-400",
  warn: "text-[12px] text-amber-600 dark:text-amber-400",
  counter: "text-zinc-500 dark:text-zinc-400",
  // `relative`: on the home the pill's menu anchors to this row and opens upwards from it.
  row: "relative",
  tool: "hover:bg-zinc-100 dark:hover:bg-zinc-900",
  toolOn: "text-coral-600 dark:text-coral-400",
  toolOff: "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
  micOn: "bg-zinc-100 dark:bg-zinc-900",
  menu: "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950",
  option: "hover:bg-zinc-100 dark:hover:bg-zinc-900",
  optionIcon: "bg-coral-500/10 text-coral-600 dark:text-coral-400",
  optionTitle: "text-zinc-900 dark:text-zinc-100",
  optionHint: "text-zinc-500 dark:text-zinc-400",
  accent: "text-coral-600 dark:text-coral-400",
  sendOn: "bg-coral-500 hover:bg-coral-600",
  sendOff: "bg-zinc-300 dark:bg-zinc-700",
} as const;

export interface PromptBoxProps {
  value: string;
  onValueChange: (v: string) => void;
  photos: readonly PromptBoxPhoto[];
  onPhotosChange: (photos: readonly PromptBoxPhoto[]) => void;
  /** Files for Len beyond photos (PDF, video…), uploaded with the first message — on the home, after crossing to /new
   *  in IndexedDB. Absent = photos only. */
  files?: readonly File[];
  onFilesChange?: (files: readonly File[]) => void;
  /** The pill. Absent = no pill. */
  kind?: KindChoice;
  placeholder: string;
  /** Called only when there is something sendable and nothing holds the button. */
  onSend: () => void;
  /** The send is on its way: a spinner on the button. */
  sending?: boolean;
  /** The button held without holding the box (the home while it learns whether you're signed in). */
  sendDisabled?: boolean;
  /** The textarea's id (the home's is `hero-prompt`: `#ask` focuses it). */
  id?: string;
  /** What the box types by itself while empty (the home); the placeholder steps aside for it. */
  ghost?: string | null;
  /** Focus and dictation, for whoever watches the box (Len's face on the home). */
  onActivity?: (a: { focused: boolean; listening: boolean }) => void;
  /** Text came in by any door — keyboard, paste or dictation (/new counts it, never with the text). */
  onTyped?: () => void;
  /** Where the box lends its way in to a drop zone around it (the start screen's, on the home and in /new). */
  addFilesRef?: MutableRefObject<((files: File[]) => void) | null>;
  /** More ways in, under the attachments in the `+` menu («Pegar HTML» for a page, on both pages). */
  moreOptions?: readonly PromptBoxOption[];
}

/** One more entry of the `+` menu: what it is, what it does said under it, and the action. */
export interface PromptBoxOption {
  key: string;
  icon: ReactNode;
  title: string;
  hint: string;
  onSelect: () => void;
}

export function PromptBox({
  value,
  onValueChange,
  photos,
  onPhotosChange,
  files,
  onFilesChange,
  kind,
  placeholder,
  onSend,
  sending = false,
  sendDisabled = false,
  id,
  ghost,
  onActivity,
  onTyped,
  addFilesRef,
  moreOptions = [],
}: PromptBoxProps) {
  const s = SKIN;
  const tm = useTranslations("marketing");
  const tp = useTranslations("panelsA");
  const tc = useTranslations("panelsChat");
  const locale = useLocale();
  const toast = useToast();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const [focused, setFocused] = useState(false);
  // The `+` opens its menu, with the chat's hook: Esc, click outside and arrows.
  const [plusOpen, setPlusOpen] = useState(false);
  const plus = useMandoDesplegable({ abierto: plusOpen, cerrar: () => setPlusOpen(false) });
  const briefLimit = useGenerationBriefLimit({
    value,
    onValueChange,
  });
  const fileList = files ?? [];

  // DICTATION WRITES AS A PERSON DOES: through the brief's cap, a space after what was there, none at the start.
  const dictado = useDictado({
    idioma: locale,
    onTexto: (fragment) => {
      onTyped?.();
      const joined = value ? `${value.replace(/\s+$/, "")} ${fragment.trim()}` : fragment.trim();
      onValueChange(joined.slice(0, briefLimit.maxLength));
    },
  });

  useEffect(() => {
    onActivity?.({ focused, listening: dictado.escuchando });
  }, [onActivity, focused, dictado.escuchando]);

  // Grows with the text, up to the box's height.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, s.maxHeight)}px`;
  }, [value, s.maxHeight]);

  const canSend = briefLimit.isValid && !sending && !sendDisabled;
  const send = () => {
    if (!canSend) return;
    // Still listening at send time, the engine outlives the navigation and the browser's mic stays on.
    dictado.parar();
    onSend();
  };

  // UP TO `MAX_REFERENCIAS` PHOTOS: the room LEFT, not the cap — three in and three more picked is four, not six.
  const addPhotos = async (picked: FileList | readonly File[] | null) => {
    if (!picked || picked.length === 0) return;
    const room = MAX_REFERENCIAS - photos.length;
    if (room <= 0) return;
    setReadingPhoto(true);
    try {
      // In parallel: `reducirImagen` decodes off the main thread, so four take as long as the slowest.
      const reduced = await Promise.all(
        Array.from(picked)
          .slice(0, room)
          .map(async (file) => {
            const r = await reducirImagen(file);
            // `null`: not an image the browser can decode. That one drops, the rest go in.
            return r ? { dataUrl: r.dataUrl, nombre: file.name } : null;
          }),
      );
      const good = reduced.filter((r): r is NonNullable<typeof r> => r !== null);
      if (good.length) onPhotosChange([...photos, ...good].slice(0, MAX_REFERENCIAS));
    } finally {
      setReadingPhoto(false);
      // ALWAYS emptied: otherwise picking the same file twice in a row fires no `change`.
      if (photoRef.current) photoRef.current.value = "";
    }
  };

  // DROP OR PASTE (spec local 2026-10-27-chat-drop-and-images), where the box takes files: photos to the photos,
  // files (and videos) to the files; what doesn't go is said.
  const addFiles = (incoming: readonly File[]) => {
    if (!onFilesChange || incoming.length === 0) return;
    const c = classifyDroppedFiles(incoming, {
      photos: Math.max(0, MAX_REFERENCIAS - photos.length),
      files: Math.max(0, MAX_FILES_PER_MESSAGE - fileList.length),
    });
    const names = (reason: string) => c.rejected.filter((r) => r.reason === reason).map((r) => r.name);
    if (names("not_supported").length) toast.error(tc("composer.dropNotSupported", { names: names("not_supported").join(", ") }));
    if (names("too_big").length) toast.error(tc("composer.dropTooBig", { names: names("too_big").join(", ") }));
    if (names("limit").length) toast.error(tc("composer.dropLimit", { count: names("limit").length }));
    if (c.files.length > 0) onFilesChange([...fileList, ...c.files].slice(0, MAX_FILES_PER_MESSAGE));
    if (c.photos.length > 0) void addPhotos(c.photos);
  };
  if (addFilesRef) addFilesRef.current = addFiles;

  const toolClass = (on: boolean) =>
    cn("grid h-[30px] w-[30px] place-items-center rounded-[9px] transition disabled:opacity-40", s.tool, on ? s.toolOn : s.toolOff);

  return (
    // THE NEW CHAT'S SKIN (Jesús, 03/10: «que sean como el chat nuevo»): the radius-16 box with its border, the chips
    // above the text, the `+` with its menu, and the square button at the end. `.nc` brings the animations (and, in the
    // workspace, its tokens) of chat/new-chat.css.
    <div className="nc" data-prompt-box="portada">
      <div
        className={cn(
          "relative rounded-[16px] border px-3 pb-[7px] pt-2 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition",
          s.box,
        )}
      >
        {/* WHAT GOES WITH THE MESSAGE, as chips ABOVE the text and inside the box, which grows with them.
            `empty:hidden`: with nothing attached, nothing is painted. */}
        <div className="mb-1 flex flex-wrap gap-1.5 empty:hidden">
          {photos.map((photo, i) => (
            <Chip
              key={`${photo.nombre}-${i}`}
              title={photo.nombre}
              removeLabel={tm("heroPrompt.removeImage")}
              onRemove={() => onPhotosChange(photos.filter((_, j) => j !== i))}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.dataUrl} alt="" className="h-[18px] w-[18px] shrink-0 rounded object-cover" />
              <span className="min-w-0 max-w-[180px] truncate">{photo.nombre || tm("heroPrompt.attachedAlt")}</span>
            </Chip>
          ))}
          {onFilesChange &&
            fileList.map((file, i) => (
              <Chip
                key={`${file.name}-${i}`}
                  title={file.name}
                removeLabel={tc("composer.removeFile")}
                onRemove={() => onFilesChange(fileList.filter((_, j) => j !== i))}
              >
                {videoKindFromMime(file.type) ?? videoKindFromName(file.name) ? (
                  <Film size={14} className={cn("shrink-0", s.accent)} />
                ) : (
                  <FileText size={14} className={cn("shrink-0", s.accent)} />
                )}
                <span className="min-w-0 max-w-[180px] truncate">{file.name}</span>
              </Chip>
            ))}
        </div>

        <div className="relative mt-0.5">
          {ghost && (
            <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 top-0", s.ghost)}>
              {ghost}
              <span className="ml-px inline-block h-[1.05em] w-[2px] translate-y-[0.15em] animate-pulse rounded-full bg-coral-500" />
            </div>
          )}
          <LinkTextArea
            cajaRef={taRef}
            value={value}
            medida={s.medida}
            ink={s.ink}
            caret={s.caret}
            props={{
              ...(id ? { id } : {}),
              onChange: (e) => {
                onTyped?.();
                briefLimit.onChange(e);
              },
              onPaste: (e) => {
                if (onFilesChange) {
                  // A screenshot or a copied file is attached; the text, if any, still pastes.
                  const pasted = pastedFiles(e.clipboardData);
                  if (pasted.files.length > 0) {
                    addFiles(pasted.files);
                    if (!pasted.text) return void e.preventDefault();
                  }
                }
                onTyped?.();
                briefLimit.onPaste(e);
              },
              onFocus: () => setFocused(true),
              onBlur: () => setFocused(false),
              onKeyDown: (e) => {
                // LIKE THE CHAT: Enter sends and Shift+Enter breaks the line. While an IME composes (Japanese,
                // Korean, Chinese), Enter confirms the word and must not send half a brief.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              },
              rows: 1,
              placeholder: ghost ? "" : placeholder,
              maxLength: briefLimit.maxLength,
              ...(briefLimit.warningVisible ? { "aria-describedby": briefLimit.feedbackId } : {}),
              className: s.text,
              style: { minHeight: s.minHeight },
            }}
          />
        </div>

        {/* WHAT THE ENGINE IS HEARING, before it settles. Outside the textarea on purpose: the engine can still
            CORRECT it, and watching it rewrite inside what you wrote feels like it's erasing it. */}
        {dictado.escuchando && (
          <p className={cn("pb-1", s.listening)} aria-live="polite">
            {dictado.parcial || tm("heroPrompt.listening")}
          </p>
        )}
        {/* THE ENGINE OPENED AND HEARD NOTHING, and PERMISSION DENIED: both said, a failure can't look like listening. */}
        {dictado.mudo && (
          <p className={cn("pb-1", s.warn)} role="status">
            {tm("heroPrompt.micSilent")}
          </p>
        )}
        {dictado.denegado && (
          <p className={cn("pb-1", s.warn)} role="status">
            {tm("heroPrompt.micDenied")}
          </p>
        )}
        <GenerationBriefLimitFeedback
          valueLength={value.length}
          state={briefLimit}
          warningText={tp("aiBrief.trimmed", { max: briefLimit.maxLength })}
          className="pb-1 text-[11px]"
          warningClassName="text-amber-600 dark:text-amber-400"
          counterClassName={s.counter}
        />

        <div className={cn("mt-0.5 flex items-center gap-[3px]", s.row)}>
          {/* The real `<input>`s are hidden: their native look can't be styled. `accept` FILTERS, it doesn't
              validate — the reducer and the server check the type again. */}
          <input
            ref={photoRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/avif"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => void addPhotos(e.target.files)}
          />
          {onFilesChange && (
            <input
              ref={fileRef}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])];
                e.target.value = "";
                addFiles(picked);
              }}
            />
          )}
          <div className="relative" ref={plus.refContenedor} onKeyDown={plus.alPulsarTecla}>
            <button
              type="button"
              ref={plus.refDisparador}
              aria-label={tc("newChat.composer.plus")}
              title={tc("newChat.composer.plus")}
              aria-haspopup="menu"
              aria-expanded={plusOpen}
              onClick={() => setPlusOpen((x) => !x)}
              className={toolClass(photos.length > 0)}
            >
              {readingPhoto ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Plus size={16} className={cn("transition-transform duration-200", plusOpen && "rotate-45")} />
              )}
            </button>
            {plusOpen && (
              <div
                role="menu"
                aria-label={tc("newChat.composer.plus")}
                className={cn(
                  "nc-card-in absolute bottom-[calc(100%+8px)] left-0 z-20 w-[290px] rounded-[14px] border p-1.5 shadow-[0_18px_40px_-12px_rgb(20_10_5/0.35)]",
                  s.menu,
                )}
              >
                <PlusOption
                      icon={<ImageIcon size={15} />}
                  title={tm("heroPrompt.attachImages")}
                  hint={
                    photos.length >= MAX_REFERENCIAS
                      ? tm("heroPrompt.maxImages", { max: MAX_REFERENCIAS })
                      : tm("heroPrompt.attachImagesHint", { max: MAX_REFERENCIAS })
                  }
                  count={photos.length}
                  disabled={readingPhoto || photos.length >= MAX_REFERENCIAS}
                  onClick={() => {
                    setPlusOpen(false);
                    photoRef.current?.click();
                  }}
                />
                {onFilesChange && (
                  <PlusOption
                          icon={<FileText size={15} />}
                    title={tc("composer.attachFile")}
                    hint={tc("composer.attachFileHint")}
                    count={fileList.length}
                    disabled={fileList.length >= MAX_FILES_PER_MESSAGE}
                    onClick={() => {
                      setPlusOpen(false);
                      fileRef.current?.click();
                    }}
                  />
                )}
                {moreOptions.map((option) => (
                  <PlusOption
                    key={option.key}
                          icon={option.icon}
                    title={option.title}
                    hint={option.hint}
                    count={0}
                    disabled={false}
                    onClick={() => {
                      setPlusOpen(false);
                      option.onSelect();
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          {/* THE MICROPHONE, only if the API EXISTS — the object is checked, not a list of browsers. In Firefox it
              isn't painted: a grey control that doesn't answer is worse than none. */}
          {dictado.soportado && (
            <button
              type="button"
              onClick={dictado.alternar}
              aria-pressed={dictado.escuchando}
              aria-label={dictado.escuchando ? tm("heroPrompt.stopDictating") : tm("heroPrompt.dictate")}
              title={dictado.escuchando ? tm("heroPrompt.stopDictating") : tm("heroPrompt.dictate")}
              className={cn(toolClass(dictado.escuchando), dictado.escuchando && s.micOn)}
            >
              {dictado.escuchando ? (
                <span className="relative inline-flex h-4 w-4 items-center justify-center">
                  {/* The halo beats so it's seen that the mic is OPEN. */}
                  <span className="absolute inset-0 rounded-full bg-coral-500/30 motion-safe:animate-ping" />
                  <Square size={9} className="relative fill-current" />
                </span>
              ) : (
                <Mic size={15} />
              )}
            </button>
          )}
          {kind && (
            <HeroKindPicker
              value={kind.value}
              onChange={kind.onChange}
              conJuego={kind.conJuego}
              conHerramienta={kind.conHerramienta ?? false}
              {...(kind.herramientaBloqueada ? { herramientaBloqueada: kind.herramientaBloqueada } : {})}
            />
          )}
          {/* THE CHAT'S BUTTON: a rounded square, always the same size; only its colour says there's something to send. */}
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            aria-label={tm("heroPrompt.generate")}
            title={tm("heroPrompt.generate")}
            className={cn(
              "ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-white transition hover:-translate-y-px disabled:translate-y-0 disabled:cursor-default",
              briefLimit.isValid || sending ? s.sendOn : s.sendOff,
            )}
          >
            {sending ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

/** What goes with the message: a photo or a file, with its ✕. */
function Chip({
  children,
  title,
  onRemove,
  removeLabel,
}: {
  children: ReactNode;
  title?: string;
  onRemove?: () => void;
  removeLabel: string;
}) {
  const s = SKIN;
  return (
    <span
      title={title}
      className={cn(
        "nc-pop inline-flex max-w-full items-center gap-1.5 rounded-lg border py-[3px] pl-[7px] pr-1 text-[11.5px]",
        s.chip,
      )}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className={cn("grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px]", s.chipRemove)}
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}

/** An option of the `+` menu, with what it does said under it and how many are in. */
function PlusOption({
  icon,
  title,
  hint,
  count,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  count: number;
  onClick: () => void;
  disabled: boolean;
}) {
  const s = SKIN;
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "nc-up flex w-full items-center gap-2.5 rounded-[10px] p-2 text-left disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent",
        s.option,
      )}
    >
      <span className={cn("grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px]", s.optionIcon)}>{icon}</span>
      <span className="min-w-0 flex-1">
        <b className={cn("block text-[13px] font-semibold", s.optionTitle)}>{title}</b>
        <small className={cn("block text-[11.5px] leading-snug", s.optionHint)}>{hint}</small>
      </span>
      {count > 0 && <span className={cn("shrink-0 text-[11px] font-semibold", s.accent)}>{count}</span>}
    </button>
  );
}
