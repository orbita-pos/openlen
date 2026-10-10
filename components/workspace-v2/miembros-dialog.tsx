"use client";

/**
 * LOS MIEMBROS DEL PROYECTO (compartir el proyecto): quién trabaja en él,
 * invitar por correo como «editor» o «solo lectura», quitar, cambiar el rol y
 * el tope de Len de los miembros (paga el dueño). Un miembro ve la lista y
 * puede irse. Quién entra a qué lo decide el servidor (lib/projects/acceso.ts):
 * esto sólo pinta lo que `/api/projects/[id]/miembros` devuelve.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { CENTICREDITOS_POR_CREDITO } from "@/lib/credits-client";
import { AvatarContent } from "./avatar-content";
import { avisarMiembrosCambiaron } from "./chat/use-gente-del-chat";
import { copiar } from "./copiar";
import { ModalShell } from "./modal-shell";
import { Button } from "./ui";

type Rol = "editor" | "lector";

interface Persona {
  readonly userId: string;
  readonly email: string;
  readonly name: string | null;
  readonly avatar?: string | null;
  readonly handle?: string | null;
}

interface Miembro extends Persona {
  readonly rol: Rol;
  readonly gastoDelMes?: number;
}

interface Estado {
  readonly rol: "dueno" | Rol;
  readonly yo: string;
  readonly dueno: Persona | null;
  readonly miembros: readonly Miembro[];
  readonly invitaciones?: readonly { email: string; rol: Rol }[];
  readonly tope?: number | null;
  readonly gastoDelMes?: number;
  /** LEN POR CORREO (lib/len-email): la dirección del proyecto, a quien puede editar. */
  readonly lenEmail?: string | null;
}

const MAX_MIEMBROS = 10;
const creditos = (centi: number) => Math.round((centi / CENTICREDITOS_POR_CREDITO) * 100) / 100;

/** Una persona en la lista: su foto (o su inicial) y su nombre, que lleva a su
 *  perfil si tiene @. Lo que va detrás del nombre («tú», el gasto) va dentro. */
function PersonRow({ persona, label, children }: { persona: Persona; label: string; children?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2 fg">
      <span
        aria-hidden
        className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#FF7E55] to-[#C72E10] text-[10.5px] font-bold text-white"
      >
        <AvatarContent avatar={persona.avatar} initial={(label.trim()[0] ?? "?").toUpperCase()} />
      </span>
      <span className="min-w-0 flex-1 truncate">
        {persona.handle ? (
          <Link href={`/@${persona.handle}`} target="_blank" className="hover:underline">
            {label}
          </Link>
        ) : (
          label
        )}
        {children}
      </span>
    </span>
  );
}

