// La pantalla principal (escena 5 del prototipo): la barra, tu página de
// verdad en vista previa y la hoja de Len. La llamada (Task 10) se abre desde
// la hoja y, pequeña, flota encima.
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import { publishedHost } from "@/lib/publish/base-host";
import { BASE } from "../config";
import { Cara } from "../cara";
import { Icono, type NombreDeIcono } from "../iconos";
import { enlaceDeVistaPrevia, leerProyecto, leerTurno, listarProyectos, SinRed as ErrorSinRed, type ProyectoAbierto, type ProyectoEnLista } from "../api/proyectos";
import { loQueDijoLen } from "../hoja";
import { SinRed } from "./sin-red";
import { Selector } from "./selector";
import { Llamada, type TarjetaGuardada } from "../llamada/llamada";
import { useDeslizar } from "../deslizar";
import { useAtras } from "../atras";

const ULTIMO = "len-proyecto";
type Tamano = "cel" | "tab" | "pc";
const ANCHO: Record<Tamano, number> = { cel: 390, tab: 820, pc: 1280 };
// Como el prototipo: el botón lleva el icono del tamaño de ahora.
const ICONO_DEL_TAMANO: Record<Tamano, NombreDeIcono> = { cel: "dvCel", tab: "dvTab", pc: "dvPc" };
// Al encoger la hoja sólo se esconde su cuerpo: eso es lo que baja (o sube al abrirla).
const cuerpoDeLaHoja = (el: HTMLElement) => el.querySelector<HTMLElement>(".lm-body")?.offsetHeight ?? 0;

