"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE START FRAME — the home and /new without a project are one screen (Jesús, 06/11, on Gemini's sidebar:
// «/new y / quiero que sea compartido»).
//
// Like Gemini: a rail of icons on the left with where you can go —Crear, Plantillas, Mis páginas, Comunidad,
// Herramientas— and the account at its foot; a light row on top with the name on the left and, on the right, the
// corner (sign in and try it free without an account, your credits with one). In the middle, the same question and
// the same box (`components/prompt-box.tsx`). On a phone the rail is a drawer behind a menu button.
//
// Until 06/11 /new carried these places as tabs in its top bar (`TopBar`'s start mode), and the home had the marketing
// menu. Inside a project nothing changes: the workspace keeps its own rail (`left-sidebar.tsx`), whose look this one
// copies — the same 32 px-ish icons and tooltips —, but transparent and without a border, so the home's light shows
// through it as Gemini's does.
//
// It is drawn with the workspace's tokens (`bg-hover`, `fg`…): /new is inside `.workspace-v2` already, and the home
// wraps itself in one (under its `.dark`, so the dark tokens).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { FolderOpen, LayoutTemplate, Menu, PanelLeftClose, PanelLeftOpen, SquarePen, Users, Wrench, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { Tooltip } from "./ui";

export type StartItemKey = "crear" | "plantillas" | "mispaginas" | "comunidad" | "herramientas";

export interface StartItem {
  key: StartItemKey;
  label: string;
  /** Where it goes. Without it, `onSelect` does it in place (the workspace changes view without reloading). */
  href?: string;
  onSelect?: () => void;
}

const ICONS: Record<StartItemKey, typeof SquarePen> = {
  crear: SquarePen,
  plantillas: LayoutTemplate,
  mispaginas: FolderOpen,
  comunidad: Users,
  herramientas: Wrench,
};

/** Whether the rail was left open, per browser (a convenience, like the chat's width). */
const OPEN_KEY = "openlen:start-rail-open";

