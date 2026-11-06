"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE ONE BOX — the home's input and /new's are this component (Jesús, 06/11: «dos inputs así es duplicación»).
//
// They had grown apart as two copies of the same thing (`hero-prompt-input.tsx` and `HeroComposer` in
// `start-landing.tsx`): the same photos, dictation, brief limit, `+` menu, kind pill and square send button, written
// twice, each with fixes the other lacked. Now there is one box with two skins, as the kind pill already had
// (`hero-kind-picker.tsx`): `portada`, in the marketing site's zinc and coral (the workspace's tokens don't live on the
// home), and `taller`, in the workspace's tokens under `.nc` (chat/new-chat.css).
//
// WHAT STAYS WITH EACH PAGE is what is really theirs: where the text lives, and what «send» does. The home keeps its
// own state, types examples while nobody touches it (`ghost`), tells Len's face in the menu what it's doing
// (`onActivity`) and, on send, leaves the ticket /new sends on arrival; /new keeps its state in the page, counts its
// usage events (`onTyped`) and sends the first message to Len. Files beyond photos (PDF, video), dropping and pasting
// them are /new's: the home has nowhere to upload them before the visitor has an account.
//
// THE TEXT AREA IS LENT (`textArea`): /new's paints URLs blue as you type (`CajaConMenciones`), which lives with the
// workspace's thread code; passing it in keeps that code out of the home's bundle. Without it, a plain textarea.
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
import { cn } from "@/lib/cn";

export type PromptBoxSkin = "portada" | "taller";

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

/** The text area the box uses (see the header): it gets the ref, the value, the skin's type and every handler. */
export type PromptBoxTextArea = (p: {
  cajaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  /** The skin's size, line height and colour. */
  medida: string;
  props: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value">;
}) => ReactNode;

const PLAIN_TEXT_AREA: PromptBoxTextArea = ({ cajaRef, value, medida, props }) => (
  <textarea
    ref={cajaRef}
    value={value}
    {...props}
    className={cn("relative block w-full resize-none bg-transparent", medida, props.className)}
  />
);

/** The two skins. Same box, same behaviour; only the colours (and the home's slightly bigger type) change. */
const SKINS = {
  portada: {
    box: "border-zinc-300 bg-white focus-within:border-coral-400 focus-within:shadow-[0_0_0_4px_rgb(255_90_54/0.13)] dark:border-zinc-700 dark:bg-zinc-950 dark:focus-within:border-coral-500",
    chip: "border-coral-500/30 bg-coral-500/[0.07] text-zinc-800 dark:text-zinc-100",
    chipRemove: "text-zinc-500 hover:bg-coral-500/15 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
    medida: "text-[15px] leading-normal text-zinc-900 dark:text-zinc-100",
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
  },
  taller: {
    box: "nc-composer bd-strong bg-elev",
    chip: "border-[color:color-mix(in_oklab,var(--accent)_30%,transparent)] bg-accent-soft fg",
    chipRemove: "fg-muted hover:bg-[color-mix(in_oklab,var(--accent)_15%,transparent)] hover:fg",
    medida: "text-[14px] leading-normal",
    text: "outline-none placeholder:fg-faint nice-scroll disabled:opacity-60",
    minHeight: 44,
    maxHeight: 160,
    ghost: "text-[14px] leading-normal fg-faint",
    listening: "text-[12px] italic fg-faint",
    warn: "text-[11.5px] text-amber-600 dark:text-amber-400",
    counter: "fg-faint",
    // No `relative`: in /new the pill's menu anchors to the box and opens downwards, under the header.
    row: "",
    tool: "hover:bg-side",
    toolOn: "text-[var(--nc-accent-text)]",
    toolOff: "fg-muted hover:fg",
    micOn: "bg-side",
    menu: "bd-strong bg-elev",
    option: "hover:bg-side",
    optionIcon: "bg-accent-soft text-[var(--nc-accent-text)]",
    optionTitle: "",
    optionHint: "fg-muted",
    accent: "text-[var(--nc-accent-text)]",
    sendOn: "bg-[var(--accent-strong)]",
    sendOff: "bg-[var(--border-strong)]",
  },
} as const;