export function PantallaPrincipal({ cliente, idioma, onSalir }: { cliente: ClienteDeOpenLen; idioma: string; onSalir: () => void }) {
  const t = useTranslations("movil.principal");
  const tv = useTranslations("movil.vacio");
  const [lista, setLista] = useState<ProyectoEnLista[] | null>(null);
  const [sinRed, setSinRed] = useState(false);
  const [id, setId] = useState<string | null>(() => localStorage.getItem(ULTIMO));
  const [p, setP] = useState<ProyectoAbierto | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [vistaFallo, setVistaFallo] = useState(false);
  const [tamano, setTamano] = useState<Tamano>("cel");
  const [menu, setMenu] = useState(false);
  const [selector, setSelector] = useState(false);
  const [hojaMin, setHojaMin] = useState(false);
  const [llamada, setLlamada] = useState(false);
  const [deLaLlamada, setDeLaLlamada] = useState<TarjetaGuardada[]>([]);
  useAtras(selector, () => setSelector(false));
  useAtras(menu, () => setMenu(false));
  const deslizarHoja = useDeslizar({ hacia: hojaMin ? "arriba" : "abajo", alSoltar: () => setHojaMin(!hojaMin), recorrido: cuerpoDeLaHoja });

  const cargar = useCallback(async () => {
    setSinRed(false);
    try {
      const ps = await listarProyectos(cliente);
      setLista(ps);
      const elegido = ps.find((x) => x.id === id)?.id ?? ps[0]?.id ?? null;
      setId(elegido);
    } catch (e) {
      if (e instanceof ErrorSinRed) setSinRed(true);
    }
  }, [cliente, id]);

  useEffect(() => {
    void cargar();
    // Sólo al montar: elegir otra página no recarga la lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sólo una página de TU lista: la recordada puede ya no existir (borrada,
  // otra cuenta, la muestra) y pedirla daba 404. Y lo que llegue tarde de la
  // página anterior se tira: un 404 viejo ponía «No pude cargar tu página».
  useEffect(() => {
    if (!id || !lista?.some((x) => x.id === id)) return;
    let vigente = true;
    localStorage.setItem(ULTIMO, id);
    setP(null);
    setVista(null);
    setVistaFallo(false);
    void leerProyecto(cliente, id)
      .then((x) => {
        if (vigente) setP(x);
      })
      .catch((e) => {
        if (vigente && e instanceof ErrorSinRed) setSinRed(true);
      });
    void enlaceDeVistaPrevia(cliente, BASE, id)
      .then((x) => {
        if (vigente) setVista(x);
      })
      .catch(() => {
        if (vigente) setVistaFallo(true);
      });
    return () => {
      vigente = false;
    };
  }, [cliente, id, lista]);

  const dicho = p ? loQueDijoLen(p.historial) : null;

  // Si cuelgas con Len trabajando: la hoja relee el turno hasta que termina.
  useEffect(() => {
    if (!dicho?.enCurso || !id) return;
    const reloj = setInterval(() => {
      void leerTurno(cliente, dicho.fila)
        .then((r) => {
          if (!r.turno.enCurso) void leerProyecto(cliente, id).then(setP).catch(() => {});
        })
        .catch(() => {});
    }, 4000);
    return () => clearInterval(reloj);
  }, [cliente, id, dicho?.enCurso, dicho?.fila]);

  if (sinRed) return <SinRed onReintentar={() => void cargar()} />;
  if (lista && lista.length === 0) return <p className="app-aviso">{tv("sinPaginas")}</p>;
  if (!lista || !id) return null;

  const direccion = p?.subdomain ? publishedHost(p.subdomain) : t("sinPublicar");

  return (
    <>
      <section className="lm-layer lm-app is-on" data-mode="page">
        <div className={`lm-pagehost app-con-iframe${tamano !== "cel" ? " is-dv" : ""}`}>
          {vista && !vistaFallo ? (
            <iframe
              className="app-vista"
              src={vista}
              title={p?.title ?? "Vista previa"}
              style={tamano === "cel" ? undefined : { width: ANCHO[tamano], transform: `scale(${390 / ANCHO[tamano]})`, transformOrigin: "0 0", height: `calc((100% - var(--app-barra)) * ${ANCHO[tamano] / 390})` }}
              onError={() => setVistaFallo(true)}
            />
          ) : vistaFallo ? (
            <p className="app-aviso">{t("vistaNoCarga")}</p>
          ) : null}
        </div>

        <header className="lm-bar">
          <Cara estado="reposo" className="lm-bar-face" />
          <button type="button" className="lm-bar-t" style={{ background: "none", border: 0, textAlign: "left", color: "inherit", padding: 0 }} onClick={() => setSelector(true)}>
            <b>{p?.title ?? ""}</b>
            <span>{direccion}</span>
          </button>
          <span className={`lm-chip-st${p?.publicado ? " is-live" : ""}`}>{p?.publicado ? t("publicada") : t("vistaPrevia")}</span>
          <button type="button" className={`lm-dvbtn${tamano !== "cel" ? " is-dv" : ""}`} aria-label={t("otrosTamanos")} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <Icono nombre={ICONO_DEL_TAMANO[tamano]} />
          </button>
        </header>
        <div className={`lm-dvmenu${menu ? " is-on" : ""}`} role="menu" aria-label={t("verEn")}>
          <p className="lm-dvmenu-cap">{t("verEn")}</p>
          <div>
            {(["cel", "tab", "pc"] as const).map((x) => (
              <button key={x} type="button" role="menuitemradio" aria-checked={x === tamano} onClick={() => { setTamano(x); setMenu(false); }}>
                <Icono nombre={ICONO_DEL_TAMANO[x]} />
                <span>{t(x)}</span>
                <small>{ANCHO[x]} px</small>
              </button>
            ))}
          </div>
        </div>

        {/* Tus páginas ocupan el sitio de la hoja (dentro de la capa: fuera,
            su z-index la deja debajo de la app). Como en el prototipo, una
            sola hoja que cambia de contenido. */}
        {selector ? (
          <Selector proyectos={lista} actual={id} onElegir={(x) => { setId(x); setSelector(false); }} onCerrar={() => setSelector(false)} onSalir={onSalir} />
        ) : (
          <div ref={deslizarHoja} className={`lm-sheet lm-m lm-marca is-on${hojaMin ? " is-min" : ""}`} data-kind="listo">
            <button type="button" className="lm-grab" aria-label={t("encoger")} onClick={() => setHojaMin(!hojaMin)} />
            <div className="lm-who">
              <Cara estado={dicho?.enCurso ? "pensando" : "reposo"} className="lm-who-face" />
              <div className="lm-who-t">
                <b>Len</b>
                <span className={dicho?.enCurso ? "lm-live" : undefined}>{dicho?.enCurso ? t("trabajando") : t("estado")}</span>
              </div>
            </div>
            <div className="lm-body">
              <p className="lm-msg">{dicho?.texto || t("sinMensaje")}</p>
              {deLaLlamada.map((x) => (
                <div key={x.clave}>{x.nodo}</div>
              ))}
              <div className="lm-actions">
                <button type="button" className="lm-btn lm-pri" onClick={() => setLlamada(true)}>
                  <Icono nombre="phone" />
                  <span>{t("llamar")}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {llamada && (
        <Llamada
          cliente={cliente}
          projectId={id}
          idioma={idioma}
          onTerminar={(guardadas) => {
            setLlamada(false);
            setDeLaLlamada(guardadas);
            void leerProyecto(cliente, id).then(setP).catch(() => {});
          }}
        />
      )}
    </>
  );
}
