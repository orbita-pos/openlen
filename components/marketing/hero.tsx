import { getTranslations } from "next-intl/server";
import { countLiveProjects } from "@/lib/projects";
import { HeroProduct } from "./hero-product";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { LenLetra } from "./len-letra";

// ─────────────────────────────────────────────────────────────────────────────
// HÉROE — rediseñado el 2026-08-28 sobre la referencia de Jesús (Lovable).
//
// LO QUE SE COPIA es la estructura, no la paleta: una malla de degradado A
// SANGRE que es el héroe en sí, y encima sólo tres cosas — titular, una línea
// de subtítulo, y la caja de prompt flotando. El azul→magenta es la identidad
// de ellos; ésta usa el amanecer coral→rosa→violeta que ya vivía en el «Dawn
// bloom» del héroe anterior.
//
// LO QUE SE FUE, y por qué. El héroe tenía una insignia de alpha arriba y una
// píldora de «N páginas en línea» abajo, las dos compitiendo con el titular.
// La referencia no tiene ninguna de las dos, y ésa es la disciplina: el héroe
// hace UNA cosa. El recuento de plantillas sigue vivo en la tira de plantillas
// y en Funciones; las páginas en línea bajan a una línea muda bajo el prompt,
// donde son prueba y no adorno.
//
// LO QUE ENTRA: `HeroPromptInput`. Estaba escrito entero —consciente de la
// sesión, con límite de brief, prompts rápidos y diálogo de acceso— y NO LO
// PINTABA NADIE. Un camino de entrada completo, muerto en el repo.
//
// LO QUE BAJA: la maqueta del producto. Sigue estando y sigue siendo buena,
// pero deja de pelearse con el prompt por el primer pantallazo: ahora es el
// segundo compás, el «y esto es lo que te llevas».
// ─────────────────────────────────────────────────────────────────────────────