export function MiembrosDialog({
  projectId,
  projectTitle,
  open,
  onClose,
  onSalir,
}: {
  projectId: string;
  projectTitle: string;
  open: boolean;
  onClose: () => void;
  /** Un miembro se fue del proyecto: ya no lo puede abrir. */
  onSalir: () => void;
}) {
  const t = useTranslations("topbar");
  const locale = useLocale();
  const [estado, setEstado] = useState<Estado | "cargando" | "error">("cargando");
  const [correo, setCorreo] = useState("");
  const [rol, setRol] = useState<Rol>("editor");
  const [aviso, setAviso] = useState<{ texto: string; mal: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [tope, setTope] = useState("");
  const [copiada, setCopiada] = useState(false);

  const url = `/api/projects/${encodeURIComponent(projectId)}/miembros`;
  const cargar = useCallback(async () => {
    const r = await fetch(url).catch(() => null);
    if (!r?.ok) return setEstado("error");
    const e = (await r.json()) as Estado;
    setEstado(e);
    setTope(e.tope == null ? "" : String(creditos(e.tope)));
  }, [url]);
  useEffect(() => {
    if (!open) return;
    setAviso(null);
    void cargar();
  }, [open, cargar]);

  const llamar = async (init: RequestInit & { query?: string }) => {
    setOcupado(true);
    try {
      const r = await fetch(url + (init.query ?? ""), { ...init, headers: { "content-type": "application/json" } }).catch(() => null);
      const j = r ? ((await r.json().catch(() => ({}))) as { error?: string }) : {};
      // El chat y el carril vuelven a leer quién hay (use-gente-del-chat).
      if (r?.ok) avisarMiembrosCambiaron();
      return { ok: Boolean(r?.ok), error: j.error };
    } finally {
      setOcupado(false);
    }
  };

  const errorDe = (error: string | undefined) =>
    error === "tu_mismo"
      ? t("miembros.errores.tuMismo")
      : error === "ya_es_miembro"
        ? t("miembros.errores.yaEsMiembro")
        : error === "limite"
          ? t("miembros.errores.limite", { max: MAX_MIEMBROS })
          : t("miembros.errores.generico");

  const invitar = async () => {
    const email = correo.trim();
    if (!email) return;
    const r = await llamar({ method: "POST", body: JSON.stringify({ email, rol, idioma: locale }) });
    if (!r.ok) return setAviso({ texto: errorDe(r.error), mal: true });
    setCorreo("");
    setAviso({ texto: t("miembros.enviada", { correo: email.toLowerCase() }), mal: false });
    void cargar();
  };
  const cambiarRol = async (userId: string, nuevo: Rol) => {
    const r = await llamar({ method: "PATCH", body: JSON.stringify({ userId, rol: nuevo }) });
    if (!r.ok) setAviso({ texto: errorDe(r.error), mal: true });
    void cargar();
  };
  const quitar = async (m: Miembro) => {
    if (!window.confirm(t("miembros.confirmarQuitar", { nombre: m.name || m.email }))) return;
    const r = await llamar({ method: "DELETE", query: `?userId=${encodeURIComponent(m.userId)}` });
    if (!r.ok) setAviso({ texto: errorDe(r.error), mal: true });
    void cargar();
  };
  const cancelar = async (email: string) => {
    await llamar({ method: "DELETE", query: `?email=${encodeURIComponent(email)}` });
    void cargar();
  };
  const salir = async (yo: string) => {
    if (!window.confirm(t("miembros.confirmarSalir", { titulo: projectTitle }))) return;
    const r = await llamar({ method: "DELETE", query: `?userId=${encodeURIComponent(yo)}` });
    if (!r.ok) return setAviso({ texto: errorDe(r.error), mal: true });
    onClose();
    onSalir();
  };
  const guardarTope = async () => {
    const limpio = tope.trim();
    const n = limpio === "" ? null : Math.round(Number(limpio) * CENTICREDITOS_POR_CREDITO);
    if (n !== null && (!Number.isFinite(n) || n < 0)) return setAviso({ texto: t("miembros.errores.generico"), mal: true });
    const r = await llamar({ method: "PATCH", body: JSON.stringify({ tope: n }) });
    setAviso(r.ok ? { texto: t("miembros.topeGuardado"), mal: false } : { texto: errorDe(r.error), mal: true });
    void cargar();
  };

  const esDueno = typeof estado === "object" && estado.rol === "dueno";
  const nombre = (p: Persona) => p.name?.trim() || p.email;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      titleId="miembros-del-proyecto"
      title={t("miembros.titulo")}
      subtitle={esDueno ? t("miembros.subtitulo") : t("miembros.subtituloMiembro")}
      size="lg"
      closeLabel={t("miembros.cerrar")}
    >
      {estado === "cargando" ? (
        <p className="px-4 sm:px-5 py-6 text-[13px] fg-muted">{t("miembros.cargando")}</p>
      ) : estado === "error" ? (
        <p className="px-4 sm:px-5 py-6 text-[13px] fg-muted">{t("miembros.errores.generico")}</p>
      ) : (
        <div className="flex flex-col gap-4 overflow-y-auto px-4 sm:px-5 pt-4 pb-5">
          {esDueno && (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void invitar();
              }}
            >
              <div className="flex flex-wrap gap-2">
                <input
                  type="email"
                  required
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  placeholder={t("miembros.correo")}
                  aria-label={t("miembros.correo")}
                  className="h-8 min-w-0 flex-1 rounded-lg border bd bg-app px-2.5 text-[13px] fg outline-none focus:border-[color:var(--accent)]"
                />
                <select
                  value={rol}
                  onChange={(e) => setRol(e.target.value as Rol)}
                  aria-label={t("miembros.rol")}
                  className="h-8 rounded-lg border bd bg-app px-2 text-[12.5px] fg"
                >
                  <option value="editor">{t("miembros.rolEditor")}</option>
                  <option value="lector">{t("miembros.rolLector")}</option>
                </select>
                <Button type="submit" size="md" disabled={ocupado || !correo.trim()}>
                  {t("miembros.invitar")}
                </Button>
              </div>
              <p className="text-[11.5px] fg-faint">{rol === "editor" ? t("miembros.rolEditorAyuda") : t("miembros.rolLectorAyuda")}</p>
            </form>
          )}

          {aviso && (
            <p role="status" className={`text-[12px] ${aviso.mal ? "text-[color:var(--danger,#e5484d)]" : "fg-muted"}`}>
              {aviso.texto}
            </p>
          )}

          <ul className="flex flex-col divide-y divide-[color:var(--border)] rounded-lg border bd" data-miembros="">
            {estado.dueno && (
              <li className="flex items-center gap-2 px-3 py-2 text-[13px]">
                <PersonRow persona={estado.dueno} label={nombre(estado.dueno)}>
                  {" "}
                  {estado.dueno.userId === estado.yo && <span className="fg-faint">{t("miembros.tu")}</span>}
                </PersonRow>
                <span className="text-[12px] fg-muted">{t("miembros.dueno")}</span>
              </li>
            )}
            {estado.miembros.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]" data-miembro={m.email}>
                <PersonRow persona={m} label={nombre(m)}>
                  {" "}
                  {m.userId === estado.yo && <span className="fg-faint">{t("miembros.tu")}</span>}
                  {esDueno && (m.gastoDelMes ?? 0) > 0 && (
                    <span className="block text-[11px] fg-faint">{t("miembros.gastoDeMiembro", { n: creditos(m.gastoDelMes ?? 0) })}</span>
                  )}
                </PersonRow>
                {esDueno ? (
                  <>
                    <select
                      value={m.rol}
                      disabled={ocupado}
                      onChange={(e) => void cambiarRol(m.userId, e.target.value as Rol)}
                      aria-label={`${t("miembros.rol")}: ${nombre(m)}`}
                      className="h-7 rounded-md border bd bg-app px-1.5 text-[12px] fg"
                    >
                      <option value="editor">{t("miembros.rolEditor")}</option>
                      <option value="lector">{t("miembros.rolLector")}</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void quitar(m)}
                      aria-label={`${t("miembros.quitar")}: ${nombre(m)}`}
                      className="grid h-7 w-7 place-items-center rounded-md fg-muted hover:bg-hover hover:fg"
                    >
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <span className="text-[12px] fg-muted">{m.rol === "editor" ? t("miembros.rolEditor") : t("miembros.rolLector")}</span>
                )}
              </li>
            ))}
            {(estado.invitaciones ?? []).map((i) => (
              <li key={i.email} className="flex items-center gap-2 px-3 py-2 text-[13px]" data-invitacion={i.email}>
                <span className="min-w-0 flex-1 truncate fg-muted">
                  {i.email}
                  <span className="block text-[11px] fg-faint">
                    {t("miembros.pendiente")} · {i.rol === "editor" ? t("miembros.rolEditor") : t("miembros.rolLector")}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void cancelar(i.email)}
                  aria-label={`${t("miembros.cancelar")}: ${i.email}`}
                  className="grid h-7 w-7 place-items-center rounded-md fg-muted hover:bg-hover hover:fg"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
            {estado.miembros.length === 0 && (estado.invitaciones ?? []).length === 0 && (
              <li className="px-3 py-3 text-[12.5px] fg-faint">{t("miembros.vacio")}</li>
            )}
          </ul>

          {esDueno && (
            <form
              className="flex flex-col gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                void guardarTope();
              }}
            >
              <label htmlFor="tope-de-miembros" className="text-[12.5px] font-medium fg">
                {t("miembros.tope")}
              </label>
              <div className="flex gap-2">
                <input
                  id="tope-de-miembros"
                  inputMode="decimal"
                  value={tope}
                  onChange={(e) => setTope(e.target.value)}
                  placeholder={t("miembros.sinTope")}
                  className="h-8 w-32 rounded-lg border bd bg-app px-2.5 text-[13px] fg outline-none focus:border-[color:var(--accent)]"
                />
                <Button type="submit" variant="outline" size="md" disabled={ocupado}>
                  {t("miembros.guardarTope")}
                </Button>
              </div>
              <p className="text-[11.5px] fg-faint">
                {t("miembros.topeAyuda")}{" "}
                {estado.tope != null
                  ? t("miembros.gastadoDe", { gastado: creditos(estado.gastoDelMes ?? 0), tope: creditos(estado.tope) })
                  : t("miembros.gastado", { gastado: creditos(estado.gastoDelMes ?? 0) })}
              </p>
            </form>
          )}

          {estado.lenEmail && (
            <div className="flex flex-col gap-1.5" data-len-email="">
              <p className="text-[12.5px] font-medium fg">{t("miembros.len.titulo")}</p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={estado.lenEmail}
                  aria-label={t("miembros.len.titulo")}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-8 min-w-0 flex-1 rounded-lg border bd bg-app px-2.5 font-mono text-[12px] fg outline-none"
                />
                <Button
                  variant="outline"
                  size="md"
                  onClick={() => {
                    void copiar(estado.lenEmail!).then((ok) => {
                      setCopiada(ok);
                      if (ok) setTimeout(() => setCopiada(false), 1500);
                    });
                  }}
                >
                  {copiada ? t("miembros.len.copiada") : t("miembros.len.copiar")}
                </Button>
              </div>
              <p className="text-[11.5px] fg-faint">{t("miembros.len.texto")}</p>
            </div>
          )}

          {!esDueno && (
            <div>
              <Button variant="outline" size="md" disabled={ocupado} onClick={() => void salir(estado.yo)}>
                {t("miembros.salir")}
              </Button>
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
}