export function StartRail({
  items,
  active,
  mark,
  account,
  credits,
  drawerOpen = false,
  onCloseDrawer,
}: {
  items: readonly StartItem[];
  active: StartItemKey | null;
  /** What crowns the rail: the brand's mark (on the home, Len's live face). */
  mark: ReactNode;
  /** The account at the rail's foot (`AccountMenu`, which pins itself there); none without a session. */
  account?: ReactNode;
  /** The credits, above the account — only with the rail open, and in the phone's drawer (Jesús, 06/11). */
  credits?: ReactNode;
  /** The phone's drawer, opened by the top row's menu button. */
  drawerOpen?: boolean;
  onCloseDrawer?: () => void;
}) {
  const t = useTranslations("marketing");
  const tw = useTranslations("wsChrome");
  // THE RAIL OPENS, like Gemini's: a button at its top widens it with the names, and then it shows the credits
  // (Jesús, 06/11: «el crédito tiene que estar en el sidebar cuando lo abren»). Closed by default; remembered here.
  const [open, setOpen] = useState(false);
  // It slides only when pressed: coming back open from storage, it is simply open (no slide on every visit).
  const [slides, setSlides] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) === "1");
    } catch {
      /* no storage: it starts closed */
    }
  }, []);
  const toggle = () => {
    const next = !open;
    setSlides(true);
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      /* not remembered, still toggled */
    }
  };
  // Escape closes the phone's drawer, as any dialog.
  useEffect(() => {
    if (!drawerOpen || !onCloseDrawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, onCloseDrawer]);
  return (
    <>
      {/* `self-stretch`, not `h-full`: on the home the frame only has a min-height, so 100% was the icons' height and
          the account sat right under them instead of at the foot. */}
      <aside
        data-start-rail
        data-open={String(open)}
        className={cn(
          "hidden shrink-0 flex-col gap-1 self-stretch pb-1 pt-3 md:flex",
          slides && "transition-[width] duration-200 motion-reduce:transition-none",
          open ? "w-60 px-2.5" : "w-14 items-center",
        )}
      >
        <div className={cn("mb-3 flex items-center", open ? "justify-between pl-1" : "flex-col gap-2")}>
          <div className="flex h-8 w-8 items-center justify-center">{mark}</div>
          <Tooltip label={open ? tw("start.closeMenu") : t("nav.menu")} side="right">
            <button
              type="button"
              onClick={toggle}
              aria-label={open ? tw("start.closeMenu") : t("nav.menu")}
              aria-expanded={open}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg fg-muted transition hover:bg-hover hover:fg"
            >
              {open ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
            </button>
          </Tooltip>
        </div>
        {items.map((item) => {
          const Icon = ICONS[item.key];
          return open ? (
            <ItemControl
              key={item.key}
              item={item}
              active={item.key === active}
              className="h-9 w-full gap-3 rounded-lg px-2.5 text-[13.5px] font-medium"
            >
              <Icon size={18} className="shrink-0" />
              <span className="truncate">{item.label}</span>
            </ItemControl>
          ) : (
            <Tooltip key={item.key} label={item.label} side="right">
              <ItemControl item={item} active={item.key === active} className="h-9 w-9 justify-center rounded-lg">
                <Icon size={18} />
              </ItemControl>
            </Tooltip>
          );
        })}
        <div className={cn("mt-auto flex flex-col gap-2", open ? "items-start pl-1" : "items-center")}>
          {open && credits ? <div className="flex">{credits}</div> : null}
          {account ?? null}
        </div>
      </aside>

      {drawerOpen && (
        <div data-start-drawer className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true">
          <div aria-hidden className="absolute inset-0 bg-black/45" onClick={onCloseDrawer} />
          <nav className="relative flex h-full w-64 max-w-[80vw] flex-col gap-1 border-r bd bg-elev p-3 shadow-elev">
            {/* No mark here: the top row already says OpenLen, and a second copy of the logo's SVG points at the
                gradient `id` of the first —inside the hidden rail—, so it painted nothing (measured 06/11). */}
            <div className="mb-3 flex items-center justify-end">
              <button
                type="button"
                onClick={onCloseDrawer}
                aria-label={tw("start.closeMenu")}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg fg-muted transition hover:bg-hover hover:fg"
              >
                <X size={18} />
              </button>
            </div>
            {items.map((item) => {
              const Icon = ICONS[item.key];
              return (
                <ItemControl
                  key={item.key}
                  item={item}
                  active={item.key === active}
                  {...(onCloseDrawer ? { onDone: onCloseDrawer } : {})}
                  className="h-10 w-full gap-3 rounded-lg px-3 text-[14px] font-medium"
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </ItemControl>
              );
            })}
            <div className="mt-auto flex flex-col items-start gap-2">
              {credits ? <div className="flex">{credits}</div> : null}
              {account ?? null}
            </div>
          </nav>
        </div>
      )}
    </>
  );
}

/** One place: a link when it has where to go, a button when it changes the view in place. */
function ItemControl({
  item,
  active,
  className,
  onDone,
  children,
}: {
  item: StartItem;
  active: boolean;
  className: string;
  onDone?: () => void;
  children: ReactNode;
}) {
  const common = {
    "data-start-item": "",
    "aria-label": item.label,
    ...(active ? { "aria-current": "page" as const } : {}),
    className: cn("inline-flex items-center transition", active ? "bg-hover fg" : "fg-muted hover:bg-hover hover:fg", className),
  };
  if (item.href) {
    return (
      <Link href={item.href} {...common} onClick={onDone}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      {...common}
      onClick={() => {
        item.onSelect?.();
        onDone?.();
      }}
    >
      {children}
    </button>
  );
}

/** The light row above the content: the name on the left (with the phone's menu button), the corner on the right. */
export function StartTopRow({
  homeHref,
  onOpenMenu,
  right,
}: {
  homeHref: string;
  onOpenMenu: () => void;
  right?: ReactNode;
}) {
  const t = useTranslations("marketing");
  return (
    <div data-start-top className="relative z-20 flex h-14 shrink-0 items-center justify-between gap-2 px-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label={t("nav.menu")}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg fg-muted transition hover:bg-hover hover:fg md:hidden"
        >
          <Menu size={18} />
        </button>
        <Link href={homeHref} className="rounded-md px-1 text-[17px] font-semibold tracking-tight fg">
          Open<span className="text-coral-700 dark:text-coral-400">Len</span>
        </Link>
      </div>
      <div className="flex items-center gap-1.5">{right}</div>
    </div>
  );
}

/** The content column of the start frame: the top row and, under it, the content. Off (inside a project), nothing. */
export function StartColumn({ on, top, children }: { on: boolean; top: ReactNode; children: ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {top}
      <div className="relative flex min-h-0 flex-1">{children}</div>
    </div>
  );
}