export async function Hero() {
  const t = await getTranslations("marketing");
  // Números reales o nada: la línea de páginas vivas se esconde en 0 en vez de
  // presumir de un cero.
  const pagesLive = await countLiveProjects().catch(() => 0);

  return (
  // LA MALLA PASA POR DEBAJO DE LA NAV.
  //
  // La nav es `sticky` y va ANTES del <main>, así que ocupa sus 56px en el
  // flujo y la sección arrancaba justo debajo: detrás del menú quedaba el
  // fondo del body —blanco PURO, rgb(255,255,255)— contra el hueso #FAFAF9 de
  // la malla. Medido, no supuesto: una costura horizontal a 56px.
  //
  // `-mt-14 pt-14` sube la sección esos mismos 56px y los devuelve como
  // relleno: la malla (que es inset-0 de la sección) cubre la franja de la
  // nav, y todo lo de dentro se queda exactamente donde estaba.
    <section className="relative overflow-hidden -mt-14 pt-14">
      {/* LA MALLA. Cuatro manchas con los centros desalineados a propósito:
          alineadas se leen como un degradado de plantilla.

          Geometría y color viven en `app/globals.css`, NO aquí en `style=`: un
          estilo en línea gana a cualquier clase, así que con las manchas
          cableadas en el TSX una variante de malla sólo podía sobreescribirlas
          a base de `!important`. Con la clase `.hero-mesh--<nombre>` en el
          contenedor, probar otra dirección es CSS y nada más. */}
      <div className="hero-mesh hero-mesh--amanecer" aria-hidden>
        {/* La capa que SUBE COMO UNA SOLA COSA. Sin ella, las cuatro manchas
            entraban cada una por su lado y el movimiento se cancelaba: una
            mancha enorme y muy desenfocada cambia poco localmente al moverse,
            y cuatro suaves en desfase se leen como nada. El grupo da la
            lectura —la malla asciende— y el desfase de dentro le quita la
            rigidez de un bloque deslizándose. */}
        <div className="hero-mesh__grupo">
          <div className="hero-mesh__blob hero-mesh__blob--a" />
          <div className="hero-mesh__blob hero-mesh__blob--b" />
          <div className="hero-mesh__blob hero-mesh__blob--c" />
          <div className="hero-mesh__blob hero-mesh__blob--d" />
        </div>
      </div>

      {/* EL PRIMER PANTALLAZO A LO GROK BOT (09/10, Jesús, con su portada de
          referencia): un aviso en píldora, UN titular con Len dentro haciendo
          de «o», una línea gris debajo y dos botones. Y justo después, sin
          pausa, la maqueta del taller.

          La caja de prompt (`HeroPromptInput`) sale del héroe con este diseño
          — Grok no pide nada en el primer pantallazo, invita — pero no se
          borra: sigue montada en /dev/crear y vuelve aquí con una línea. */}
      <div className="relative mx-auto max-w-5xl px-6 pt-16 pb-4 sm:pt-24">
        <div className="flex flex-col items-center text-center">
          <Link
            href="/register"
            className="group inline-flex items-center gap-2 rounded-full border border-zinc-900/10 bg-white/60 py-1 pl-3.5 pr-1 text-[13px] text-zinc-700 backdrop-blur-md transition-colors hover:bg-white/90 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-300 dark:hover:bg-white/[0.1]"
          >
            {t.rich("hero.announce", {
              strong: (chunks) => <span className="font-semibold text-zinc-900 dark:text-white">{chunks}</span>,
              dot: () => <span className="text-zinc-400 dark:text-zinc-500" aria-hidden>·</span>,
            })}
            <span className="inline-flex size-6 items-center justify-center rounded-full bg-zinc-900/[0.06] text-zinc-700 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 dark:bg-white/10 dark:text-zinc-200" aria-hidden>
              <ArrowUpRight size={13} />
            </span>
          </Link>

          {/* `data-len-hide`: mientras se ve el titular (con la cara dentro),
              la cara que acompaña al bajar (len-companion.tsx) espera. */}
          <h1
            data-len-hide
            className="mt-7 max-w-[60rem] text-balance text-[40px] sm:text-[60px] md:text-[76px] font-semibold tracking-tightest leading-[1.04]"
          >
            {t.rich("hero.title", {
              len: (chunks) => <LenLetra>{chunks}</LenLetra>,
              gradient: (chunks) => (
                <span className="serif-accent bg-gradient-to-br from-coral-600 via-coral-700 to-rose-600 bg-clip-text text-transparent pr-[0.06em]">
                  {chunks}
                </span>
              ),
            })}
          </h1>

          {/* zinc-600/zinc-300 y no más claro: va sobre la malla, que DERIVA
              — ver la nota de contraste de la línea de páginas en línea. */}
          <p className="mt-6 max-w-2xl text-pretty text-[17px] leading-relaxed text-zinc-600 sm:text-[20px] dark:text-zinc-300">
            {t("hero.subtitle")}
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="inline-flex h-12 items-center gap-2 rounded-full bg-zinc-900 px-6 text-[16px] font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {t("hero.ctaPrimary")} <ArrowRight size={16} />
            </Link>
            <Link
              href="/templates"
              className="inline-flex h-12 items-center rounded-full bg-zinc-900/[0.06] px-6 text-[16px] font-medium text-zinc-800 backdrop-blur-md transition-colors hover:bg-zinc-900/[0.1] dark:bg-white/10 dark:text-zinc-100 dark:hover:bg-white/[0.15]"
            >
              {t("hero.ctaSecondary")}
            </Link>
          </div>

          {/* zinc-700, no zinc-500: MEDIDO sobre el píxel pintado daba 2.67:1
              — esta línea cayó en la zona más saturada de la malla. Y zinc-300
              en OSCURO: zinc-400 medía 4.55:1 contra un mínimo de 4.5, al filo
              sobre un fondo que se mueve. */}
          {pagesLive > 0 && (
            <p className="mt-6 text-[13px] text-zinc-700 dark:text-zinc-300">
              {t.rich("hero.pagesLive", {
                count: pagesLive,
                strong: (chunks) => (
                  <span className="font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
                    {chunks}
                  </span>
                ),
              })}
            </p>
          )}
        </div>
      </div>

      {/* Segundo compás: la maqueta del producto, pegada a los botones como en
          la de Grok — asoma ya en el primer pantallazo. Sangra por abajo (estilo Framer/Linear) para que se lea
          como «sigue leyendo», no como el final de la sección. */}
      <div id="features" data-len-section="taller" className="relative mx-auto max-w-[88rem] scroll-mt-20 px-6 mt-14 pb-20 sm:mt-16 sm:pb-24">
        <div className="relative">
          <HeroProduct />
        </div>
      </div>

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-white dark:to-[#0a0a0a]"
        aria-hidden
      />
    </section>
  );
}
