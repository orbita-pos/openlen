// Collections owner panel — manage the items rendered on the published page
// (products / menu / listings / events / team / portfolio). Single view: a
// config header (preset + layout) + the item list (add / edit / archive /
// reorder), with an in-place editor screen. All reads/writes go through
// /api/projects/[id]/collections/*. Mirrors the bookings panel conventions
// (fetch + skeleton + empty + editor screen-swap). The grid is baked as STATIC
// HTML at publish — there is no runtime widget.

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, Grid3, ImageIcon, Loader, Pencil, Plus, Trash } from "../icons";
import { ReplaceAssetModal } from "../replace-asset-modal";
import { useToast } from "../toast";

const PRESETS = ["products", "menu", "listings", "events", "team", "portfolio"] as const;
const MAX_ITEMS = 60;

interface Item {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  imageUrl: string | null;
  priceDisplay: string | null;
  badge: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  tags: string[];
  status: "published" | "archived";
  sortOrder: number;
}
interface Collection {
  id: string;
  name: string;
  preset: string;
  layout: "grid" | "list";
}

export function CollectionsPanel({ currentProjectId }: { currentProjectId?: string | null }) {
  const t = useTranslations("collections");
  const toast = useToast();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = (pid: string) => {
    setError(null);
    void fetch(`/api/projects/${pid}/collections/items`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { collection: Collection; items: Item[] }) => {
        setCollection(d.collection);
        setItems(d.items);
      })
      .catch(() => {
        setError(t("items.loadError"));
        setItems([]);
      });
  };

  useEffect(() => {
    if (!currentProjectId) {
      setItems([]);
      return;
    }
    setItems(null);
    setCollection(null);
    load(currentProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId]);

  if (!currentProjectId) {
    return (
      <div className="h-full flex items-center justify-center px-6 py-8 text-center">
        <div className="max-w-[220px]">
          <div className="mx-auto mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md ring-1 ring-[color:var(--border)] bg-elev fg-faint">
            <Grid3 size={14} />
          </div>
          <p className="text-[11.5px] fg-muted leading-relaxed">{t("perProject")}</p>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <ItemEditor
        projectId={currentProjectId}
        item={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load(currentProjectId);
        }}
      />
    );
  }

  const live = (items ?? []).filter((i) => i.status === "published");

  const updateConfig = async (patch: Partial<Pick<Collection, "preset" | "layout">>) => {
    if (!collection) return;
    setCollection({ ...collection, ...patch });
    const r = await fetch(`/api/projects/${currentProjectId}/collections`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    if (!r || !r.ok) load(currentProjectId); // rollback to server truth
  };

  const archive = async (id: string) => {
    setBusyId(id);
    const r = await fetch(`/api/projects/${currentProjectId}/collections/items/${id}`, {
      method: "DELETE",
    }).catch(() => null);
    setBusyId(null);
    if (!r || !r.ok) {
      toast.error(t("toast.archiveError"));
    } else {
      toast.success(t("toast.archived"));
    }
    load(currentProjectId);
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= live.length) return;
    const arr = live.slice();
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    // Optimistic: show the reordered live items immediately; keep archived rows
    // in state so they aren't dropped until the reload.
    setItems([...arr, ...(items ?? []).filter((i) => i.status !== "published")]);
    await fetch(`/api/projects/${currentProjectId}/collections/items/reorder`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order: arr.map((i) => i.id) }),
    }).catch(() => {});
    load(currentProjectId);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-1.5 shrink-0">
        <div className="text-[10px] uppercase tracking-[0.16em] fg-faint font-semibold ui-small">
          {t("title")}
        </div>
        <div className="text-[11px] fg-faint mt-0.5">{t("subtitle")}</div>
      </div>

      {collection && (
        <div className="px-3 pb-2 shrink-0 space-y-2">
          <label className="block">
            <span className="text-[10.5px] font-medium fg-muted block mb-1">{t("config.preset")}</span>
            <select
              className={inputCls}
              value={PRESETS.includes(collection.preset as (typeof PRESETS)[number]) ? collection.preset : "products"}
              onChange={(e) => void updateConfig({ preset: e.target.value })}
            >
              {PRESETS.map((p) => (
                <option key={p} value={p}>
                  {t(`presets.${p}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex rounded-md bg-elev ring-1 ring-[color:var(--border)] p-0.5">
            {(["grid", "list"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => void updateConfig({ layout: l })}
                className={`flex-1 h-6 rounded text-[10.5px] font-medium transition ${
                  collection.layout === l ? "bg-[color:var(--bg)] fg shadow-card" : "fg-faint hover:fg"
                }`}
              >
                {t(l === "grid" ? "config.layoutGrid" : "config.layoutList")}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto nice-scroll px-3 pb-3 space-y-2">
        {error && (
          <div className="rounded-md ring-1 ring-red-500/40 bg-red-500/5 px-2 py-1.5 text-[11px] text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={() => setEditing("new")}
          disabled={live.length >= MAX_ITEMS}
          className="w-full h-8 rounded-md text-[11.5px] font-semibold text-white bg-[var(--accent-strong)] hover:brightness-105 transition disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
        >
          <Plus size={13} /> {t("items.add")}
        </button>

        {items === null ? (
          <div className="space-y-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 rounded-lg bg-zinc-200/60 dark:bg-zinc-800/50 animate-pulse" />
            ))}
          </div>
        ) : live.length === 0 ? (
          <p className="px-1 py-6 text-center text-[11.5px] fg-faint">{t("items.empty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {live.map((it, idx) => (
              <li
                key={it.id}
                className="group rounded-lg ring-1 ring-[color:var(--border)] bg-[color:var(--bg)] px-2.5 py-2 flex items-center gap-2"
              >
                {it.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.imageUrl}
                    alt=""
                    className="h-9 w-9 rounded-md object-cover bg-elev shrink-0"
                  />
                ) : (
                  <div className="h-9 w-9 rounded-md bg-elev ring-1 ring-[color:var(--border)] shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold fg truncate">{it.title}</div>
                  {it.priceDisplay && <div className="text-[10.5px] fg-faint truncate">{it.priceDisplay}</div>}
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
                  <button
                    type="button"
                    onClick={() => void move(idx, -1)}
                    disabled={idx === 0}
                    aria-label={t("reorder.up")}
                    className="h-6 w-5 inline-flex items-center justify-center rounded fg-faint hover:fg hover:bg-hover transition disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => void move(idx, 1)}
                    disabled={idx === live.length - 1}
                    aria-label={t("reorder.down")}
                    className="h-6 w-5 inline-flex items-center justify-center rounded fg-faint hover:fg hover:bg-hover transition disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(it)}
                    aria-label={t("items.edit")}
                    className="h-6 w-6 inline-flex items-center justify-center rounded fg-faint hover:fg hover:bg-hover transition"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void archive(it.id)}
                    disabled={busyId === it.id}
                    aria-label={t("items.archive")}
                    className="h-6 w-6 inline-flex items-center justify-center rounded fg-faint hover:text-red-500 hover:bg-hover transition disabled:opacity-50"
                  >
                    {busyId === it.id ? <Loader size={11} className="animate-spin" /> : <Trash size={12} />}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {items !== null && live.length >= MAX_ITEMS && (
          <p className="px-1 text-[10px] fg-faint text-center">{t("items.full", { n: MAX_ITEMS })}</p>
        )}
      </div>
    </div>
  );
}

// ── Item editor ──────────────────────────────────────────────────────────────

function ItemEditor({
  projectId,
  item,
  onClose,
  onSaved,
}: {
  projectId: string;
  item: Item | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("collections");
  const [title, setTitle] = useState(item?.title ?? "");
  const [subtitle, setSubtitle] = useState(item?.subtitle ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [imageUrl, setImageUrl] = useState(item?.imageUrl ?? "");
  const [priceDisplay, setPriceDisplay] = useState(item?.priceDisplay ?? "");
  const [badge, setBadge] = useState(item?.badge ?? "");
  const [ctaLabel, setCtaLabel] = useState(item?.ctaLabel ?? "");
  const [ctaUrl, setCtaUrl] = useState(item?.ctaUrl ?? "");
  const [tags, setTags] = useState((item?.tags ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const save = async () => {
    setSaving(true);
    setErr(null);
    const body = {
      title: title.trim(),
      subtitle: subtitle.trim() || null,
      description: description.trim() || null,
      imageUrl: imageUrl.trim() || null,
      priceDisplay: priceDisplay.trim() || null,
      badge: badge.trim() || null,
      ctaLabel: ctaLabel.trim() || null,
      ctaUrl: ctaUrl.trim() || null,
      tags: tags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 8),
    };
    try {
      const url = item
        ? `/api/projects/${projectId}/collections/items/${item.id}`
        : `/api/projects/${projectId}/collections/items`;
      const r = await fetch(url, {
        method: item ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        setErr(t("editor.saveError"));
        setSaving(false);
        return;
      }
      onSaved();
    } catch {
      setErr(t("editor.saveError"));
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 shrink-0 flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("editor.cancel")}
          className="h-6 w-6 inline-flex items-center justify-center rounded fg-faint hover:fg hover:bg-hover transition"
        >
          <ChevronLeft size={14} />
        </button>
        <div className="text-[12px] font-semibold fg">
          {item ? t("editor.editTitle") : t("editor.newTitle")}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto nice-scroll px-3 pb-3 space-y-3">
        {err && (
          <div className="rounded-md ring-1 ring-red-500/40 bg-red-500/5 px-2 py-1.5 text-[11px] text-red-600 dark:text-red-400">
            {err}
          </div>
        )}

        <Field label={t("editor.title")}>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("editor.titlePlaceholder")} />
        </Field>
        <Field label={t("editor.subtitle")}>
          <input className={inputCls} value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
        </Field>
        <Field label={t("editor.description")}>
          <textarea className={`${inputCls} min-h-[64px] resize-y py-1.5`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={t("editor.image")} hint={t("editor.imageHint")}>
          <div className="flex items-center gap-1.5">
            <input
              className={`${inputCls} flex-1`}
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…"
            />
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="shrink-0 h-8 px-2.5 rounded-md text-[11px] font-medium fg-muted hover:fg bg-elev ring-1 ring-[color:var(--border)] hover:bg-hover transition inline-flex items-center gap-1"
            >
              <ImageIcon size={12} /> {t("editor.pickImage")}
            </button>
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("editor.price")} hint={t("editor.priceHint")}>
            <input className={inputCls} value={priceDisplay} onChange={(e) => setPriceDisplay(e.target.value)} />
          </Field>
          <Field label={t("editor.badge")}>
            <input className={inputCls} value={badge} onChange={(e) => setBadge(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("editor.ctaLabel")}>
            <input className={inputCls} value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} />
          </Field>
          <Field label={t("editor.ctaUrl")}>
            <input className={inputCls} value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="https://…" />
          </Field>
        </div>
        <Field label={t("editor.tags")} hint={t("editor.tagsHint")}>
          <input className={inputCls} value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>

        <p className="text-[10px] fg-faint leading-relaxed">{t("editor.noCharge")}</p>
      </div>

      <div className="px-3 py-2 shrink-0 border-t border-[color:var(--border)] flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 h-8 rounded-md text-[11.5px] font-medium fg-muted hover:fg bg-elev ring-1 ring-[color:var(--border)] transition"
        >
          {t("editor.cancel")}
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !title.trim()}
          className="flex-1 h-8 rounded-md text-[11.5px] font-semibold text-white bg-[var(--accent-strong)] hover:brightness-105 transition disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
        >
          {saving ? <Loader size={12} className="animate-spin" /> : null}
          {saving ? t("editor.saving") : t("editor.save")}
        </button>
      </div>

      <ReplaceAssetModal
        open={pickerOpen}
        kind="image"
        currentSrc={imageUrl || null}
        projectId={projectId}
        initialTab="openlen"
        onClose={() => setPickerOpen(false)}
        onPick={(p) => {
          if (p.url) setImageUrl(p.url);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

const inputCls =
  "w-full h-8 rounded-md px-2.5 text-[12px] bg-[color:var(--bg)] ring-1 ring-[color:var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-strong)]";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium fg block mb-1">{label}</span>
      {children}
      {hint && <span className="text-[10px] fg-faint block mt-0.5">{hint}</span>}
    </label>
  );
}
