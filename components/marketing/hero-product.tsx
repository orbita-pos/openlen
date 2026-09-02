import {
  BarChart3,
  ChatIcon,
  Check,
  ChevronDown,
  Code2,
  Crosshair,
  ExternalLink,
  Eye,
  Globe,
  HistoryIcon,
  ICONO_BARRA,
  ICONO_RAIL,
  ImageIcon,
  Inbox,
  LenMark,
  Megaphone,
  Monitor,
  Pencil,
  RefreshCw,
  SendUp,
  Smartphone,
  Tablet,
  WandSparkles,
} from "@/components/workspace-v2/icons";
import { Coins, Database } from "lucide-react";

// Hero product visual — una réplica ESTÁTICA y fiel del taller real de OpenLen
// (`/new`): barra superior · rail de iconos · panel de Chat (Len) · lienzo.
// Los tokens salen de la clase `.hero-product` en app/globals.css (la misma
// paleta que app/[locale]/new/tokens.css) — claro por defecto, oscuro bajo un
// ancestro `.dark`, así que la maqueta sigue el tema del sitio de marketing.
// El CENTRO enseña una página terminada de verdad (una captura hecha por Len).
//
// LOS ICONOS SE IMPORTAN DEL TALLER, no se redibujan aquí. `icons.tsx` es un
// módulo sin estado ni "use client" —SVGs a pelo— así que un componente de
// servidor puede montarlo. Es la única forma de que un cambio de glifo allá
// llegue aquí solo; la versión anterior tiraba de lucide-react y ya había
// glifos que no eran los que el usuario ve al entrar.
//
// ── POR QUÉ SE REESCRIBIÓ (2026-09-02) ──────────────────────────────────────
// La maqueta anterior se sincronizó el 2026-07-22 y desde entonces el taller
// cambió en 124 commits. No era un desfase estético: la portada enseñaba
// controles que YA NO EXISTEN, y uno de ellos se había borrado justamente por
// mentir. Lo que se corrige, uno a uno:
//
//  1. EL RAIL TENÍA 12 ICONOS Y TIENE 5. `rail-model.ts` es la fuente: CREAR es
//     hoy un solo icono (Chat) y OPERAR cuatro (Resultados, Bandeja, Marketing,
//     Versiones). Se fueron Página/casita (2026-08-31), Sitio (a la barra de
//     dirección), Imágenes (2026-08-29, al diálogo de sustituir), Library, 3D,
//     Módulos y Mi negocio (2026-08-31, con el perfil entero).
//  2. LA CUENTA BAJÓ AL PIE DEL RAIL (2026-08-31). El idioma, el claro/oscuro y
//     el avatar ya no viven arriba a la derecha: son ajustes de la PERSONA, no
//     del sitio, y cobraban tres huecos en la fila del proyecto.
//  3. NO HAY INSPECTOR FIJO A LA DERECHA. Es un cajón FLOTANTE de 300px que sólo
//     aparece con la edición encendida (`inspectMode`, new/page.tsx:3600).
//     Pintarlo como columna permanente vendía una pantalla que nadie ve al
//     entrar. Y su sección «Motion» ni siquiera existe ya: el módulo de
//     expresión se retiró. Sin esa columna el lienzo respira, que es justo lo
//     que queremos enseñar: la página.
//  4. LA BARRA DEL LIENZO SON DOS FILAS. Arriba QUÉ se mira (la lente con su
//     nombre, la dirección en el centro, las acciones a la derecha); abajo, sólo
//     lo que ENCUADRA (dispositivo y zoom), centrado. Y murió el pie.
//  5. LA BARRA DE DIRECCIÓN no estaba. Es la respuesta a «¿dónde estoy?» en la
//     misma forma que la lee un visitante: la RUTA.
//  6. EL SELECTOR DE MODELO —la pastilla «Pro» con el puntito azul de Google—
//     SE BORRÓ DEL TALLER por nombrar un proveedor que no corría y por no
//     viajar al servidor. Seguía pintado en la portada: un repo público
//     enseñando en su home un control que se quitó por mentir.
//  7. PUBLICAR NO LLEVA ESTRELLITA. Se le quitó en el taller —publicar no lo
//     hace ninguna IA— y era el único botón de la barra que ya destaca solo.
//  8. LEN NO ES UNA ESTRELLITA. Su marca es `LenMark`: un aro grueso y una
//     pupila.
//
// Al tocar el taller, esta maqueta es lo segundo que hay que mirar. No tiene
// compilador que avise: se queda quieta y sigue vendiendo lo de antes.

