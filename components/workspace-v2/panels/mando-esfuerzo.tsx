"use client";

// components/workspace-v2/panels/mando-esfuerzo.tsx — CUÁNTO PIENSA LEN.
//
// Vive aparte de `chat-panel.tsx` por dos razones: ese fichero ya pasa de 3.000
// líneas, y este mando tiene una regla propia que merece prueba propia — la de
// `auto`.
//
// LA FORMA ES LA DE Claude Code, y cada decisión de aquí se puede
// comprobar contra él:
//
//  - Los cinco niveles PRIMERO y `auto` AL FINAL. Allí los peldaños son
//    `var Tm = ["low","medium","high","xhigh","max"]` y `auto` se añade suelto
//    detrás (`Usage: /effort [low|medium|high|xhigh|max|ultracode|auto]`).
//    Ponerlo arriba lo haría leer como «el más bajo», y no es un peldaño: es la
//    instrucción de elegir peldaño por ti.
//  - 🔴 `auto` SE ENSEÑA RESUELTO: allí se lee `Effort level: auto
//    (currently high)`. El invariante es que el usuario nunca ignore en qué
//    nivel corre. Nuestro `auto` anterior omitía el nivel y daba 237 tokens de
//    razonamiento con un rango de 495 (medido, n=8): era justo no saberlo.
//  - Las etiquetas describen el TRABAJO, nunca los tokens. Como las suyas:
//    «Balanced approach with standard testing». Ninguna dice cuánto piensa.

import type { EsfuerzoAgente, NivelEsfuerzo } from "@/lib/agent/esfuerzo";
import { LevelBars } from "../icons";
import { useMandoDesplegable } from "../use-mando-desplegable";

export function MandoEsfuerzo({
  esfuerzo,
  niveles,
  resuelveA,
  onChange,
  abierto,
  onAbrir,
  t,
}: {
  esfuerzo: EsfuerzoAgente;
  /**
   * LOS PELDAÑOS QUE ESTE MODELO OFRECE. Los dice el SERVIDOR.
   *
   * 🔴 Aquí se pintaba la constante `NIVELES` importada, siempre los cinco, y
   * el `niveles` que ya devolvía `GET /api/agent/esfuerzo` no lo leía nadie: un
   * dato sin lector, la version callada de
   * [[la-palanca-que-no-vuelve-a-ningun-sitio]].
   *
   * Claude Code resuelve la escalera por MODELO, y eso es lo que se copia: que la diga el modelo y no una constante.
   *
   * ⚰️ Aquí decía que su reserva para uno que no conoce es
   * `["low","medium","high"]`. Es falso (comprobado el 2026-09-13): la suya es
   * permisiva. La nuestra es más estricta A PROPÓSITO — `xhigh` y `max` se ganan
   * MIDIENDO, y un modelo entra en la tabla de `esfuerzo.ts` cuando alguien le
   * ha pasado `scripts/medir-dial-esfuerzo.ts`. El porqué está allí.
   */
  niveles: readonly NivelEsfuerzo[];
  /** A qué nivel resuelve `auto` EN ESTE MODELO. Lo dice el SERVIDOR, que es
   *  quien sabe qué número usará el cable en ese turno; una copia aquí sería la
   *  segunda fuente por la que la etiqueta acaba mintiendo. */
  resuelveA: NivelEsfuerzo;
  onChange: (e: EsfuerzoAgente) => void;
  abierto: boolean;
  onAbrir: (v: boolean) => void;
  /** El traductor del panel. Se pasa en vez de llamar a `useTranslations` aquí
   *  para que este componente no dependa del proveedor de next-intl y su prueba
   *  no tenga que montar uno. */
  t: (clave: string, valores?: Record<string, string>) => string;
}) {
  const elegir = (e: EsfuerzoAgente) => {
    onChange(e);
    onAbrir(false);
  };

  // Esc, clic fuera y flechas. 🔴 ESTE MANDO YA ESTABA DESPLEGADO SIN ESTO: se
  // abría y sólo se cerraba eligiendo o volviendo a pulsar el botón. No era un
  // patrón de la casa, era un hueco de la casa — el selector de modelo de Crear
  // lo heredó al copiarle la forma, y se arreglan los dos con el mismo gancho.
  const { refContenedor, refDisparador, alPulsarTecla } = useMandoDesplegable({
    abierto,
    cerrar: () => onAbrir(false),
  });

  return (
    <div className="relative" ref={refContenedor} onKeyDown={alPulsarTecla}>
      <button
        type="button"
        ref={refDisparador}
        aria-label={t("composer.effort")}
        title={t("composer.effortTitle")}
        aria-expanded={abierto}
        aria-haspopup="menu"
        // NO SE DESHABILITA CON EL TURNO CORRIENDO: lo que se elija aquí vale
        // para el SIGUIENTE turno. El que ya salió lleva su nivel fijado desde
        // que se pulsó enviar — es el pin por turno de Claude Code, y cambiar
        // el mando a media respuesta no debe
        // reescribir con qué esfuerzo corrió lo que ya se mandó.
        onClick={() => onAbrir(!abierto)}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition ${
          abierto || esfuerzo !== "auto"
            ? "bg-[var(--accent-strong)] text-white shadow-coral"
            : "fg-faint hover:fg hover:bg-hover"
        }`}
      >
        <LevelBars size={13} />
      </button>
      {abierto && (
        <div
          role="menu"
          aria-label={t("composer.effort")}
          className="absolute bottom-full left-0 z-20 mb-1.5 w-60 overflow-hidden rounded-md bg-card ring-1 ring-[color:var(--border)] shadow-lg fade-in"
        >
          {niveles.map((n) => (
            <button
              key={n}
              type="button"
              role="menuitemradio"
              aria-checked={esfuerzo === n}
              onClick={() => elegir(n)}
              className={`flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left transition hover:bg-hover ${
                esfuerzo === n ? "bg-accent-soft" : ""
              }`}
            >
              <span className={`text-[11px] font-medium ${esfuerzo === n ? "text-accent" : ""}`}>
                {t(`composer.${n}`)}
              </span>
              <span className="text-[10px] leading-tight fg-faint">{t(`composer.${n}Desc`)}</span>
            </button>
          ))}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={esfuerzo === "auto"}
            onClick={() => elegir("auto")}
            className={`flex w-full flex-col items-start gap-0.5 border-t border-[color:var(--border)] px-2.5 py-1.5 text-left transition hover:bg-hover ${
              esfuerzo === "auto" ? "bg-accent-soft" : ""
            }`}
          >
            <span className={`text-[11px] font-medium ${esfuerzo === "auto" ? "text-accent" : ""}`}>
              {t("composer.effortAutoNow", { nivel: t(`composer.${resuelveA}`) })}
            </span>
            <span className="text-[10px] leading-tight fg-faint">
              {t("composer.effortAutoDesc")}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
