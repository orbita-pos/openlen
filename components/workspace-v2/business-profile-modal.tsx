"use client";

// "Mi negocio" — create / edit a saved business profile. Import-first: pull the
// user's info from a screenshot (e.g. their Instagram), a website URL, or a
// short description via /api/profiles/extract, then CONFIRM a few fields and
// save. Editing an existing profile skips import and opens straight on confirm.
// The saved profile seeds every generated page (see /api/curate).

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useFocusTrap } from "./use-focus-trap";
import type {
  BusinessProfile,
  BusinessProfileData,
} from "@/lib/business-profiles/types";

type Step = "import" | "confirm";
type Source = "image" | "text" | "url";

interface Draft {
  label: string; // the profile's display name (defaults to business_name)
  business_name: string;
  industry: string;
  whatsapp: string;
  phone: string;
  email: string;
  address: string;
  instagram: string;
  accent: string; // brand colour hex (derived from the logo or typed)
  logoUrl: string;
  photos: string[];
  showContactWidget: boolean; // floating contact bar on seeded pages
}

const EMPTY: Draft = {
  label: "",
  business_name: "",
  industry: "",
  whatsapp: "",
  phone: "",
  email: "",
  address: "",
  instagram: "",
  accent: "",
  logoUrl: "",
  photos: [],
  showContactWidget: true,
};

export interface BusinessProfileModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (profile: BusinessProfile) => void;
  editProfile?: BusinessProfile | null;
}