// Espeja `RAIL_CREAR` / `RAIL_OPERAR` de components/workspace-v2/rail-model.ts.
const RAIL_CREAR_MOCK = [{ Icon: ChatIcon }]; // Chat (Len) — el activo
const RAIL_OPERAR_MOCK = [
  { Icon: BarChart3, badge: 0 }, // Resultados
  { Icon: Inbox, badge: 3 }, // Bandeja
  { Icon: Megaphone, badge: 0 }, // Marketing
  { Icon: HistoryIcon, badge: 0 }, // Versiones
];

// `CAPSULA` de components/workspace-v2/ui.tsx, con los tokens escritos a mano:
// las utilidades del taller (`bg-hover`, `bd`, `fg-muted`) están encerradas en
// `.workspace-v2` y aquí no aplican.
const CAPSULA =
  "inline-flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--hover)] p-0.5";
const SEG_ON =
  "bg-[var(--bg-elev)] text-[var(--fg)] shadow-[0_1px_2px_0_rgba(0,0,0,0.08)]";
const SEG_OFF = "text-[var(--fg-muted)]";

export function HeroProduct() {
  return (
    <div className="relative w-full">
      <div
        className="absolute -inset-x-8 -top-8 bottom-0 -z-10 rounded-[40px] blur-3xl opacity-50 bg-[radial-gradient(55%_45%_at_50%_25%,rgba(255,90,54,0.18),transparent_70%)]"
        aria-hidden
      />

      <div className="hero-product overflow-hidden rounded-2xl ring-1 ring-zinc-200 dark:ring-zinc-800 bg-[var(--bg)] text-[var(--fg)] shadow-[0_40px_120px_-50px_rgba(0,0,0,0.28)] dark:shadow-[0_50px_140px_-50px_rgba(0,0,0,0.6)] [font-family:Inter,system-ui,sans-serif]">
        {/* ── BARRA SUPERIOR (h-[60px], top-bar.tsx:494) ── */}
        <div className="flex items-center justify-between gap-2 sm:gap-3 h-[60px] px-2 sm:px-4 border-b border-[var(--border)] bg-[var(--bg)]">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex items-center gap-2 shrink-0">
              <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-gradient-to-br from-[#FF7E55] to-[#C72E10]">
                <span className="h-3 w-3 rounded-full bg-white/90" />
              </span>
              <span className="hidden md:inline text-[15px] font-semibold tracking-tight">
                Open
                <span className="text-[var(--accent-strong)] dark:text-[#FF8463]">
                  Len
                </span>
              </span>
            </span>
            <span className="hidden md:block h-5 w-px bg-[var(--border)]" />
            <span className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md min-w-0">
              <span className="text-[13px] text-[var(--fg-muted)] truncate hidden sm:inline">
                Margot Rey · Estudio
              </span>
              <ChevronDown
                size={ICONO_BARRA}
                className="shrink-0 text-[var(--fg-faint)]"
              />
            </span>
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="font-mono text-[var(--fg-muted)]">Guardado</span>
            </span>
          </div>

          {/* A la derecha quedan DOS cosas: Publicar y los créditos. El idioma,
              el tema y el avatar se fueron al pie del rail. */}
          <div className="flex items-center gap-1">
            <span className="inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-md bg-[var(--accent-strong)] text-white text-[12px] font-medium shadow-[0_1px_2px_0_rgba(255,90,54,0.35),0_8px_24px_-6px_rgba(255,90,54,0.5)]">
              <span className="hidden sm:inline">Publicar</span>
              <ChevronDown size={11} />
            </span>
            <span className="hidden md:inline-block h-5 w-px bg-[var(--border)] mx-1.5" />
            <span className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[12px] font-medium text-[var(--fg-muted)] tabular-nums">
              <Coins size={13} className="text-[var(--accent)]" /> 920
            </span>
          </div>
        </div>

        {/* ── CUERPO: rail · Chat (Len) · lienzo ── */}
        <div className="flex h-[520px] sm:h-[600px]">
          {/* rail de iconos — w-12, left-sidebar.tsx:361 */}
          <div className="hidden sm:flex h-full w-12 shrink-0 flex-col items-center pt-2 gap-1 border-r border-[var(--border)] bg-[var(--bg-sidebar)]">
            {RAIL_CREAR_MOCK.map(({ Icon }, i) => (
              <span
                key={`c${i}`}
                className="grid h-8 w-8 place-items-center rounded-md bg-[var(--bg-elev)] text-[var(--fg)] border border-[var(--border)] shadow-[0_1px_2px_0_rgba(0,0,0,0.3)]"
              >
                <Icon size={ICONO_RAIL} />
              </span>
            ))}
            <span className="my-1 h-px w-6 bg-black/10 dark:bg-white/10" />
            {RAIL_OPERAR_MOCK.map(({ Icon, badge }, i) => (
              <span
                key={`o${i}`}
                className="relative grid h-8 w-8 place-items-center rounded-md text-[var(--fg-muted)]"
              >
                <Icon size={ICONO_RAIL} />
                {badge > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-[#FF5A36] text-white text-[10px] font-semibold leading-4 text-center">
                    {badge}
                  </span>
                )}
              </span>
            ))}
            {/* LA CUENTA, AL PIE. `mt-auto` la pega al fondo — account-menu.tsx:94. */}
            <span className="relative mt-auto mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#FF7E55] to-[#C72E10] text-white text-[11.5px] font-semibold ring-1 ring-white/30">
              J
            </span>
          </div>

          {/* panel de Chat (Len) — w-[272px], left-sidebar.tsx:385 */}
          <div className="hidden lg:flex h-full w-[272px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)]">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border)]">
              <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--fg-faint)] font-semibold">
                Chat
              </span>
            </div>
            <div className="flex-1 min-h-0 px-3 py-3 space-y-2 overflow-hidden">
              <div className="flex gap-2 flex-row-reverse">
                <span className="shrink-0 grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold bg-gradient-to-br from-[#FF7E55] to-[#C72E10] text-white">
                  J
                </span>
                <div className="min-w-0 max-w-[80%] text-right">
                  <div className="inline-block rounded-2xl px-3 py-2 text-left bg-[var(--accent-soft)] border border-[color:#FF5A36]/30 text-[12.5px] leading-relaxed text-[#B23A1A] dark:text-[#FFB39E]">
                    Hazlo minimal y editorial, con una galería de proyectos
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center text-[var(--accent-strong)] dark:text-[#FF8463]">
                  <LenMark size={22} />
                </span>
                <div className="min-w-0 max-w-[85%] space-y-1.5">
                  {/* LAS ACCIONES DEL AGENTE, encima de lo que dice. Len trabaja
                      con herramientas y se ven — agent-action-card.tsx:102. */}
                  <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[11px]">
                    <Check size={13} className="shrink-0 text-[var(--accent)]" />
                    <span className="font-medium shrink-0">Editar página</span>
                    <span className="text-[var(--fg-faint)] truncate min-w-0">
                      3 secciones
                    </span>
                  </div>
                  <div className="inline-block rounded-2xl px-3 py-2 text-left bg-[var(--bg-elev)] border border-[var(--border)] text-[12.5px] leading-relaxed text-[var(--fg)]">
                    Listo — titulares editoriales, galería blanca con mucho aire
                    y 9 fotos en el hero.
                  </div>
                </div>
              </div>
            </div>
            {/* Composer — chat-panel.tsx:2046. Adjuntar imagen · seleccionar
                sección · Autorrelleno, y enviar. Sin selector de modelo. */}
            <div className="p-3 pt-0">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)]">
                <div className="px-3 pt-2.5 pb-1 text-[12.5px] text-[var(--fg-faint)]">
                  Pídele algo a Len…
                </div>
                <div className="flex items-center justify-between px-1.5 pb-1.5 pt-0.5">
                  <div className="flex items-center gap-0.5 min-w-0">
                    <span className="grid h-7 w-7 place-items-center rounded-md text-[var(--fg-faint)]">
                      <ImageIcon size={13} />
                    </span>
                    <span className="grid h-7 w-7 place-items-center rounded-md text-[var(--fg-faint)]">
                      <Crosshair size={13} />
                    </span>
                    <span
                      aria-hidden
                      className="h-4 w-px shrink-0 bg-[var(--border)] mx-1"
                    />
                    <span className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] font-medium text-[var(--fg-faint)]">
                      <WandSparkles size={13} />
                      <span>Autorrelleno</span>
                    </span>
                  </div>
                  <span className="grid h-7 w-7 place-items-center rounded-md bg-[var(--hover)] text-[var(--fg-faint)]">
                    <SendUp size={13} />
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* lienzo — la página terminada, a lo ancho */}
          <div className="flex-1 min-w-0 flex flex-col bg-[var(--bg-preview)]">
            {/* FILA 1 — qué se mira: lente · dirección · acciones */}
            <div className="h-10 shrink-0 px-2.5 grid grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-[var(--border)] bg-[var(--bg)]/85 backdrop-blur">
              <div className={`${CAPSULA} hidden sm:inline-flex`}>
                <span
                  className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] font-medium ${SEG_ON}`}
                >
                  <Eye size={ICONO_BARRA} />
                  <span>Vista previa</span>
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] font-medium ${SEG_OFF}`}
                >
                  <Code2 size={ICONO_BARRA} />
                  <span>Código</span>
                </span>
                {/* LA TERCERA LENTE. En el taller sólo aparece si el proyecto
                    TIENE datos (`hayDatos`, preview-area.tsx:705); aquí el
                    proyecto de la maqueta los tiene, así que se pinta. Su icono
                    sale de lucide-react igual que allí — `Database` no está en
                    el juego propio de `icons.tsx`. */}
                <span
                  className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] font-medium ${SEG_OFF}`}
                >
                  <Database size={ICONO_BARRA} />
                  <span>Datos</span>
                </span>
              </div>

              {/* LA DIRECCIÓN — address-bar.tsx:93. El host en tenue y la ruta en
                  firme: lo que el dueño cambia es la ruta, el host es contexto. */}
              <div className="min-w-0 px-2">
                <span className="w-full h-7 pl-2.5 pr-1.5 inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-elev)] text-[12px] min-w-0">
                  <Globe
                    size={ICONO_BARRA}
                    className="shrink-0 text-[var(--fg-faint)]"
                  />
                  <span className="text-[var(--fg-faint)] truncate min-w-0 hidden sm:inline">
                    margotrey.openlen.app
                  </span>
                  <span className="text-[var(--fg)] font-medium truncate min-w-0">
                    /
                  </span>
                  <ChevronDown
                    size={ICONO_BARRA}
                    className="ml-auto shrink-0 text-[var(--fg-faint)]"
                  />
                </span>
              </div>

              <div className="flex items-center gap-0.5 justify-self-end text-[var(--fg-muted)]">
                <span className="grid h-7 w-7 place-items-center rounded-md">
                  <Pencil size={ICONO_BARRA} />
                </span>
                <span className="grid h-7 w-7 place-items-center rounded-md">
                  <RefreshCw size={ICONO_BARRA} />
                </span>
                <span className="grid h-7 w-7 place-items-center rounded-md">
                  <ExternalLink size={ICONO_BARRA} />
                </span>
              </div>
            </div>

            {/* FILA 2 — sólo lo que ENCUADRA, centrado */}
            <div className="h-9 shrink-0 flex items-center justify-center gap-2 border-b border-[var(--border)] bg-[var(--bg)]/60">
              <span className={CAPSULA}>
                <span
                  className={`grid h-7 w-9 place-items-center rounded-md ${SEG_ON}`}
                >
                  <Monitor size={ICONO_BARRA} />
                </span>
                <span
                  className={`grid h-7 w-9 place-items-center rounded-md ${SEG_OFF}`}
                >
                  <Tablet size={ICONO_BARRA} />
                </span>
                <span
                  className={`grid h-7 w-9 place-items-center rounded-md ${SEG_OFF}`}
                >
                  <Smartphone size={ICONO_BARRA} />
                </span>
              </span>
              <span className="relative inline-flex items-center h-7 pl-2.5 pr-6 rounded-lg border border-[var(--border)] bg-[var(--bg-elev)] text-[11.5px] font-medium tabular-nums">
                75%
                <ChevronDown
                  size={ICONO_BARRA}
                  className="pointer-events-none absolute right-1.5 text-[var(--fg-faint)]"
                />
              </span>
            </div>

            {/* el lienzo: la página de la fotógrafa, entera y con sitio */}
            <div className="flex-1 min-h-0 overflow-hidden p-3 sm:p-4 grid place-items-center">
              <div className="relative h-full w-full max-w-[680px] mx-auto rounded-xl ring-1 ring-black/5 dark:ring-white/10 overflow-y-auto shadow-[0_24px_60px_-30px_rgba(0,0,0,0.35)] dark:shadow-[0_24px_60px_-30px_rgba(0,0,0,0.7)] bg-[#faf8f5]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/hero-margot.webp"
                  alt="Página de fotógrafo creada con Len"
                  className="block w-full h-auto"
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