export interface PromptBoxProps {
  piel: PromptBoxSkin;
  value: string;
  onValueChange: (v: string) => void;
  /** /new's deep-link truncation notice: the fields of `BriefFormState` that `useGenerationBriefLimit` reads. */
  truncation?: {
    value?: string | null;
    onValueChange?: (v: string | null) => void;
    token?: string | null;
    onTokenChange?: (t: string | null) => void;
  };
  photos: readonly PromptBoxPhoto[];
  onPhotosChange: (photos: readonly PromptBoxPhoto[]) => void;
  /** Files for Len beyond photos (PDF, video…), uploaded with the first message: /new only. Absent = photos only. */
  files?: readonly File[];
  onFilesChange?: (files: readonly File[]) => void;
  /** The pill. Absent = no pill. */
  kind?: KindChoice;
  placeholder: string;
  /** Called only when there is something sendable and nothing holds the button. */
  onSend: () => void;
  /** The send is on its way: a spinner on the button. */
  sending?: boolean;
  /** Everything held while the send goes (/new: its first message to Len). */
  locked?: boolean;
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
  /** Where the box lends its way in to a drop zone around it (/new's start screen). */
  addFilesRef?: MutableRefObject<((files: File[]) => void) | null>;
  /** The text area (see the header). */
  textArea?: PromptBoxTextArea;
  /** More ways in, under the attachments in the `+` menu (/new: «Pegar HTML», since 06/11 out from under the box). */
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
  piel,
  value,
  onValueChange,
  truncation,
  photos,
  onPhotosChange,
  files,
  onFilesChange,
  kind,
  placeholder,
  onSend,
  sending = false,
  locked = false,
  sendDisabled = false,
  id,
  ghost,
  onActivity,
  onTyped,
  addFilesRef,
  textArea = PLAIN_TEXT_AREA,
  moreOptions = [],
}: PromptBoxProps) {
  const s = SKINS[piel];
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
    externallyTruncatedValue: truncation?.value,
    onTruncatedValueChange: truncation?.onValueChange,
    externalAnnouncementToken: truncation?.token,
    onExternalAnnouncementTokenChange: truncation?.onTokenChange,
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

  // Grows with the text, up to the skin's height.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, s.maxHeight)}px`;
  }, [value, s.maxHeight]);

  const canSend = briefLimit.isValid && !sending && !locked && !sendDisabled;
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
    if (!onFilesChange || locked || incoming.length === 0) return;
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
    <div className="nc" data-prompt-box={piel}>
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
              skin={piel}
              title={photo.nombre}
              removeLabel={tm("heroPrompt.removeImage")}
              {...(locked ? {} : { onRemove: () => onPhotosChange(photos.filter((_, j) => j !== i)) })}
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
                skin={piel}
                title={file.name}
                removeLabel={tc("composer.removeFile")}
                {...(locked ? {} : { onRemove: () => onFilesChange(fileList.filter((_, j) => j !== i)) })}
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
          {textArea({
            cajaRef: taRef,
            value,
            medida: s.medida,
            props: {
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
              disabled: locked,
              placeholder: ghost ? "" : placeholder,
              maxLength: briefLimit.maxLength,
              ...(briefLimit.warningVisible ? { "aria-describedby": briefLimit.feedbackId } : {}),
              className: s.text,
              style: { minHeight: s.minHeight },
            },
          })}
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
              disabled={locked}
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
                  skin={piel}
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
                    skin={piel}
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
                    skin={piel}
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
              disabled={locked}
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
              piel={piel}
              value={kind.value}
              onChange={kind.onChange}
              disabled={locked}
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
            aria-label={piel === "portada" ? tm("heroPrompt.generate") : tp("aiBrief.generate")}
            title={piel === "portada" ? tm("heroPrompt.generate") : tp("aiBrief.generate")}
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

/** What goes with the message: a photo or a file, with its ✕ unless the box is held. */
function Chip({
  skin,
  children,
  title,
  onRemove,
  removeLabel,
}: {
  skin: PromptBoxSkin;
  children: ReactNode;
  title?: string;
  onRemove?: () => void;
  removeLabel: string;
}) {
  const s = SKINS[skin];
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
  skin,
  icon,
  title,
  hint,
  count,
  onClick,
  disabled,
}: {
  skin: PromptBoxSkin;
  icon: ReactNode;
  title: string;
  hint: string;
  count: number;
  onClick: () => void;
  disabled: boolean;
}) {
  const s = SKINS[skin];
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