export function BusinessProfileModal({
  open,
  onClose,
  onSaved,
  editProfile,
}: BusinessProfileModalProps) {
  const t = useTranslations("panelsA");
  const trapRef = useFocusTrap(open);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoColorRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("import");
  const [source, setSource] = useState<Source>("image");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<"image/jpeg" | "image/png">("image/jpeg");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on open. Editing → straight to confirm, pre-filled.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    if (editProfile) {
      setDraft(draftFromProfile(editProfile));
      setStep("confirm");
    } else {
      setDraft(EMPTY);
      setDescription("");
      setUrl("");
      setImageDataUrl(null);
      setSource("image");
      setStep("import");
    }
  }, [open, editProfile]);

  // ESC closes when idle.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const onFile = useCallback((file: File) => {
    if (file.type !== "image/jpeg" && file.type !== "image/png") {
      setError(t("profile.errors.image"));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError(t("profile.errors.tooLarge"));
      return;
    }
    setError(null);
    setImageMime(file.type === "image/png" ? "image/png" : "image/jpeg");
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setImageDataUrl(reader.result);
    };
    reader.readAsDataURL(file);
  }, [t]);

  // Pull a vivid brand accent out of an uploaded logo (node-vibrant, client-
  // side). The logo itself isn't stored here — only its colour. Fail-open: the
  // user can always type the hex.
  const deriveAccentFromLogo = useCallback(async (file: File) => {
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () =>
          typeof r.result === "string" ? resolve(r.result) : reject(new Error());
        r.onerror = () => reject(new Error());
        r.readAsDataURL(file);
      });
      const mod = await import("node-vibrant/browser");
      const Vibrant = mod.Vibrant as unknown as {
        from(src: string): {
          getPalette(): Promise<Record<string, { hex?: string } | null>>;
        };
      };
      const palette = await Vibrant.from(dataUrl).getPalette();
      const order = [
        "Vibrant",
        "DarkVibrant",
        "LightVibrant",
        "Muted",
        "DarkMuted",
        "LightMuted",
      ];
      for (const k of order) {
        const hex = palette[k]?.hex;
        if (typeof hex === "string") {
          setDraft((d) => ({ ...d, accent: hex }));
          return;
        }
      }
    } catch {
      /* couldn't read the colour — the hex field stays editable */
    }
  }, []);

  // Upload a logo/photo to the user's profile asset namespace → returns a URL.
  const uploadAsset = useCallback(async (file: File): Promise<string | null> => {
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/profiles/assets", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { url?: string };
      return res.ok && typeof json.url === "string" ? json.url : null;
    } catch {
      return null;
    }
  }, []);

  // A logo upload both STORES the logo (brand.logoUrl) and derives the accent.
  const handleLogoFile = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const url = await uploadAsset(file);
        if (url) setDraft((d) => ({ ...d, logoUrl: url }));
        await deriveAccentFromLogo(file);
      } finally {
        setBusy(false);
      }
    },
    [uploadAsset, deriveAccentFromLogo],
  );

  const handlePhotos = useCallback(
    async (files: File[]) => {
      setBusy(true);
      try {
        for (const f of files.slice(0, 8)) {
          const url = await uploadAsset(f);
          if (url) setDraft((d) => ({ ...d, photos: [...d.photos, url] }));
        }
      } finally {
        setBusy(false);
      }
    },
    [uploadAsset],
  );

  const extract = useCallback(async () => {
    setError(null);
    let body: Record<string, unknown>;
    if (source === "image") {
      if (!imageDataUrl) return setError(t("profile.errors.uploadFirst"));
      body = { source: "image", image: imageDataUrl, imageMime };
    } else if (source === "url") {
      if (!/^https?:\/\//i.test(url.trim())) return setError(t("profile.errors.url"));
      body = { source: "url", url: url.trim() };
    } else {
      if (description.trim().length < 10) return setError(t("profile.errors.describe"));
      body = { source: "text", description: description.trim() };
    }
    setBusy(true);
    try {
      const res = await fetch("/api/profiles/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        data?: Record<string, unknown>;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.data) {
        setError(json.error || t("profile.errors.extract"));
        return;
      }
      setDraft(draftFromExtracted(json.data));
      setStep("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("profile.errors.extract"));
    } finally {
      setBusy(false);
    }
  }, [source, imageDataUrl, imageMime, description, url, t]);

  const save = useCallback(async () => {
    const label = (draft.label || draft.business_name).trim();
    if (!label) return setError(t("profile.errors.name"));
    setBusy(true);
    setError(null);
    const data = draftToData(draft);
    try {
      const res = editProfile
        ? await fetch(`/api/profiles/${editProfile.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: label, data }),
          })
        : await fetch("/api/profiles", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: label, data }),
          });
      const json = (await res.json().catch(() => ({}))) as {
        profile?: BusinessProfile;
        error?: string;
      };
      if (!res.ok || !json.profile) {
        setError(json.error || t("profile.errors.save"));
        return;
      }
      onSaved(json.profile);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("profile.errors.save"));
    } finally {
      setBusy(false);
    }
  }, [draft, editProfile, onSaved, onClose, t]);

  if (!open) return null;

  return (
    <div
      className="workspace-v2 fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm fade-in overflow-y-auto"
      onClick={() => !busy && onClose()}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
        className="relative w-full max-w-lg sm:mx-4 rounded-t-2xl sm:rounded-2xl bg-elev border bd shadow-elev overflow-hidden slide-down my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b bd flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div id="profile-modal-title" className="text-[15px] font-semibold fg font-display">
              {editProfile ? t("profile.titleEdit") : t("profile.title")}
            </div>
            <div className="text-[12px] fg-faint mt-0.5 leading-snug">
              {step === "import" ? t("profile.subtitle") : t("profile.confirm.subtitle")}
            </div>
          </div>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            disabled={busy}
            aria-label={t("profile.close")}
            className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md fg-faint hover:fg hover:bg-hover transition disabled:opacity-30"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto nice-scroll">
          {step === "import" ? (
            <div className="space-y-3">
              <div className="flex gap-1 text-[12px]">
                {(["image", "url", "text"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSource(s)}
                    disabled={busy}
                    className={`px-3 py-1.5 rounded-md transition disabled:opacity-40 ${
                      source === s ? "seg-active" : "fg-muted hover:fg hover:bg-hover"
                    }`}
                  >
                    {t(`profile.import.${s}`)}
                  </button>
                ))}
              </div>

              {source === "image" && (
                <div
                  onClick={() => fileRef.current?.click()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files[0];
                    if (f) onFile(f);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  className="border-2 border-dashed bd hover:bd-strong rounded-xl p-6 text-center cursor-pointer transition bg-app"
                >
                  {imageDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageDataUrl} alt="" className="max-h-40 mx-auto rounded-md shadow-card" />
                  ) : (
                    <div>
                      <div className="text-2xl mb-1.5">📷</div>
                      <div className="text-[12.5px] fg">{t("profile.import.imageDrop")}</div>
                      <div className="text-[11px] fg-faint mt-1">{t("profile.import.imageHint")}</div>
                    </div>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onFile(f);
                    }}
                  />
                </div>
              )}

              {source === "url" && (
                <input
                  type="url"
                  inputMode="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t("profile.import.urlPlaceholder")}
                  className="w-full px-3 py-2.5 text-[13px] fg bg-app border bd rounded-md focus:bd-strong focus:outline-none placeholder:fg-faint"
                />
              )}

              {source === "text" && (
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("profile.import.textPlaceholder")}
                  rows={4}
                  className="w-full px-3 py-2.5 text-[13px] fg bg-app border bd rounded-md focus:bd-strong focus:outline-none placeholder:fg-faint resize-y min-h-[100px] leading-relaxed"
                />
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              <Field label={t("profile.fields.label")} value={draft.label} onChange={(v) => setDraft((d) => ({ ...d, label: v }))} placeholder={draft.business_name || t("profile.fields.labelPlaceholder")} />
              <Field label={t("profile.fields.businessName")} value={draft.business_name} onChange={(v) => setDraft((d) => ({ ...d, business_name: v }))} />
              <Field label={t("profile.fields.industry")} value={draft.industry} onChange={(v) => setDraft((d) => ({ ...d, industry: v }))} />
              <div className="grid grid-cols-2 gap-2">
                <Field label={t("profile.fields.whatsapp")} value={draft.whatsapp} onChange={(v) => setDraft((d) => ({ ...d, whatsapp: v }))} />
                <Field label={t("profile.fields.phone")} value={draft.phone} onChange={(v) => setDraft((d) => ({ ...d, phone: v }))} />
              </div>
              <Field label={t("profile.fields.email")} value={draft.email} onChange={(v) => setDraft((d) => ({ ...d, email: v }))} />
              <Field label={t("profile.fields.address")} value={draft.address} onChange={(v) => setDraft((d) => ({ ...d, address: v }))} />
              <Field label={t("profile.fields.instagram")} value={draft.instagram} onChange={(v) => setDraft((d) => ({ ...d, instagram: v }))} placeholder="@" />
              <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer select-none">
                <span className="min-w-0">
                  <span className="block text-[12.5px] fg font-medium">{t("profile.fields.contactWidget.label")}</span>
                  <span className="block text-[11px] fg-faint mt-0.5 leading-snug">{t("profile.fields.contactWidget.hint")}</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.showContactWidget}
                  aria-label={t("profile.fields.contactWidget.label")}
                  onClick={() => setDraft((d) => ({ ...d, showContactWidget: !d.showContactWidget }))}
                  className={`relative shrink-0 h-5 w-9 rounded-full transition ${draft.showContactWidget ? "bg-[color:var(--accent)]" : "bg-[color:var(--border-strong,#9ca3af)]"}`}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${draft.showContactWidget ? "left-[18px]" : "left-0.5"}`} />
                </button>
              </label>
              <div>
                <span className="text-[10.5px] font-medium fg-muted uppercase tracking-wider">
                  {t("profile.fields.color")}
                </span>
                <div className="mt-1 flex items-center gap-2">
                  {draft.logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={draft.logoUrl}
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-md object-contain border bd bg-app"
                    />
                  )}
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(draft.accent) ? draft.accent : "#e8743a"}
                    onChange={(e) => setDraft((d) => ({ ...d, accent: e.target.value }))}
                    aria-label={t("profile.fields.color")}
                    className="h-9 w-11 shrink-0 rounded-md border bd bg-app cursor-pointer"
                  />
                  <input
                    type="text"
                    value={draft.accent}
                    onChange={(e) => setDraft((d) => ({ ...d, accent: e.target.value }))}
                    placeholder="#e8743a"
                    className="flex-1 min-w-0 px-3 py-2 text-[13px] fg bg-app border bd rounded-md focus:bd-strong focus:outline-none placeholder:fg-faint"
                  />
                  <button
                    type="button"
                    onClick={() => logoColorRef.current?.click()}
                    disabled={busy}
                    className="shrink-0 px-2.5 py-2 text-[11.5px] fg-muted hover:fg hover:bg-hover rounded-md ring-1 ring-[color:var(--border)] transition disabled:opacity-40"
                  >
                    {t("profile.fields.takeFromLogo")}
                  </button>
                  <input
                    ref={logoColorRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleLogoFile(f);
                    }}
                  />
                </div>
              </div>
              <div>
                <span className="text-[10.5px] font-medium fg-muted uppercase tracking-wider">
                  {t("profile.fields.photos")}
                </span>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {draft.photos.map((url, i) => (
                    <div key={`${url}-${i}`} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt=""
                        className="h-12 w-12 rounded-md object-cover border bd"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            photos: d.photos.filter((_, j) => j !== i),
                          }))
                        }
                        aria-label={t("profile.photosRemove")}
                        className="absolute -top-1.5 -right-1.5 h-4 w-4 inline-flex items-center justify-center rounded-full bg-[color:var(--bg)] border bd text-[9px] fg-faint hover:fg"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => photosRef.current?.click()}
                    disabled={busy}
                    className="h-12 w-12 shrink-0 inline-flex items-center justify-center rounded-md border-2 border-dashed bd hover:bd-strong text-lg fg-faint transition disabled:opacity-40"
                  >
                    +
                  </button>
                  <input
                    ref={photosRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (files.length) void handlePhotos(files);
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t bd bg-side flex items-center justify-between gap-3">
          <div className="text-[11.5px] min-w-0 truncate">
            {error ? (
              <span className="text-red-600 dark:text-rose-400">✗ {error}</span>
            ) : busy ? (
              <span className="fg-faint">{step === "import" ? t("profile.import.extracting") : t("profile.saving")}</span>
            ) : null}
          </div>
          <div className="flex gap-2 shrink-0">
            {step === "import" ? (
              <>
                <button type="button" onClick={() => setStep("confirm")} disabled={busy} className="px-3 py-1.5 text-[12.5px] fg-muted hover:fg hover:bg-hover rounded-md transition disabled:opacity-40">
                  {t("profile.import.manual")}
                </button>
                <button type="button" onClick={() => void extract()} disabled={busy} className="px-4 py-1.5 text-[12.5px] font-medium rounded-md bg-[color:var(--accent)] text-white shadow-coral hover:brightness-105 transition disabled:opacity-40">
                  {busy ? t("profile.import.extracting") : t("profile.import.extract")}
                </button>
              </>
            ) : (
              <>
                {!editProfile && (
                  <button type="button" onClick={() => setStep("import")} disabled={busy} className="px-3 py-1.5 text-[12.5px] fg-muted hover:fg hover:bg-hover rounded-md transition disabled:opacity-40">
                    {t("profile.back")}
                  </button>
                )}
                <button type="button" onClick={() => void save()} disabled={busy} className="px-4 py-1.5 text-[12.5px] font-medium rounded-md bg-[color:var(--accent)] text-white shadow-coral hover:brightness-105 transition disabled:opacity-40">
                  {busy ? t("profile.saving") : t("profile.save")}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10.5px] font-medium fg-muted uppercase tracking-wider">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full px-3 py-2 text-[13px] fg bg-app border bd rounded-md focus:bd-strong focus:outline-none placeholder:fg-faint"
      />
    </label>
  );
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function draftFromExtracted(data: Record<string, unknown>): Draft {
  const contact = (data.contact && typeof data.contact === "object" ? data.contact : {}) as Record<string, unknown>;
  const socials = (contact.socials && typeof contact.socials === "object" ? contact.socials : {}) as Record<string, unknown>;
  const business = str(data.business_name);
  return {
    label: business,
    business_name: business,
    industry: str(data.industry) || str(data.tagline_es) || str(data.tagline_en),
    whatsapp: str(contact.whatsapp),
    phone: str(contact.phone),
    email: str(contact.email),
    address: str(contact.address),
    instagram: str(socials.instagram),
    accent: "",
    logoUrl: "",
    photos: [],
    showContactWidget: true,
  };
}

function draftFromProfile(p: BusinessProfile): Draft {
  const data = p.data;
  const contact = data.contact ?? null;
  return {
    label: p.name,
    business_name: str(data.business_name),
    industry: str(data.industry),
    whatsapp: str(contact?.whatsapp),
    phone: str(contact?.phone),
    email: str(contact?.email),
    address: str(contact?.address),
    instagram: str(contact?.socials?.instagram),
    accent: str(data.brand?.accent),
    logoUrl: str(data.brand?.logoUrl),
    photos: Array.isArray(data.photos) ? data.photos : [],
    showContactWidget: data.showContactWidget !== false,
  };
}

function draftToData(d: Draft): BusinessProfileData {
  return {
    business_name: d.business_name.trim() || null,
    industry: d.industry.trim() || null,
    tagline_es: null,
    tagline_en: null,
    pitch: null,
    hero_keyword: null,
    features: [],
    pricing: [],
    testimonials: [],
    cta_primary: null,
    cta_secondary: null,
    faq_questions: [],
    language_detected: null,
    contact: {
      whatsapp: d.whatsapp.trim() || null,
      phone: d.phone.trim() || null,
      email: d.email.trim() || null,
      address: d.address.trim() || null,
      socials: {
        instagram: d.instagram.trim() || null,
        facebook: null,
        tiktok: null,
        website: null,
      },
    },
    brand:
      d.accent.trim() || d.logoUrl.trim()
        ? { logoUrl: d.logoUrl.trim() || null, accent: d.accent.trim() || null }
        : null,
    photos: d.photos,
    showContactWidget: d.showContactWidget,
  };
}
