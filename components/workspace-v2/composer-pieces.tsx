"use client";

// Las piezas del compositor del chat nuevo que comparten los compositores del
// taller: la ficha de lo que va con el mensaje (`ComposerChip`) y la opción del
// menú `+` (`ComposerPlusOption`). Son las de `chat/chat-composer.tsx`, tal
// cual; las usa también Crear (`start-landing.tsx`) para verse como el chat.
// Viven bajo `.nc` (chat/new-chat.css): de ahí salen `--nc-accent-text` y las
// animaciones.

import type { ReactNode } from "react";
import { X } from "lucide-react";

export function ComposerChip({
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
  return (
    <span
      title={title}
      className="nc-pop inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[color:color-mix(in_oklab,var(--accent)_30%,transparent)] bg-accent-soft py-[3px] pl-[7px] pr-1 text-[11.5px] fg"
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] fg-muted hover:bg-[color-mix(in_oklab,var(--accent)_15%,transparent)] hover:fg"
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}

export function ComposerPlusOption({
  icon,
  title,
  hint,
  on,
  onLabel,
  onClick,
  disabled = false,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  on: boolean;
  onLabel: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="nc-up flex w-full items-center gap-2.5 rounded-[10px] p-2 text-left hover:bg-side disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-accent-soft text-[var(--nc-accent-text)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-[13px] font-semibold">{title}</b>
        <small className="block text-[11.5px] leading-snug fg-muted">{hint}</small>
      </span>
      {on && <span className="shrink-0 text-[11px] font-semibold text-[var(--nc-accent-text)]">{onLabel}</span>}
    </button>
  );
}
