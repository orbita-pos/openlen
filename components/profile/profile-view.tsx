"use client";

// EL PERFIL DE UNA PERSONA en /@handle (docs/superpowers/specs/2026-10-10-profile-design.md).
// Lo que se ve lo decide el servidor (`getProfile`: cada uno ve los proyectos
// que podría abrir); esto lo pinta y, si es el tuyo, lo edita ahí mismo.

import { useRef, useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { Camera, Link2, Users, X } from "lucide-react";

import HandleDialog from "@/components/community/handle-dialog";
import { useRouter } from "@/i18n/navigation";
import { checkAvatarFile } from "@/lib/profile/avatar";
import type { ProfileData, ProfileProject } from "@/lib/profile/types";
import { MAX_BIO, MAX_LINKS, MAX_NAME, MAX_PINNED, isHttpUrl, linkLabel, normalizeLink } from "@/lib/profile/validate";

import { AvatarCropper } from "./avatar-cropper";
import { ProfileCard } from "./profile-card";

const INPUT = "mt-1 w-full rounded-lg border border-white/10 bg-[#141416] px-2.5 py-1.5 text-sm text-neutral-100 outline-none focus:border-[#ff5a36]/60";
const SMALL_BUTTON = "rounded-lg border border-white/10 px-2.5 py-1 text-xs text-neutral-300 hover:bg-white/5";

export function ProfileView({ profile }: { profile: ProfileData }) {
  const t = useTranslations("explore.profile");
  const router = useRouter();
  const { update } = useSession();
  const displayName = profile.name?.trim() || `@${profile.handle}`;
  const initial = displayName.replace("@", "").charAt(0).toUpperCase() || "?";

  const [avatar, setAvatar] = useState(profile.avatar);
  const [hasCustomAvatar, setHasCustomAvatar] = useState(profile.hasCustomAvatar);
  const [cropping, setCropping] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.name ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [links, setLinks] = useState<string[]>([...profile.links]);
  const [badLink, setBadLink] = useState<number | null>(null);
  const [pinnedIds, setPinnedIds] = useState<string[]>(profile.pinned.map((p) => p.id));
  const [pinNotice, setPinNotice] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [handleOpen, setHandleOpen] = useState(false);
  const handleSaved = useRef(false);
  const [sharedOnly, setSharedOnly] = useState(false);

  const all: ProfileProject[] = [...profile.pinned, ...profile.projects];
  // El token lleva el nombre y la foto: sin argumento `update()` no relee (lib/profile/session.ts).
  const refreshSession = () => update({ refresh: true }).catch(() => null);

  const choosePhoto = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const problem = checkAvatarFile({ type: file.type, size: file.size });
    if (problem) {
      setPhotoError(problem === "too_big" ? t("photoTooBig") : t("photoBadType"));
      return;
    }
    setPhotoError(null);
    setCropping(file);
  };

  const photoSaved = async (url: string) => {
    setCropping(null);
    setAvatar(url);
    setHasCustomAvatar(true);
    await refreshSession();
    router.refresh();
  };

  const removePhoto = async () => {
    const r = await fetch("/api/me/avatar", { method: "DELETE" }).catch(() => null);
    const j = r?.ok ? ((await r.json().catch(() => null)) as { avatar?: string | null } | null) : null;
    if (!j) {
      setPhotoError(t("photoFailed"));
      return;
    }
    setAvatar(j.avatar ?? null);
    setHasCustomAvatar(false);
    await refreshSession();
    router.refresh();
  };

  const togglePin = (id: string) => {
    if (pinnedIds.includes(id)) {
      setPinnedIds(pinnedIds.filter((x) => x !== id));
      setPinNotice(false);
      return;
    }
    if (pinnedIds.length >= MAX_PINNED) {
      setPinNotice(true);
      return;
    }
    setPinnedIds([...pinnedIds, id]);
  };

  const cancel = () => {
    setEditing(false);
    setName(profile.name ?? "");
    setBio(profile.bio ?? "");
    setLinks([...profile.links]);
    setPinnedIds(profile.pinned.map((p) => p.id));
    setBadLink(null);
    setPinNotice(false);
    setSaveError(false);
  };

  const save = async () => {
    const cleaned = links.map((l) => l.trim()).filter(Boolean);
    setLinks(cleaned);
    // La misma regla que el servidor (lib/profile/validate.ts), antes de mandar.
    const bad = cleaned.findIndex((l) => !isHttpUrl(normalizeLink(l)));
    if (bad >= 0) {
      setBadLink(bad);
      return;
    }
    setBadLink(null);
    setSaving(true);
    setSaveError(false);
    const r = await fetch("/api/me/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, bio, links: cleaned, pinnedProjectIds: pinnedIds }),
    }).catch(() => null);
    setSaving(false);
    if (!r?.ok) {
      setSaveError(true);
      return;
    }
    setEditing(false);
    await refreshSession();
    router.refresh();
  };

  const shown = sharedOnly ? all.filter((p) => p.shared) : profile.projects;
  const editList = [...all].sort((a, b) => Number(pinnedIds.includes(b.id)) - Number(pinnedIds.includes(a.id)));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5 pb-16 pt-10 sm:pt-12 lg:flex-row lg:gap-14">
      <aside className="lg:w-72 lg:shrink-0">
        <div className="lg:sticky lg:top-16">
          <div className="relative h-20 w-20">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt="" referrerPolicy="no-referrer" className="h-20 w-20 rounded-full object-cover ring-2 ring-[#ff5a36]/40" />
            ) : (
              <div className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-[#ff7e55] to-[#ff5a36] text-2xl font-semibold text-white ring-2 ring-white/10">
                {initial}
              </div>
            )}
            {profile.isSelf && (
              <label
                className="absolute inset-0 grid cursor-pointer place-items-center rounded-full bg-black/55 text-[11px] font-medium text-white opacity-0 transition focus-within:opacity-100 hover:opacity-100"
                data-change-photo=""
              >
                <span className="flex flex-col items-center gap-0.5">
                  <Camera size={16} />
                  {t("changePhoto")}
                </span>
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={choosePhoto} />
              </label>
            )}
          </div>
          {photoError && (
            <p role="alert" className="mt-2 text-xs text-red-400">
              {photoError}
            </p>
          )}

          {editing ? (
            <div className="mt-5 flex flex-col gap-3" data-profile-form="">
              <label className="text-xs text-neutral-500">
                {t("nameLabel")}
                <input value={name} maxLength={MAX_NAME} onChange={(e) => setName(e.target.value)} className={INPUT} />
              </label>
              <label className="text-xs text-neutral-500">
                {t("bioLabel")}
                <textarea value={bio} maxLength={MAX_BIO} rows={3} onChange={(e) => setBio(e.target.value)} className={`${INPUT} resize-none`} />
                <span className="mt-1 block text-right text-[11px] text-neutral-600">
                  {bio.length}/{MAX_BIO}
                </span>
              </label>
              <fieldset>
                <legend className="text-xs text-neutral-500">{t("linksLabel")}</legend>
                {links.map((l, i) => (
                  <div key={i} className="mt-1.5 flex items-center gap-1.5">
                    <input
                      value={l}
                      placeholder={t("linkPlaceholder")}
                      aria-invalid={badLink === i}
                      onChange={(e) => setLinks(links.map((x, j) => (j === i ? e.target.value : x)))}
                      className={`${INPUT} mt-0 ${badLink === i ? "border-red-500/70" : ""}`}
                    />
                    <button
                      type="button"
                      aria-label={t("removeLink")}
                      onClick={() => setLinks(links.filter((_, j) => j !== i))}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-neutral-500 hover:bg-white/5 hover:text-neutral-200"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                {badLink !== null && (
                  <p role="alert" className="mt-1.5 text-xs text-red-400">
                    {t("invalidLink")}
                  </p>
                )}
                {links.length < MAX_LINKS && (
                  <button type="button" onClick={() => setLinks([...links, ""])} className={`${SMALL_BUTTON} mt-2`}>
                    {t("addLink")}
                  </button>
                )}
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setHandleOpen(true)} className={SMALL_BUTTON}>
                  {t("changeHandle")}
                </button>
                {hasCustomAvatar && (
                  <button type="button" onClick={() => void removePhoto()} className={SMALL_BUTTON}>
                    {t("removePhoto")}
                  </button>
                )}
              </div>
              {saveError && (
                <p role="alert" className="text-xs text-red-400">
                  {t("saveFailed")}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="rounded-lg bg-[#ff5a36] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {saving ? t("saving") : t("save")}
                </button>
                <button type="button" onClick={cancel} className="rounded-lg px-3 py-1.5 text-sm text-neutral-300 hover:bg-white/5">
                  {t("cancel")}
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="mt-5 text-xl font-semibold tracking-tight text-white">{displayName}</h1>
              <p className="text-sm text-neutral-500">@{profile.handle}</p>
              {profile.bio && <p className="mt-4 max-w-prose text-sm leading-relaxed text-neutral-400">{profile.bio}</p>}
              {profile.links.length > 0 && (
                <ul className="mt-4 flex flex-col gap-1.5">
                  {profile.links.map((url) => (
                    <li key={url}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex items-center gap-1.5 text-sm text-neutral-300 hover:text-white"
                      >
                        <Link2 size={14} className="text-neutral-500" />
                        {linkLabel(url)}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {profile.sharedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setSharedOnly(!sharedOnly)}
                  aria-pressed={sharedOnly}
                  className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-[#ff5a36]/40 bg-[#ff5a36]/10 px-3 py-1 text-xs text-[#ff9b7d] hover:bg-[#ff5a36]/15"
                >
                  <Users size={13} />
                  {t("workTogether", { count: profile.sharedCount })}
                </button>
              )}
              {profile.isSelf && (
                <button type="button" onClick={() => setEditing(true)} className={`${SMALL_BUTTON} mt-5 block`}>
                  {t("editProfile")}
                </button>
              )}
            </>
          )}
        </div>
      </aside>

      <section className="min-w-0 flex-1">
        {editing ? (
          <>
            <h2 className="mb-5 text-sm font-medium text-neutral-300">{t("projects")}</h2>
            {pinNotice && (
              <p role="status" className="mb-4 text-xs text-[#ff9b7d]">
                {t("pinLimit")}
              </p>
            )}
            <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 xl:grid-cols-3">
              {editList.map((p) => (
                <ProfileCard key={p.id} project={p} editing pinned={pinnedIds.includes(p.id)} onTogglePin={togglePin} />
              ))}
            </div>
          </>
        ) : (
          <>
            {!sharedOnly && profile.pinned.length > 0 && (
              <>
                <h2 className="mb-5 text-sm font-medium text-neutral-300">{t("pinned")}</h2>
                <div className="mb-12 grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2">
                  {profile.pinned.map((p) => (
                    <ProfileCard key={p.id} project={p} />
                  ))}
                </div>
              </>
            )}
            <div className="mb-5 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-medium text-neutral-300">
                {sharedOnly ? t("workTogether", { count: profile.sharedCount }) : t("projects")}
              </h2>
              {sharedOnly && (
                <button type="button" onClick={() => setSharedOnly(false)} className="text-xs text-neutral-400 hover:text-white">
                  {t("showAll")}
                </button>
              )}
            </div>
            {shown.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 py-20 text-center text-sm text-neutral-500">{t("empty")}</div>
            ) : (
              <div className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((p) => (
                  <ProfileCard key={p.id} project={p} />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {cropping && <AvatarCropper file={cropping} onCancel={() => setCropping(null)} onSaved={(url) => void photoSaved(url)} />}
      {/* HandleDialog llama a onSaved y LUEGO a onClose: el ref evita cerrar encima de la navegación. */}
      <HandleDialog
        open={handleOpen}
        onClose={() => {
          if (!handleSaved.current) setHandleOpen(false);
        }}
        onSaved={(h) => {
          handleSaved.current = true;
          router.replace(`/@${h}`);
        }}
      />
    </div>
  );
}
