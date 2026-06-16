"use client";

// Always-visible active-business switcher for the workspace rail. The rail is a
// narrow w-12 icon column, so the TRIGGER is a business AVATAR (logo or initial
// on the brand accent); clicking opens the SAME rich dropdown as the /business
// page's switcher (one design across the app) + a "Todos" option (only at 2+).
// The active business scopes Páginas/Analytics/Mensajes + is the default a new
// page attaches to.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Plus, Store } from "./icons";
import type { BusinessProfile } from "@/lib/business-profiles/types";

/** Sentinel active-business value meaning "show all businesses" (no scoping). */
export const ALL_BUSINESSES = "all";

const inicialDe = (name: string) => (name.trim()[0] || "N").toUpperCase();

// Active-business avatar (logo on white, or the initial on the brand accent).
// Adds a load-in fade so the logo doesn't pop over its white backdrop. Shared:
// the rail switcher here AND the /business brand field reuse it (single source).
export function BizAvatar({
  name,
  logoUrl,
  accent,
  className = "",
}: {
  name: string;
  logoUrl?: string | null;
  accent?: string | null;
  className?: string;
}) {
  // Until the logo decodes, the accent + initial stand in; the image fades in
  // on top so there's no white flash. Reset when the source changes (e.g.
  // switching active business).
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
  }, [logoUrl]);
  return (
    <span
      className={`relative inline-flex items-center justify-center overflow-hidden text-white font-bold shrink-0 transition-colors duration-300 ${className}`}
      style={{ background: logoUrl && loaded ? "#ffffff" : accent ?? "#FF5A36" }}
    >
      {logoUrl ? (
        <>
          {!loaded && <span aria-hidden>{inicialDe(name)}</span>}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={(el) => {
              // Cached images may be `complete` before onLoad can attach.
              if (el?.complete && el.naturalWidth > 0) setLoaded(true);
            }}
            src={logoUrl}
            alt=""
            onLoad={() => setLoaded(true)}
            className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${
              loaded ? "opacity-100" : "opacity-0"
            }`}
          />
        </>
      ) : (
        inicialDe(name)
      )}
    </span>
  );
}

function AllAvatar({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center text-[#8A8784] dark:text-[#9B9897] font-semibold shrink-0 bg-[#F4F2F0] dark:bg-white/8 ${className}`}
    >
      ∞
    </span>
  );
}

export function RailBusinessSwitcher({
  businesses,
  activeId,
  onPick,
  onAdd,
  onOpenBusiness,
}: {
  businesses: BusinessProfile[];
  /** A profile id, or ALL_BUSINESSES. */
  activeId: string;
  onPick: (id: string) => void;
  onAdd: () => void;
  /** Navigate to the Business section (the avatar is the business control). */
  onOpenBusiness: () => void;
}) {
  const t = useTranslations("miNegocio");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const isAll = activeId === ALL_BUSINESSES;
  const active = businesses.find((b) => b.id === activeId) ?? null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("switcher.change")}
        title={isAll ? t("switcher.all") : active?.name?.trim() || t("switcher.newBusiness")}
        className="h-9 w-9 inline-flex items-center justify-center rounded-lg hover:bg-hover transition"
      >
        {isAll ? (
          <AllAvatar className="h-7 w-7 rounded-lg text-[12px] ring-1 ring-black/5 dark:ring-white/10" />
        ) : (
          <BizAvatar
            name={active?.name ?? ""}
            logoUrl={active?.data.brand?.logoUrl}
            accent={active?.data.brand?.accent}
            className="h-7 w-7 rounded-lg text-[12px] ring-1 ring-black/5 dark:ring-white/10"
          />
        )}
      </button>
      {open && (
        <div className="absolute top-0 left-[calc(100%+8px)] w-[288px] max-w-[calc(100vw-4rem)] rounded-2xl bg-white dark:bg-[#1A1A1D] ring-1 ring-[#E5E3E1] dark:ring-white/10 shadow-xl p-1.5 z-40">
          <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#8A8784]">
            {t("switcher.yours")}
          </div>
          {businesses.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                onPick(b.id);
                setOpen(false);
              }}
              className={`flex items-center gap-2.5 w-full text-left px-2 py-2 rounded-xl transition ${
                b.id === activeId
                  ? "bg-[#FAFAF9] dark:bg-white/5"
                  : "hover:bg-[#FAFAF9] dark:hover:bg-white/5"
              }`}
            >
              <BizAvatar
                name={b.name}
                logoUrl={b.data.brand?.logoUrl}
                accent={b.data.brand?.accent}
                className="h-9 w-9 rounded-lg text-[14px]"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-[13.5px] font-semibold truncate">
                    {b.name.trim() || t("switcher.newBusiness")}
                  </span>
                  {b.isDefault && (
                    <span className="inline-flex items-center rounded-full bg-coral-50 dark:bg-coral-500/15 text-coral-700 dark:text-coral-300 px-1.5 py-0.5 text-[10px] font-semibold">
                      {t("switcher.principal")}
                    </span>
                  )}
                </span>
                <span className="block text-[11.5px] text-[#8A8784] dark:text-[#9B9897] truncate">
                  {(b.data.industry ?? "").trim() || t("switcher.noDesc")}
                </span>
              </span>
              {b.id === activeId && (
                <Check size={15} className="text-coral-600 shrink-0" />
              )}
            </button>
          ))}
          {businesses.length >= 2 && (
            <button
              type="button"
              onClick={() => {
                onPick(ALL_BUSINESSES);
                setOpen(false);
              }}
              className={`flex items-center gap-2.5 w-full text-left px-2 py-2 rounded-xl transition ${
                isAll
                  ? "bg-[#FAFAF9] dark:bg-white/5"
                  : "hover:bg-[#FAFAF9] dark:hover:bg-white/5"
              }`}
            >
              <AllAvatar className="h-9 w-9 rounded-lg text-[15px]" />
              <span className="min-w-0 flex-1 text-[13.5px] font-semibold truncate">
                {t("switcher.all")}
              </span>
              {isAll && <Check size={15} className="text-coral-600 shrink-0" />}
            </button>
          )}
          <div className="my-1 border-t border-[#EEECEA] dark:border-white/8" />
          <button
            type="button"
            onClick={() => {
              onAdd();
              setOpen(false);
            }}
            className="flex items-center gap-2.5 w-full text-left px-2.5 py-2 rounded-xl text-[13.5px] font-medium text-coral-700 dark:text-coral-300 hover:bg-coral-50 dark:hover:bg-coral-500/10 transition"
          >
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-dashed ring-coral-300 dark:ring-coral-500/40 shrink-0">
              <Plus size={16} />
            </span>
            {t("switcher.add")}
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenBusiness();
              setOpen(false);
            }}
            className="flex items-center gap-2.5 w-full text-left px-2.5 py-2 rounded-xl text-[13.5px] font-medium text-[#3A3937] dark:text-[#E9E7E5] hover:bg-[#FAFAF9] dark:hover:bg-white/5 transition"
          >
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#F4F2F0] dark:bg-white/8 text-[#6B6967] dark:text-[#9B9897] shrink-0">
              <Store size={16} />
            </span>
            {t("switcher.openBusiness")}
          </button>
        </div>
      )}
    </div>
  );
}
