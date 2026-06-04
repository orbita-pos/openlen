"use client";

// "Mi negocio" management surface — opened from the TopBar account menu. Lists
// the user's saved business profiles with edit / delete / set-default / new,
// reusing BusinessProfileModal for create + edit. A home for the profile CRUD
// outside the /new generation picker.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useFocusTrap } from "./use-focus-trap";
import { BusinessProfileModal } from "./business-profile-modal";
import type { BusinessProfile } from "@/lib/business-profiles/types";

export interface ManageProfilesModalProps {
  open: boolean;
  onClose: () => void;
  /** Fired after any create / edit / delete / set-default so the parent can
   *  refresh its picker. */
  onChanged?: () => void;
}

export function ManageProfilesModal({
  open,
  onClose,
  onChanged,
}: ManageProfilesModalProps) {
  const t = useTranslations("panelsA");
  const trapRef = useFocusTrap(open);
  const [profiles, setProfiles] = useState<BusinessProfile[]>([]);
  const [loading, setLoading] = useState(false);
  // null = editor closed · "new" = create · BusinessProfile = edit that one.
  const [editing, setEditing] = useState<BusinessProfile | "new" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/profiles");
      const json = (await res.json().catch(() => ({}))) as {
        profiles?: BusinessProfile[];
      };
      setProfiles(json.profiles ?? []);
    } catch {
      /* leave the list as-is */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && editing === null) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, editing, onClose]);

  const remove = useCallback(
    async (p: BusinessProfile) => {
      if (!window.confirm(t("profile.manage.deleteConfirm", { name: p.name }))) {
        return;
      }
      await fetch(`/api/profiles/${p.id}`, { method: "DELETE" });
      await load();
      onChanged?.();
    },
    [t, load, onChanged],
  );

  const makeDefault = useCallback(
    async (p: BusinessProfile) => {
      await fetch(`/api/profiles/${p.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ setDefault: true }),
      });
      await load();
      onChanged?.();
    },
    [load, onChanged],
  );

  if (!open) return null;

  return (
    <>
      <div
        className="workspace-v2 fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm fade-in overflow-y-auto"
        onClick={onClose}
      >
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="manage-profiles-title"
          className="relative w-full max-w-md sm:mx-4 rounded-t-2xl sm:rounded-2xl bg-elev border bd shadow-elev overflow-hidden slide-down my-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-5 py-4 border-b bd flex items-center justify-between gap-2">
            <div
              id="manage-profiles-title"
              className="text-[15px] font-semibold fg font-display"
            >
              {t("profile.manage.title")}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("profile.close")}
              className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md fg-faint hover:fg hover:bg-hover transition"
            >
              ✕
            </button>
          </div>

          <div className="px-3 py-3 min-h-[140px] max-h-[55vh] overflow-y-auto nice-scroll">
            {loading ? (
              <div className="px-2 py-8 text-center text-[12px] fg-faint">…</div>
            ) : profiles.length === 0 ? (
              <div className="px-2 py-8 text-center text-[12px] fg-faint">
                {t("profile.manage.empty")}
              </div>
            ) : (
              <ul className="space-y-1">
                {profiles.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-md hover:bg-hover transition"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] fg truncate">{p.name}</span>
                        {p.isDefault && (
                          <span className="text-[9px] font-semibold uppercase tracking-wide text-accent">
                            {t("profile.manage.isDefault")}
                          </span>
                        )}
                      </div>
                      {p.data.business_name && (
                        <div className="text-[11px] fg-faint truncate">
                          {p.data.business_name}
                        </div>
                      )}
                    </div>
                    {!p.isDefault && (
                      <button
                        type="button"
                        onClick={() => void makeDefault(p)}
                        className="shrink-0 text-[11px] fg-muted hover:fg transition"
                      >
                        {t("profile.manage.setDefault")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditing(p)}
                      className="shrink-0 text-[11px] fg-muted hover:fg transition"
                    >
                      {t("profile.manage.edit")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(p)}
                      className="shrink-0 text-[11px] text-red-600 dark:text-rose-400 hover:brightness-110 transition"
                    >
                      {t("profile.manage.delete")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="px-5 py-3 border-t bd bg-side flex justify-end">
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="px-4 py-1.5 text-[12.5px] font-medium rounded-md bg-[color:var(--accent)] text-white shadow-coral hover:brightness-105 transition"
            >
              + {t("profilePicker.new")}
            </button>
          </div>
        </div>
      </div>

      <BusinessProfileModal
        open={editing !== null}
        editProfile={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
          onChanged?.();
        }}
      />
    </>
  );
}
