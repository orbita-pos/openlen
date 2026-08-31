// EL MENÚ DE CUENTA — al pie del rail, no en la barra de arriba.
//
// Bajó aquí el 2026-08-31, y con él dos controles que estaban sueltos en la
// barra superior: el idioma y el conmutador de claro/oscuro. Los tres son lo
// mismo —AJUSTES DE LA PERSONA, no del sitio que edita— y ocupaban tres huecos
// permanentes en la fila donde vive el nombre del proyecto, los créditos y el
// botón de publicar. El idioma solo medía 100px, más que el botón de Deploy.
//
// El pie del rail estaba libre desde que el plegador se fue (mismo día): un
// avatar ahí es donde lo pone medio producto de software que hace esto —VS
// Code, Linear, Slack— y donde la gente ya lo busca.
//
// EL MENÚ SE ABRE HACIA ARRIBA Y HACIA LA DERECHA. Está anclado abajo del todo
// y pegado al borde izquierdo de la pantalla: abrirlo hacia abajo lo sacaría
// de la ventana, y hacia la izquierda no hay ventana.

"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { signOut, useSession } from "next-auth/react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ICONO_BARRA, Moon, Sun, Volume2, VolumeX } from "./icons";
import { Tooltip } from "./ui";

interface AccountMenuProps {
  dark: boolean;
  onToggleDark: () => void;
  soundVolume?: number;
  onSoundVolume?: (v: number) => void;
  onToggleSoundMute?: () => void;
}

export function AccountMenu({
  dark,
  onToggleDark,
  soundVolume = 0,
  onSoundVolume,
  onToggleSoundMute,
}: AccountMenuProps) {
  // `topbar`, NO `wsChrome`. Los textos de este menú —el tema, el sonido, la
  // cuenta— viven en `messages/*/topbar.json` desde que el menú estaba arriba,
  // y al bajarlo al pie del rail se quedaron donde estaban. Pedirlos contra
  // `wsChrome` NO FALLA: next-intl devuelve la ruta de la clave, así que el
  // menú salía con «wsChrome.account.editorSound» de etiqueta.
  const t = useTranslations("topbar");
  const locale = useLocale();
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const userName = session?.user?.name ?? "";
  const userEmail = session?.user?.email ?? "";
  const userImage = session?.user?.image ?? null;
  const avatarLetter = (
    (userName || userEmail.split("@")[0] || "?").trim().charAt(0) || "?"
  ).toUpperCase();
  // Un «Nombre A.» de una línea: un apellido largo de Google desbordaba la
  // cabecera del menú, que aquí sólo mide 224px.
  const displayName = (() => {
    const n = userName.trim();
    if (!n) return userEmail || t("account.fallbackName");
    const parts = n.split(/\s+/);
    if (parts.length === 1) return parts[0];
    return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
  })();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as Node | null;
      if (ref.current && el && !ref.current.contains(el)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative mt-auto mb-2" ref={ref}>
      <Tooltip label={displayName} side="right">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={displayName}
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#FF7E55] to-[#C72E10] text-white text-[11.5px] font-semibold ring-1 ring-white/30 hover:brightness-110 transition overflow-hidden"
        >
          {userImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={userImage}
              alt=""
              width={32}
              height={32}
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          ) : (
            avatarLetter
          )}
        </button>
      </Tooltip>

      {open && (
        <div className="absolute bottom-0 left-full ml-2 w-56 rounded-xl bg-elev border bd shadow-elev p-1 z-50 slide-down">
          <div className="px-2.5 py-2 border-b bd">
            <div className="text-[12.5px] font-medium fg truncate">
              {displayName}
            </div>
            <div className="text-[11px] fg-faint truncate">
              {userEmail || "—"}
            </div>
          </div>

          {/* EL IDIOMA, sin `compact`: aquí no compite por el ancho de una
              barra, así que dice su nombre entero en vez de quedarse en un
              globo que hay que adivinar. */}
          <div className="px-1.5 py-1.5 border-b bd">
            <LocaleSwitcher className="w-full" />
          </div>

          <button
            type="button"
            onClick={onToggleDark}
            className="flex items-center gap-2.5 w-full text-left px-2.5 py-2 border-b bd text-[12.5px] fg hover:bg-hover transition"
          >
            {dark ? (
              <Sun size={ICONO_BARRA} className="shrink-0 fg-muted" />
            ) : (
              <Moon size={ICONO_BARRA} className="shrink-0 fg-muted" />
            )}
            <span className="flex-1 min-w-0 truncate">
              {dark ? t("theme.lightMode") : t("theme.darkMode")}
            </span>
          </button>

          {/* El sonido del editor: fila en línea, no un submenú. Un popover
              dentro de otro popover es donde se pierde el ratón. */}
          {onSoundVolume && onToggleSoundMute && (
            <div
              className="flex items-center gap-2 px-2.5 py-2 border-b bd"
              data-no-sound
            >
              <button
                type="button"
                onClick={onToggleSoundMute}
                aria-label={soundVolume === 0 ? t("sound.unmute") : t("sound.mute")}
                className="shrink-0 fg-muted hover:fg transition"
              >
                {soundVolume === 0 ? (
                  <VolumeX size={ICONO_BARRA} />
                ) : (
                  <Volume2 size={ICONO_BARRA} />
                )}
              </button>
              <span className="flex-1 min-w-0 text-[12.5px] fg truncate">
                {t("account.editorSound")}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(soundVolume * 100)}
                onChange={(e) => onSoundVolume(Number(e.target.value) / 100)}
                aria-label={t("sound.volume")}
                className="w-16 h-1 shrink-0 cursor-pointer accent-[color:var(--accent)]"
              />
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void signOut({ callbackUrl: `/${locale}/login` });
            }}
            className="flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 rounded-md text-[13px] fg hover:bg-hover transition"
          >
            {t("account.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}
