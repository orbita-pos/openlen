"use client";

// LA CABECERA DEL CHAT NUEVO (plans/new-chat/): «Chat con Len», la memoria de
// Len y las charlas. «Empezar de cero» ARCHIVA la charla en curso —Len deja de
// recordarla; tu memoria y las notas de la página se quedan— y desde la misma
// lista se vuelve a una anterior (decisión de Jesús del 03/10). Con un turno
// trabajando no se cambia de charla: el servidor lo rechaza y aquí se dice.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Brain, History, MessageSquarePlus, Minimize2, PanelLeft, PictureInPicture2, X } from "lucide-react";

import { useMandoDesplegable } from "../use-mando-desplegable";
import type { ConversationActionResult, useConversations } from "./use-conversations";
import type { ChatLayout } from "./use-chat-version";

export function ChatHeader({
  layout,
  onLayout,
  memoryOpen,
  memoryCount,
  onToggleMemory,
  conversations,
  busy,
  onClose,
  closeLabel,
  relativeTime,
  esApp = false,
}: {
  /** Anclado, flotante o minimizado (del mock). */
  layout: ChatLayout;
  onLayout: (l: ChatLayout) => void;
  memoryOpen: boolean;
  memoryCount: number;
  onToggleMemory: () => void;
  conversations: ReturnType<typeof useConversations>;
  busy: boolean;
  /** En el móvil el chat tapa la pantalla: la ✕ es la única salida. */
  onClose?: () => void;
  closeLabel?: string;
  relativeTime: (ms: number) => string;
  /** El proyecto es una app: «Nueva charla» deja las notas de la app. */
  esApp?: boolean;
}) {
  const t = useTranslations("panelsChat");
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<ConversationActionResult | null>(null);
  const menu = useMandoDesplegable({ abierto: open, cerrar: () => setOpen(false) });

  const run = async (action: () => Promise<ConversationActionResult>) => {
    const r = await action();
    setNotice(r === "ok" ? null : r);
    if (r === "ok") setOpen(false);
  };

  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 border-b bd pl-4 pr-2.5 text-[13px]">
      {/* Una sola frase con la parte en negrita marcada: el orden lo pone cada
          idioma («Chat con Len», «Len とチャット»). */}
      <span className="fg-muted">
        {t.rich("newChat.header.line", { b: (chunks) => <b className="font-semibold fg">{chunks}</b> })}
      </span>
      <span className="ml-auto" />
      <button
        type="button"
        onClick={onToggleMemory}
        // Abre y cierra un panel: `aria-expanded`, como la cabecera del chat de
        // hoy. Y el número va en el nombre, que si no el globito no se oye.
        aria-expanded={memoryOpen}
        aria-label={memoryCount > 0 ? `${t("memoria.title")} (${memoryCount})` : t("memoria.title")}
        title={t("memoria.title")}
        className="relative grid h-7 w-7 place-items-center rounded-lg fg-muted hover:bg-elev hover:fg aria-expanded:bg-elev aria-expanded:fg"
      >
        <Brain size={15} />
        {memoryCount > 0 && (
          <span className="absolute right-0.5 top-0.5 min-w-[13px] rounded-full bg-[var(--accent-strong)] px-[3px] text-[9px] font-semibold leading-[13px] text-white tabular-nums">
            {memoryCount}
          </span>
        )}
      </button>
      <div className="relative" ref={menu.refContenedor} onKeyDown={menu.alPulsarTecla}>
        <button
          type="button"
          ref={menu.refDisparador}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("newChat.header.conversations")}
          title={t("newChat.header.conversations")}
          onClick={() => {
            const next = !open;
            setOpen(next);
            setNotice(null);
            if (next) void conversations.load();
          }}
          className="grid h-7 w-7 place-items-center rounded-lg fg-muted hover:bg-elev hover:fg aria-expanded:bg-elev aria-expanded:fg"
        >
          <History size={15} />
        </button>
        {open && (
          <div
            role="menu"
            aria-label={t("newChat.header.conversations")}
            className="nc-card-in absolute right-0 top-[calc(100%+6px)] z-30 w-[300px] rounded-[14px] border bd-strong bg-elev p-1.5 shadow-[0_18px_40px_-12px_rgb(20_10_5/0.35)]"
          >
            <button
              type="button"
              role="menuitem"
              disabled={busy || conversations.pending}
              onClick={() => void run(conversations.startNew)}
              className="flex w-full items-center gap-2.5 rounded-[10px] p-2 text-left hover:bg-side disabled:opacity-50"
            >
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-accent-soft text-[var(--nc-accent-text)]">
                <MessageSquarePlus size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-[13px] font-semibold">{t("newChat.header.newChat")}</b>
                <small className="block text-[11.5px] leading-snug fg-muted">{t(esApp ? "newChat.header.newChatHintApp" : "newChat.header.newChatHint")}</small>
              </span>
            </button>
            {(busy || notice === "busy") && (
              <p className="px-2 pb-1 pt-0.5 text-[11.5px] leading-snug nc-warn">{t("newChat.header.busy")}</p>
            )}
            {notice === "error" && (
              <p className="px-2 pb-1 pt-0.5 text-[11.5px] leading-snug nc-bad">{t("newChat.header.failed")}</p>
            )}
            <div className="mt-1 border-t bd px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] fg-faint">
              {t("newChat.header.archived")}
            </div>
            {conversations.archived === null ? (
              <div className="px-2 py-1.5"><span className="nc-spin inline-block" /></div>
            ) : conversations.archived.length === 0 ? (
              <p className="px-2 py-1.5 text-[12px] fg-muted">{t("newChat.header.archivedEmpty")}</p>
            ) : (
              <ul className="max-h-[260px] list-none overflow-y-auto p-0 nice-scroll">
                {conversations.archived.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={busy || conversations.pending}
                      onClick={() => void run(() => conversations.reopen(c.id))}
                      title={t("newChat.header.reopen")}
                      className="flex w-full flex-col items-start gap-0.5 rounded-[9px] px-2 py-1.5 text-left hover:bg-side disabled:opacity-50"
                    >
                      <span className="w-full truncate text-[12.5px] fg">{c.title || "…"}</span>
                      <span className="text-[11px] fg-faint">
                        {t("newChat.header.messages", { count: c.turns })} · {relativeTime(c.endedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {/* Sacar, minimizar y volver a anclar: en el móvil no (el panel ya
          ocupa la pantalla). */}
      {layout === "docked" ? (
        <button
          type="button"
          onClick={() => onLayout("floating")}
          aria-label={t("newChat.layout.float")}
          title={t("newChat.layout.float")}
          className="hidden h-7 w-7 place-items-center rounded-lg fg-muted hover:bg-elev hover:fg md:grid"
        >
          <PictureInPicture2 size={15} />
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={() => onLayout("minimized")}
            aria-label={t("newChat.layout.minimize")}
            title={t("newChat.layout.minimize")}
            className="grid h-7 w-7 place-items-center rounded-lg fg-muted hover:bg-elev hover:fg"
          >
            <Minimize2 size={15} />
          </button>
          <button
            type="button"
            onClick={() => onLayout("docked")}
            aria-label={t("newChat.layout.dock")}
            title={t("newChat.layout.dock")}
            className="grid h-7 w-7 place-items-center rounded-lg fg-muted hover:bg-elev hover:fg"
          >
            <PanelLeft size={15} />
          </button>
        </>
      )}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="grid h-7 w-7 place-items-center rounded-lg fg-muted hover:bg-elev hover:fg md:hidden"
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}
