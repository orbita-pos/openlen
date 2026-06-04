"use client";

// "Mi negocio" — full management page for the user's saved business profiles.
// Replaces the manage-profiles modal as the home for the profile (the /new
// picker's quick-create modal still exists). Wired to /api/profiles (CRUD),
// /api/profiles/assets (logo+photo upload) and /api/profiles/extract (import).
// Spanish copy for v1 (LatAm persona); i18n is a follow-up.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useDarkMode } from "@/lib/use-dark-mode";
import type {
  BusinessProfile,
  BusinessProfileData,
  BusinessProfileLink,
} from "@/lib/business-profiles/types";

/* ───────── Icons (lucide-style) ───────── */
type IconProps = { size?: number; className?: string; stroke?: number };
const Icon = ({
  children,
  size = 18,
  className = "",
  stroke = 2,
}: IconProps & { children: React.ReactNode }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
);
const Check = (p: IconProps) => <Icon {...p}><polyline points="20 6 9 17 4 12" /></Icon>;
const ChevronDown = (p: IconProps) => <Icon {...p}><polyline points="6 9 12 15 18 9" /></Icon>;
const Plus = (p: IconProps) => <Icon {...p}><path d="M5 12h14" /><path d="M12 5v14" /></Icon>;
const Store = (p: IconProps) => <Icon {...p}><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" /><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" /><path d="M2 7h20" /></Icon>;
const Sun = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></Icon>;
const Moon = (p: IconProps) => <Icon {...p}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></Icon>;
const Upload = (p: IconProps) => <Icon {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" /></Icon>;
const Phone = (p: IconProps) => <Icon {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></Icon>;
const Mail = (p: IconProps) => <Icon {...p}><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></Icon>;
const MapPin = (p: IconProps) => <Icon {...p}><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" /></Icon>;
const Whats = (p: IconProps) => <Icon {...p}><path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21" /><path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1" /></Icon>;
const Insta = (p: IconProps) => <Icon {...p}><rect width="20" height="20" x="2" y="2" rx="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" x2="17.51" y1="6.5" y2="6.5" /></Icon>;
const Facebook = (p: IconProps) => <Icon {...p}><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></Icon>;
const Tiktok = (p: IconProps) => <Icon {...p}><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" /></Icon>;
const Globe = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></Icon>;
const Link2 = (p: IconProps) => <Icon {...p}><path d="M9 17H7A5 5 0 0 1 7 7h2" /><path d="M15 7h2a5 5 0 1 1 0 10h-2" /><line x1="8" x2="16" y1="12" y2="12" /></Icon>;
const Youtube = (p: IconProps) => <Icon {...p}><path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" /><path d="m10 15 5-3-5-3z" /></Icon>;
const Trash = (p: IconProps) => <Icon {...p}><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></Icon>;
const Camera = (p: IconProps) => <Icon {...p}><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></Icon>;
const Pencil = (p: IconProps) => <Icon {...p}><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /></Icon>;
const Sparkles = (p: IconProps) => <Icon {...p}><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" /></Icon>;
const Star = (p: IconProps) => <Icon {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></Icon>;
const ArrowRight = (p: IconProps) => <Icon {...p}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></Icon>;
const Loader = (p: IconProps) => <Icon {...p}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></Icon>;

/* ───────── Link presets (trimmed for the non-tech persona) ───────── */
const TIPOS_ENLACE: Record<
  string,
  { label: string; icon: (p: IconProps) => React.ReactElement; placeholder: string }
> = {
  website: { label: "Sitio web", icon: Globe, placeholder: "tunegocio.mx" },
  menu: { label: "Menú / Linktree", icon: Link2, placeholder: "linktr.ee/tunegocio" },
  youtube: { label: "YouTube", icon: Youtube, placeholder: "youtube.com/@tunegocio" },
  tiktok: { label: "TikTok", icon: Tiktok, placeholder: "@tunegocio" },
  otro: { label: "Otro enlace", icon: Link2, placeholder: "pega-tu-link.com" },
};
const ORDEN_TIPOS = ["website", "menu", "youtube", "tiktok", "otro"];
const COLORES = ["#FF5A36", "#C2410C", "#DB2777", "#2563EB", "#0F766E", "#7C3AED", "#CA8A04", "#1A1A1A"];

/* ───────── Local profile model ───────── */
interface LocalProfile {
  id: string;
  name: string;
  isDefault: boolean;
  data: BusinessProfileData;
  isNew?: boolean;
}

function emptyData(): BusinessProfileData {
  return {
    business_name: null, industry: null, tagline_es: null, tagline_en: null,
    pitch: null, hero_keyword: null, features: [], pricing: [], testimonials: [],
    cta_primary: null, cta_secondary: null, faq_questions: [], language_detected: null,
    contact: {
      whatsapp: null, phone: null, email: null, address: null,
      socials: { instagram: null, facebook: null, tiktok: null, website: null },
    },
    brand: { logoUrl: null, accent: null },
    photos: [],
    links: [],
  };
}

// Ensure contact/socials/brand/arrays exist so the form binds safely.
function hydrate(d: BusinessProfileData): BusinessProfileData {
  const e = emptyData();
  return {
    ...e,
    ...d,
    contact: {
      ...e.contact!,
      ...(d.contact ?? {}),
      socials: { ...e.contact!.socials!, ...(d.contact?.socials ?? {}) },
    },
    brand: { ...e.brand!, ...(d.brand ?? {}) },
    photos: d.photos ?? [],
    links: d.links ?? [],
  };
}

function fromServer(p: BusinessProfile): LocalProfile {
  return { id: p.id, name: p.name, isDefault: p.isDefault, data: hydrate(p.data) };
}

function blankProfile(): LocalProfile {
  return {
    id: "new-" + Math.random().toString(36).slice(2, 8),
    name: "",
    isDefault: false,
    data: emptyData(),
    isNew: true,
  };
}

const inicialDe = (name: string) => (name.trim()[0] || "N").toUpperCase();
const heroBg = (p: LocalProfile, color: string) =>
  p.data.photos && p.data.photos[0]
    ? `url(${p.data.photos[0]}) center/cover`
    : `linear-gradient(135deg, ${color}, ${color}55)`;

async function uploadAsset(file: File): Promise<string | null> {
  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch("/api/profiles/assets", { method: "POST", body: form });
    const j = (await res.json().catch(() => ({}))) as { url?: string };
    return res.ok && typeof j.url === "string" ? j.url : null;
  } catch {
    return null;
  }
}

async function accentFromImage(file: File): Promise<string | null> {
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => (typeof r.result === "string" ? resolve(r.result) : reject(new Error()));
      r.onerror = () => reject(new Error());
      r.readAsDataURL(file);
    });
    const mod = await import("node-vibrant/browser");
    const Vibrant = mod.Vibrant as unknown as {
      from(src: string): { getPalette(): Promise<Record<string, { hex?: string } | null>> };
    };
    const palette = await Vibrant.from(dataUrl).getPalette();
    for (const k of ["Vibrant", "DarkVibrant", "LightVibrant", "Muted"]) {
      const hex = palette[k]?.hex;
      if (typeof hex === "string") return hex;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/* ───────── UI primitives ───────── */
const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <section className={`rounded-2xl bg-white dark:bg-[#1A1A1D] ring-1 ring-[#E5E3E1] dark:ring-white/10 shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${className}`}>
    {children}
  </section>
);
const SectionHead = ({ icon: I, title, hint }: { icon: (p: IconProps) => React.ReactElement; title: string; hint: string }) => (
  <div className="flex items-start gap-3 mb-5">
    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FAFAF9] dark:bg-white/5 ring-1 ring-[#E5E3E1] dark:ring-white/10 text-[#1A1A1A] dark:text-[#F4F4F3]">
      <I size={17} />
    </span>
    <div className="min-w-0">
      <h2 className="text-[15px] font-semibold tracking-tight leading-tight">{title}</h2>
      <p className="text-[12.5px] text-[#8A8784] dark:text-[#9B9897] mt-0.5 leading-snug">{hint}</p>
    </div>
  </div>
);
const Label = ({ children }: { children: React.ReactNode }) => (
  <label className="block text-[11.5px] font-semibold uppercase tracking-wide text-[#8A8784] dark:text-[#9B9897] mb-1.5">{children}</label>
);
const Field = ({ icon: I, value, onChange, placeholder }: { icon?: (p: IconProps) => React.ReactElement; value: string; onChange: (v: string) => void; placeholder?: string }) => (
  <div className="flex items-center gap-2.5 rounded-lg bg-white dark:bg-[#121214] ring-1 ring-[#E5E3E1] dark:ring-white/10 focus-within:ring-2 focus-within:ring-coral-500 transition px-3 h-11">
    {I && <I size={16} className="shrink-0 text-[#A8A5A2] dark:text-[#7C7977]" />}
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="w-full bg-transparent text-[14px] text-[#1A1A1A] dark:text-[#F4F4F3] placeholder:text-[#C0BDBA] dark:placeholder:text-[#5C5957] focus:outline-none" />
  </div>
);

/* ───────── Page ───────── */
export default function BusinessPage() {
  const [dark, toggleDark] = useDarkMode();
  const router = useRouter();
  const locale = useLocale();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<LocalProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busyAsset, setBusyAsset] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/profiles");
      if (res.status === 401) {
        router.push(`/${locale}/login`);
        return;
      }
      const j = (await res.json().catch(() => ({}))) as { profiles?: BusinessProfile[] };
      const list = (j.profiles ?? []).map(fromServer);
      setData(list);
      setActiveId((cur) => cur ?? list.find((p) => p.isDefault)?.id ?? list[0]?.id ?? null);
    } catch {
      /* leave empty */
    } finally {
      setLoading(false);
    }
  }, [router, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = data.find((p) => p.id === activeId) ?? null;

  const updateActive = useCallback(
    (fn: (p: LocalProfile) => LocalProfile) => {
      setData((d) => d.map((p) => (p.id === activeId ? fn(p) : p)));
    },
    [activeId],
  );
  const setName = (v: string) => updateActive((p) => ({ ...p, name: v }));
  const setField = (k: "industry", v: string) =>
    updateActive((p) => ({ ...p, data: { ...p.data, [k]: v || null } }));
  const setColor = (v: string) =>
    updateActive((p) => ({ ...p, data: { ...p.data, brand: { ...p.data.brand!, accent: v } } }));
  const setContact = (k: "whatsapp" | "phone" | "email" | "address", v: string) =>
    updateActive((p) => ({ ...p, data: { ...p.data, contact: { ...p.data.contact!, [k]: v || null } } }));
  const setSocial = (k: "instagram" | "facebook" | "tiktok", v: string) =>
    updateActive((p) => ({ ...p, data: { ...p.data, contact: { ...p.data.contact!, socials: { ...p.data.contact!.socials!, [k]: v || null } } } }));

  const onLogo = async (file: File) => {
    setBusyAsset(true);
    try {
      const [url, accent] = await Promise.all([uploadAsset(file), accentFromImage(file)]);
      updateActive((p) => ({
        ...p,
        data: { ...p.data, brand: { logoUrl: url ?? p.data.brand?.logoUrl ?? null, accent: accent ?? p.data.brand?.accent ?? null } },
      }));
    } finally {
      setBusyAsset(false);
    }
  };
  const onPhotos = async (files: File[]) => {
    setBusyAsset(true);
    try {
      for (const f of files.slice(0, 8)) {
        const url = await uploadAsset(f);
        if (url) updateActive((p) => ({ ...p, data: { ...p.data, photos: [...(p.data.photos ?? []), url] } }));
      }
    } finally {
      setBusyAsset(false);
    }
  };
  const delFoto = (i: number) =>
    updateActive((p) => ({ ...p, data: { ...p.data, photos: (p.data.photos ?? []).filter((_, j) => j !== i) } }));

  const addEnlace = (type: string) =>
    updateActive((p) => ({ ...p, data: { ...p.data, links: [...(p.data.links ?? []), { type, url: "" }] } }));
  const patchEnlace = (i: number, url: string) =>
    updateActive((p) => ({ ...p, data: { ...p.data, links: (p.data.links ?? []).map((e, j) => (j === i ? { ...e, url } : e)) } }));
  const delEnlace = (i: number) =>
    updateActive((p) => ({ ...p, data: { ...p.data, links: (p.data.links ?? []).filter((_, j) => j !== i) } }));

  const nuevo = (seed?: BusinessProfileData) => {
    const fresh = blankProfile();
    if (seed) fresh.data = hydrate(seed);
    setData((d) => [...d, fresh]);
    setActiveId(fresh.id);
  };

  const save = async () => {
    if (!active) return;
    setSaving(true);
    const name = active.name.trim() || "Mi negocio";
    const payload = { name, data: { ...active.data, business_name: name } };
    try {
      if (active.isNew) {
        const res = await fetch("/api/profiles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        const j = (await res.json().catch(() => ({}))) as { profile?: BusinessProfile };
        if (j.profile) {
          const real = fromServer(j.profile);
          setData((d) => d.map((p) => (p.id === active.id ? real : p)).map((p) => (real.isDefault && p.id !== real.id ? { ...p, isDefault: false } : p)));
          setActiveId(real.id);
        }
      } else {
        await fetch(`/api/profiles/${active.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        updateActive((p) => ({ ...p, name, data: { ...p.data, business_name: name } }));
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } finally {
      setSaving(false);
    }
  };

  const makeDefault = async () => {
    if (!active || active.isNew) return;
    await fetch(`/api/profiles/${active.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ setDefault: true }) });
    setData((d) => d.map((p) => ({ ...p, isDefault: p.id === active.id })));
  };
  const remove = async () => {
    if (!active) return;
    if (!active.isNew) {
      if (!window.confirm(`¿Eliminar "${active.name || "este negocio"}"?`)) return;
      await fetch(`/api/profiles/${active.id}`, { method: "DELETE" });
    }
    setData((d) => {
      const next = d.filter((p) => p.id !== active.id);
      setActiveId(next.find((p) => p.isDefault)?.id ?? next[0]?.id ?? null);
      return next;
    });
  };

  const doImport = async (file: File) => {
    setImporting(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => (typeof r.result === "string" ? resolve(r.result) : reject(new Error()));
        r.onerror = () => reject(new Error());
        r.readAsDataURL(file);
      });
      const res = await fetch("/api/profiles/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "image", image: dataUrl, imageMime: file.type === "image/png" ? "image/png" : "image/jpeg" }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: BusinessProfileData };
      const accent = await accentFromImage(file);
      const seed = j.ok && j.data ? j.data : emptyData();
      if (accent) seed.brand = { logoUrl: null, accent };
      nuevo(seed);
    } finally {
      setImporting(false);
    }
  };

  const hasNone = !loading && data.length === 0;

  return (
    <div className="min-h-screen bg-[#FAFAF9] text-[#1A1A1A] dark:bg-[#0E0E10] dark:text-[#F4F4F3] antialiased">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-[#EEECEA] dark:border-white/8 bg-[#FAFAF9]/85 dark:bg-[#0E0E10]/85 backdrop-blur">
        <div className="max-w-6xl mx-auto px-5 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Link href={`/${locale}/new`} className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-coral-500 text-white font-bold text-[14px] shrink-0">O</Link>
            <span className="font-semibold tracking-tight text-[15px] hidden sm:inline">OpenLen</span>
            <span className="h-5 w-px bg-[#E5E3E1] dark:bg-white/10 mx-1 hidden sm:block" />
            <span className="text-[15px] font-semibold text-[#6B6967] dark:text-[#9B9897]">Mi negocio</span>
          </div>
          <button onClick={toggleDark} aria-label="Cambiar tema"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#6B6967] dark:text-[#9B9897] hover:bg-white dark:hover:bg-white/5 ring-1 ring-transparent hover:ring-[#E5E3E1] dark:hover:ring-white/10 transition">
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      {loading ? (
        <div className="max-w-6xl mx-auto px-5 py-20 text-center text-[13px] text-[#8A8784]">Cargando…</div>
      ) : hasNone ? (
        <EmptyState importing={importing} onPickFile={() => importRef.current?.click()} onManual={() => nuevo()} />
      ) : active ? (
        <main className="max-w-6xl mx-auto px-5 sm:px-6 py-7 sm:py-9">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-7">
            <div>
              <h1 className="text-[26px] sm:text-[30px] font-bold tracking-tight leading-tight">Mi negocio</h1>
              <p className="text-[13.5px] text-[#8A8784] dark:text-[#9B9897] mt-1">Llénalo una vez. Cada página nueva ya nace con tu info.</p>
            </div>
            <div className="flex items-center gap-2.5">
              <Switcher profiles={data} active={active} onPick={setActiveId} onNew={() => nuevo()} />
              <button onClick={() => void save()} disabled={saving}
                className="inline-flex items-center gap-2 h-11 px-4 rounded-xl bg-coral-600 text-white text-[14px] font-semibold shadow-[0_8px_22px_-8px_rgba(255,90,54,0.55)] hover:bg-coral-700 active:scale-[0.98] transition shrink-0 disabled:opacity-60">
                {saving ? <Loader size={16} className="animate-spin" /> : <Check size={16} />} Guardar
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
            <div className="space-y-5">
              {/* Identidad */}
              <Card className="p-6">
                <SectionHead icon={Store} title="Identidad" hint="Lo básico que verá la gente en todas tus páginas." />
                <div className="space-y-4">
                  <div><Label>Nombre del negocio</Label><Field value={active.name} onChange={setName} placeholder="Ej. Café Luna" /></div>
                  <div>
                    <Label>¿Qué haces?</Label>
                    <Field value={active.data.industry ?? ""} onChange={(v) => setField("industry", v)} placeholder="Café de especialidad y pan recién horneado." />
                    <p className="mt-1.5 text-[12px] text-[#A8A5A2] dark:text-[#7C7977]">Una sola línea, como se lo dirías a un cliente nuevo.</p>
                  </div>
                </div>
              </Card>

              {/* Marca */}
              <Card className="p-6">
                <SectionHead icon={Sparkles} title="Marca" hint="Tu logo, tu color y tus fotos. Esto le da personalidad a cada página." />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                  <div>
                    <Label>Logo</Label>
                    <div className="flex items-center gap-3">
                      {active.data.brand?.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={active.data.brand.logoUrl} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-contain ring-1 ring-[#E5E3E1] dark:ring-white/10 bg-white" />
                      ) : (
                        <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl text-white text-[26px] font-bold shrink-0" style={{ background: active.data.brand?.accent ?? "#FF5A36" }}>{inicialDe(active.name)}</span>
                      )}
                      <button onClick={() => logoRef.current?.click()} disabled={busyAsset}
                        className="flex-1 inline-flex items-center justify-center gap-2 h-16 rounded-xl border border-dashed border-[#D6D3D0] dark:border-white/15 text-[#8A8784] dark:text-[#9B9897] hover:border-coral-400 hover:text-coral-600 dark:hover:text-coral-300 transition text-[13px] font-medium disabled:opacity-60">
                        <Upload size={16} /> Subir logo
                      </button>
                      <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onLogo(f); }} />
                    </div>
                  </div>
                  <div>
                    <Label>Color de marca</Label>
                    <div className="flex items-center gap-2.5">
                      <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(active.data.brand?.accent ?? "") ? active.data.brand!.accent! : "#FF5A36"}
                        onChange={(e) => setColor(e.target.value)} aria-label="Color de marca"
                        className="h-11 w-11 rounded-xl ring-1 ring-black/10 dark:ring-white/15 shrink-0 cursor-pointer bg-transparent" />
                      <div className="flex-1 flex items-center gap-2 rounded-lg bg-white dark:bg-[#121214] ring-1 ring-[#E5E3E1] dark:ring-white/10 px-3 h-11">
                        <span className="text-[14px] font-mono uppercase">{active.data.brand?.accent ?? "—"}</span>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                      {COLORES.map((c) => (
                        <button key={c} onClick={() => setColor(c)}
                          className={`h-6 w-6 rounded-md ring-2 transition ${(active.data.brand?.accent ?? "").toLowerCase() === c.toLowerCase() ? "ring-coral-500 scale-110" : "ring-transparent hover:scale-110"}`}
                          style={{ background: c }} aria-label={c} />
                      ))}
                    </div>
                    <p className="mt-2 text-[12px] text-[#A8A5A2] dark:text-[#7C7977] leading-snug">Lo tomamos de tu logo automáticamente. Puedes cambiarlo cuando quieras.</p>
                  </div>
                </div>
                <div>
                  <Label>Fotos del negocio</Label>
                  <div className="grid grid-cols-4 sm:grid-cols-5 gap-2.5">
                    {(active.data.photos ?? []).map((f, i) => (
                      <div key={`${f}-${i}`} className="group relative aspect-square rounded-xl overflow-hidden ring-1 ring-[#E5E3E1] dark:ring-white/10">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={f} alt="" className="h-full w-full object-cover" />
                        <button onClick={() => delFoto(i)} aria-label="Eliminar foto"
                          className="absolute top-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-lg bg-black/55 backdrop-blur text-white opacity-0 group-hover:opacity-100 transition hover:bg-black/75">
                          <Trash size={12} />
                        </button>
                      </div>
                    ))}
                    <button onClick={() => photosRef.current?.click()} disabled={busyAsset}
                      className="aspect-square rounded-xl border border-dashed border-[#D6D3D0] dark:border-white/15 flex flex-col items-center justify-center gap-1 text-[#A8A5A2] dark:text-[#7C7977] hover:border-coral-400 hover:text-coral-600 dark:hover:text-coral-300 transition disabled:opacity-60">
                      <Plus size={18} /><span className="text-[10.5px] font-medium">Agregar</span>
                    </button>
                    <input ref={photosRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden"
                      onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) void onPhotos(fs); }} />
                  </div>
                </div>
              </Card>

              {/* Contacto */}
              <Card className="p-6">
                <SectionHead icon={Phone} title="Contacto" hint="Cómo te encuentran y te escriben tus clientes." />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><Label>WhatsApp</Label><Field icon={Whats} value={active.data.contact?.whatsapp ?? ""} onChange={(v) => setContact("whatsapp", v)} placeholder="55 1234 5678" /></div>
                  <div><Label>Teléfono</Label><Field icon={Phone} value={active.data.contact?.phone ?? ""} onChange={(v) => setContact("phone", v)} placeholder="55 8765 4321" /></div>
                  <div><Label>Email</Label><Field icon={Mail} value={active.data.contact?.email ?? ""} onChange={(v) => setContact("email", v)} placeholder="hola@tunegocio.mx" /></div>
                  <div><Label>Instagram</Label><Field icon={Insta} value={active.data.contact?.socials?.instagram ?? ""} onChange={(v) => setSocial("instagram", v)} placeholder="@tunegocio" /></div>
                  <div className="sm:col-span-2"><Label>Dirección</Label><Field icon={MapPin} value={active.data.contact?.address ?? ""} onChange={(v) => setContact("address", v)} placeholder="Calle, número, colonia, ciudad" /></div>
                  <div><Label>Facebook</Label><Field icon={Facebook} value={active.data.contact?.socials?.facebook ?? ""} onChange={(v) => setSocial("facebook", v)} placeholder="Tu página" /></div>
                  <div><Label>TikTok</Label><Field icon={Tiktok} value={active.data.contact?.socials?.tiktok ?? ""} onChange={(v) => setSocial("tiktok", v)} placeholder="@tunegocio" /></div>
                </div>
              </Card>

              {/* Más enlaces */}
              <Card className="p-6">
                <SectionHead icon={Link2} title="Más enlaces" hint="Tu sitio actual, un Linktree, YouTube… lo que quieras compartir." />
                <div className="space-y-2.5">
                  {(active.data.links ?? []).map((e, i) => {
                    const cfg = TIPOS_ENLACE[e.type] ?? TIPOS_ENLACE.otro;
                    const I = cfg.icon;
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <div className="flex items-center gap-2.5 flex-1 rounded-lg bg-white dark:bg-[#121214] ring-1 ring-[#E5E3E1] dark:ring-white/10 focus-within:ring-2 focus-within:ring-coral-500 transition px-3 h-11">
                          <I size={16} className="shrink-0 text-[#A8A5A2] dark:text-[#7C7977]" />
                          <span className="text-[12px] font-medium text-[#8A8784] dark:text-[#9B9897] shrink-0 hidden sm:inline">{cfg.label}</span>
                          <span className="h-4 w-px bg-[#E5E3E1] dark:bg-white/10 shrink-0 hidden sm:block" />
                          <input value={e.url} onChange={(ev) => patchEnlace(i, ev.target.value)} placeholder={cfg.placeholder}
                            className="w-full bg-transparent text-[14px] text-[#1A1A1A] dark:text-[#F4F4F3] placeholder:text-[#C0BDBA] dark:placeholder:text-[#5C5957] focus:outline-none" />
                        </div>
                        <button onClick={() => delEnlace(i)} aria-label="Quitar enlace"
                          className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[#A8A5A2] dark:text-[#7C7977] hover:text-coral-600 hover:bg-coral-50 dark:hover:bg-coral-500/10 transition shrink-0">
                          <Trash size={15} />
                        </button>
                      </div>
                    );
                  })}
                  {(active.data.links ?? []).length === 0 && (
                    <p className="text-[13px] text-[#A8A5A2] dark:text-[#7C7977] py-1">Aún no agregas enlaces. Elige uno abajo 👇</p>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {ORDEN_TIPOS.map((t) => {
                    const cfg = TIPOS_ENLACE[t];
                    const I = cfg.icon;
                    return (
                      <button key={t} onClick={() => addEnlace(t)}
                        className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg ring-1 ring-[#E5E3E1] dark:ring-white/10 bg-[#FAFAF9] dark:bg-white/5 text-[12.5px] font-medium text-[#6B6967] dark:text-[#9B9897] hover:ring-coral-300 dark:hover:ring-coral-500/40 hover:text-coral-700 dark:hover:text-coral-300 transition">
                        <Plus size={12} /> <I size={13} /> {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </Card>

              {/* Danger / default row */}
              <div className="flex items-center justify-between px-1">
                <button onClick={() => void makeDefault()} disabled={active.isDefault || active.isNew}
                  className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#6B6967] dark:text-[#9B9897] hover:text-coral-700 dark:hover:text-coral-300 transition disabled:opacity-40">
                  <Star size={13} /> {active.isDefault ? "Es tu negocio principal" : "Hacer principal"}
                </button>
                <button onClick={() => void remove()}
                  className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#A8A5A2] hover:text-red-600 transition">
                  <Trash size={13} /> Eliminar negocio
                </button>
              </div>
            </div>

            {/* Sticky preview */}
            <div className="lg:sticky lg:top-[88px] lg:self-start space-y-3">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-coral-700 dark:text-coral-300">
                <span className="relative flex h-1.5 w-1.5"><span className="absolute inset-0 rounded-full bg-coral-500 opacity-70 animate-ping" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-coral-500" /></span>
                Así se ve en tus páginas
              </span>
              <PreviewHero p={active} />
              <p className="text-[12px] text-[#A8A5A2] dark:text-[#7C7977] leading-snug px-1">Cada página que crees usa esta info y tu color de marca. Cambia algo aquí y se actualiza en todas.</p>
            </div>
          </div>
        </main>
      ) : null}

      <input ref={importRef} type="file" accept="image/png,image/jpeg" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); }} />

      {saved && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-2.5 rounded-full bg-[#1A1A1A] dark:bg-white text-white dark:text-[#1A1A1A] pl-3 pr-4 py-2.5 shadow-xl">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white"><Check size={12} stroke={3} /></span>
            <span className="text-[13.5px] font-medium">Guardado. Tus páginas ya usan esta info.</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── Business switcher ───────── */
function Switcher({ profiles, active, onPick, onNew }: { profiles: LocalProfile[]; active: LocalProfile; onPick: (id: string) => void; onNew: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 h-11 pl-1.5 pr-3 rounded-xl bg-white dark:bg-[#1A1A1D] ring-1 ring-[#E5E3E1] dark:ring-white/10 hover:ring-[#D6D3D0] dark:hover:ring-white/20 transition">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white text-[14px] font-bold shrink-0" style={{ background: active.data.brand?.accent ?? "#FF5A36" }}>{inicialDe(active.name)}</span>
        <span className="min-w-0 text-left">
          <span className="block text-[13.5px] font-semibold leading-tight truncate max-w-[160px]">{active.name.trim() || "Negocio nuevo"}</span>
          <span className="block text-[11px] text-[#8A8784] dark:text-[#9B9897] leading-tight">Cambiar negocio</span>
        </span>
        <ChevronDown size={15} className="text-[#A8A5A2] ml-1 shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 sm:left-0 mt-2 w-[300px] rounded-2xl bg-white dark:bg-[#1A1A1D] ring-1 ring-[#E5E3E1] dark:ring-white/10 shadow-xl p-1.5 z-30">
          <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#8A8784]">Tus negocios</div>
          {profiles.map((n) => (
            <button key={n.id} onClick={() => { onPick(n.id); setOpen(false); }}
              className={`flex items-center gap-2.5 w-full text-left px-2 py-2 rounded-xl transition ${n.id === active.id ? "bg-[#FAFAF9] dark:bg-white/5" : "hover:bg-[#FAFAF9] dark:hover:bg-white/5"}`}>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-white text-[14px] font-bold shrink-0" style={{ background: n.data.brand?.accent ?? "#FF5A36" }}>{inicialDe(n.name)}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-[13.5px] font-semibold truncate">{n.name.trim() || "Negocio nuevo"}</span>
                  {n.isDefault && <span className="inline-flex items-center gap-1 rounded-full bg-coral-50 dark:bg-coral-500/15 text-coral-700 dark:text-coral-300 px-1.5 py-0.5 text-[10px] font-semibold"><Star size={9} /> Principal</span>}
                  {n.isNew && <span className="inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 text-[10px] font-semibold">Nuevo</span>}
                </span>
                <span className="block text-[11.5px] text-[#8A8784] dark:text-[#9B9897] truncate">{(n.data.industry ?? "").trim() || "Sin descripción todavía"}</span>
              </span>
              {n.id === active.id && <Check size={15} className="text-coral-600 shrink-0" />}
            </button>
          ))}
          <div className="my-1 border-t border-[#EEECEA] dark:border-white/8" />
          <button onClick={() => { onNew(); setOpen(false); }}
            className="flex items-center gap-2.5 w-full text-left px-2.5 py-2 rounded-xl text-[13.5px] font-medium text-coral-700 dark:text-coral-300 hover:bg-coral-50 dark:hover:bg-coral-500/10 transition">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-dashed ring-coral-300 dark:ring-coral-500/40 shrink-0"><Plus size={16} /></span>
            Nuevo negocio
          </button>
        </div>
      )}
    </div>
  );
}

/* ───────── Mini live preview ───────── */
function PreviewHero({ p }: { p: LocalProfile }) {
  const nombre = p.name.trim() || "Tu negocio";
  const tagline = (p.data.industry ?? "").trim() || "Aquí va una línea de lo que haces.";
  const color = p.data.brand?.accent ?? "#FF5A36";
  return (
    <div className="rounded-xl overflow-hidden ring-1 ring-[#E5E3E1] dark:ring-white/10 bg-white dark:bg-[#0E0E10]">
      <div className="flex items-center gap-1.5 px-3 h-7 bg-[#FAFAF9] dark:bg-white/5 border-b border-[#EEECEA] dark:border-white/8">
        <span className="h-2 w-2 rounded-full bg-[#E5E3E1] dark:bg-white/15" /><span className="h-2 w-2 rounded-full bg-[#E5E3E1] dark:bg-white/15" /><span className="h-2 w-2 rounded-full bg-[#E5E3E1] dark:bg-white/15" />
        <span className="ml-2 flex-1 h-3.5 rounded bg-white dark:bg-[#1A1A1D] ring-1 ring-[#E5E3E1] dark:ring-white/10 flex items-center px-2">
          <span className="text-[8px] text-[#A8A5A2] dark:text-[#7C7977] truncate">tunegocio.openlen.com</span>
        </span>
      </div>
      <div className="relative">
        <div className="h-24 w-full" style={{ background: heroBg(p, color) }} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
        <div className="absolute top-0 inset-x-0 flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-md text-white text-[10px] font-bold ring-1 ring-white/40 overflow-hidden" style={{ background: color }}>
              {p.data.brand?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.data.brand.logoUrl} alt="" className="h-full w-full object-contain" />
              ) : inicialDe(nombre)}
            </span>
            <span className="text-[10px] font-semibold text-white drop-shadow">{nombre}</span>
          </div>
          <span className="rounded-md px-1.5 py-0.5 text-[8px] font-semibold text-white" style={{ background: color }}>Contáctanos</span>
        </div>
      </div>
      <div className="px-3.5 py-3.5">
        <div className="text-[15px] font-bold tracking-tight leading-tight">{nombre}</div>
        <div className="text-[11px] text-[#6B6967] dark:text-[#9B9897] mt-1 leading-snug">{tagline}</div>
        <div className="mt-2.5 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10.5px] font-semibold text-white" style={{ background: color }}><Whats size={11} /> Escríbenos</span>
          <span className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-[10.5px] font-medium ring-1 ring-[#E5E3E1] dark:ring-white/15 text-[#1A1A1A] dark:text-[#F4F4F3]">Ver más</span>
        </div>
      </div>
    </div>
  );
}

/* ───────── Empty state ───────── */
function EmptyState({ importing, onPickFile, onManual }: { importing: boolean; onPickFile: () => void; onManual: () => void }) {
  return (
    <div className="max-w-2xl mx-auto px-5 py-12 sm:py-20 text-center">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-coral-50 dark:bg-coral-500/15 text-coral-700 dark:text-coral-300 px-3 py-1 text-[12px] font-semibold mb-6"><Sparkles size={13} /> Empecemos por lo importante</span>
      <h1 className="text-[30px] sm:text-[38px] font-bold tracking-tight leading-[1.05]">Cuéntanos de tu negocio<br />una sola vez.</h1>
      <p className="mt-4 max-w-md mx-auto text-[15px] text-[#6B6967] dark:text-[#9B9897] leading-relaxed">Con esto, cada página que crees ya nace con tu nombre, tus fotos, tu contacto y tu color. Tú no vuelves a llenar nada.</p>
      <div className="mt-9 grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
        <button onClick={onPickFile} disabled={importing}
          className="group rounded-2xl bg-white dark:bg-[#1A1A1D] ring-1 ring-[#E5E3E1] dark:ring-white/10 hover:ring-coral-300 dark:hover:ring-coral-500/40 hover:shadow-md transition p-5 disabled:opacity-70">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-coral-50 dark:bg-coral-500/15 text-coral-600 dark:text-coral-300 mb-4">{importing ? <Loader size={20} className="animate-spin" /> : <Camera size={20} />}</span>
          <div className="text-[15px] font-semibold tracking-tight">Sube una captura de tu Instagram</div>
          <div className="text-[13px] text-[#8A8784] dark:text-[#9B9897] mt-1 leading-snug">Leemos tu nombre, fotos y bio para llenar todo solito.</div>
          <div className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold text-coral-700 dark:text-coral-300">{importing ? "Leyendo tu perfil…" : <>Subir captura <ArrowRight size={13} /></>}</div>
        </button>
        <button onClick={onManual}
          className="group rounded-2xl bg-white dark:bg-[#1A1A1D] ring-1 ring-[#E5E3E1] dark:ring-white/10 hover:ring-coral-300 dark:hover:ring-coral-500/40 hover:shadow-md transition p-5">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-coral-50 dark:bg-coral-500/15 text-coral-600 dark:text-coral-300 mb-4"><Pencil size={20} /></span>
          <div className="text-[15px] font-semibold tracking-tight">Llénalo a mano</div>
          <div className="text-[13px] text-[#8A8784] dark:text-[#9B9897] mt-1 leading-snug">Escribe tú mismo tu nombre, contacto y demás. Toma 1 minuto.</div>
          <div className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold text-coral-700 dark:text-coral-300">Empezar <ArrowRight size={13} /></div>
        </button>
      </div>
    </div>
  );
}
