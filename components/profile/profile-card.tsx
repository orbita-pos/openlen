"use client";

// UNA TARJETA DE PROYECTO EN EL PERFIL: su miniatura, su nombre y el papel de
// la persona. Si quien mira está dentro, abre el editor; si no, la publicada.
// Editando no lleva a ningún sitio: lleva la chincheta para fijar.

import { useTranslations } from "next-intl";
import { Pin, PinOff } from "lucide-react";

import { Link } from "@/i18n/navigation";
import type { ProfileProject } from "@/lib/profile/types";

export function ProfileCard({
  project,
  editing = false,
  pinned = false,
  onTogglePin,
}: {
  project: ProfileProject;
  editing?: boolean;
  pinned?: boolean;
  onTogglePin?: (id: string) => void;
}) {
  const t = useTranslations("explore.profile");
  const role = project.role === "dueno" ? t("roleOwner") : project.role === "editor" ? t("roleEditor") : t("roleViewer");
  const body = (
    <>
      <div className="aspect-[16/10] overflow-hidden rounded-xl border border-white/10 bg-[#141416]">
        {project.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={project.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover object-top transition group-hover:scale-[1.02]" />
        ) : (
          <div className="grid h-full place-items-center text-xs text-neutral-600">{t("noPreview")}</div>
        )}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-200">{project.title}</span>
        <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-neutral-400" data-role={project.role}>
          {role}
        </span>
      </div>
    </>
  );
  const target = editing ? (
    <div>{body}</div>
  ) : project.canOpen ? (
    <Link href={`/new?project=${encodeURIComponent(project.id)}`} className="block">
      {body}
    </Link>
  ) : project.deployUrl ? (
    <a href={project.deployUrl} target="_blank" rel="noopener noreferrer" className="block">
      {body}
    </a>
  ) : (
    <div>{body}</div>
  );
  return (
    <div className="group relative" data-profile-project={project.id}>
      {target}
      {editing && onTogglePin && (
        <button
          type="button"
          onClick={() => onTogglePin(project.id)}
          aria-pressed={pinned}
          aria-label={pinned ? t("unpin") : t("pin")}
          className={`absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full border backdrop-blur transition ${
            pinned ? "border-[#ff5a36]/60 bg-[#ff5a36]/20 text-[#ff7e55]" : "border-white/15 bg-black/50 text-neutral-300 hover:text-white"
          }`}
        >
          {pinned ? <PinOff size={15} /> : <Pin size={15} />}
        </button>
      )}
    </div>
  );
}
