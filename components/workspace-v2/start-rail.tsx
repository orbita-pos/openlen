"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE START FRAME — the home and /new without a project are one screen (Jesús, 06/11, on Gemini's sidebar:
// «/new y / quiero que sea compartido»).
//
// Like Gemini: a rail of icons on the left with where you can go —Crear, Plantillas, Mis páginas, Comunidad,
// Herramientas— crowned by Len's face, and the account at its foot. In the middle, the same question and the same box
// (`components/prompt-box.tsx`). On a phone the rail is a drawer behind a menu button.
//
// NO BAR ON TOP (Jesús, 06/11: «el navbar en /new sí hay navbar y en / no, quitemos ese navbar»): on /new the row
// read as a bar —the light starts under it—, on the home it didn't. Gone from both: the name «OpenLen» shows only
// with the rail open, beside Len, and the credits went into the account's menu. What stays up there is only what has
// nowhere else to go, floating over the light without a row: the corner for whoever has no account (Precios,
// Iniciar sesión, Pruébalo gratis) and, on a phone, the button that opens the drawer.
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
import "./start-rail.css";

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

/** How long the phone's drawer takes to slide out (`start-drawer-out` in start-rail.css is .18 s). */
const DRAWER_EXIT_MS = 200;

/** The name, in the open rail and atop the phone's drawer — never in a bar (Jesús, 06/11). Text, not the logo's SVG,
 *  so a second copy can't point at the first one's gradient `id` and paint nothing. */
function StartName({ href, onClick }: { href: string; onClick?: () => void }) {
  return (
    <Link
      href={href}
      data-start-name
      onClick={onClick}
      className="truncate rounded-md px-1 text-[17px] font-semibold tracking-tight fg"
    >
      Open<span className="text-coral-700 dark:text-coral-400">Len</span>
    </Link>
  );
}

export function StartRail({
  items,
  active,
  mark,
  homeHref,
  account,
  drawerOpen = false,
  onCloseDrawer,
}: {
  items: readonly StartItem[];
  active: StartItemKey | null;
  /** What crowns the rail: Len's face, on the home and on /new alike (Jesús, 06/11: «quiero a Len»). */
  mark: ReactNode;
  /** Where the name goes, beside the mark in the open rail and atop the drawer. */
  homeHref: string;
  /** The account at the rail's foot (`AccountMenu`, which pins itself there, with the credits inside); none without a
   *  session. */
  account?: ReactNode;
  /** The phone's drawer, opened by the menu button over the content. */
  drawerOpen?: boolean;
  onCloseDrawer?: () => void;
}) {
  const t = useTranslations("marketing");
  const tw = useTranslations("wsChrome");
  // THE RAIL OPENS, like Gemini's: a button at its top widens it with the names and the name «OpenLen» beside Len.
  // Closed by default; remembered here.
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
  // THE DRAWER SLIDES (start-rail.css): it stays on the page while it slides back out, and leaves when that ends —
  // by the clock, not `animationend`, which never fires with reduced motion (no animation) and would keep it forever.
  const [drawerShown, setDrawerShown] = useState(drawerOpen);
  useEffect(() => {
    if (drawerOpen) {
      setDrawerShown(true);
      return;
    }
    const leave = window.setTimeout(() => setDrawerShown(false), DRAWER_EXIT_MS);
    return () => window.clearTimeout(leave);
  }, [drawerOpen]);
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
        <div className={cn("mb-3 flex items-center", open ? "justify-between gap-1 pl-1" : "flex-col gap-2")}>
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center">{mark}</div>
            {open ? <StartName href={homeHref} /> : null}
          </div>
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
        <div className={cn("mt-auto flex flex-col", open ? "items-start pl-1" : "items-center")}>{account ?? null}</div>
      </aside>

      {(drawerOpen || drawerShown) && (
        <div
          data-start-drawer
          data-state={drawerOpen ? "open" : "closed"}
          className={cn("start-drawer fixed inset-0 z-50 flex md:hidden", !drawerOpen && "pointer-events-none")}
          role="dialog"
          aria-modal="true"
          {...(drawerOpen ? {} : { "aria-hidden": true })}
        >
          <div aria-hidden className="start-drawer__scrim absolute inset-0 bg-black/45" onClick={onCloseDrawer} />
          <nav className="start-drawer__panel relative flex h-full w-64 max-w-[80vw] flex-col gap-1 border-r bd bg-elev p-3 shadow-elev">
            {/* The name and no mark: a second copy of the mark's SVG points at the gradient `id` of the first —inside
                the hidden rail—, so it painted nothing (measured 06/11). */}
            <div className="mb-3 flex items-center justify-between pl-1">
              <StartName href={homeHref} {...(onCloseDrawer ? { onClick: onCloseDrawer } : {})} />
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
            <div className="mt-auto flex flex-col items-start">{account ?? null}</div>
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

/** What is left on top once the bar went (Jesús, 06/11): the phone's menu button on the left and the corner on the
 *  right. No name and no row of its own on a computer — there it floats over the content's top right (`md:absolute`,
 *  against the column, which is `relative`), so the light runs to the top edge. On a phone it keeps its height: the
 *  menu button must not sit on top of what is under it. */
export function StartTopRow({ onOpenMenu, right }: { onOpenMenu: () => void; right?: ReactNode }) {
  const t = useTranslations("marketing");
  return (
    <div
      data-start-top
      className="pointer-events-none relative z-20 flex h-14 shrink-0 items-center justify-between gap-2 px-3 sm:px-5 md:absolute md:inset-x-0 md:top-0"
    >
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label={t("nav.menu")}
        className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-lg fg-muted transition hover:bg-hover hover:fg md:hidden"
      >
        <Menu size={18} />
      </button>
      <div className="pointer-events-auto ml-auto flex items-center gap-1.5">{right}</div>
    </div>
  );
}

/** The content column of the start frame: the top row and, under it, the content. Off (inside a project), nothing. */
export function StartColumn({ on, top, children }: { on: boolean; top: ReactNode; children: ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {top}
      <div className="relative flex min-h-0 flex-1">{children}</div>
    </div>
  );
}
