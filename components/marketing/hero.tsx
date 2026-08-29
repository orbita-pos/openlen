import { getTranslations } from "next-intl/server";
import { countLiveProjects } from "@/lib/projects";
import { HeroProduct } from "./hero-product";
import { HeroPromptInput } from "./hero-prompt-input";

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

      {/* DOS ANCHOS. El titular quiere aire —la copia trae su propio <br> y
          pide DOS líneas— y el prompt quiere una columna estrecha, como en la
          referencia. Metidos en el mismo max-w-3xl, el titular se partía en
          cuatro renglones apelmazados. */}
      <div className="relative mx-auto max-w-5xl px-6 pt-24 pb-12 sm:pt-32 sm:pb-16">
        <div className="flex flex-col items-center text-center">
          <h1 className="max-w-[56rem] text-balance text-[38px] sm:text-[56px] md:text-[64px] font-semibold tracking-tightest leading-[1.06]">
            {t.rich("hero.title", {
              br: () => <br />,
              muted: (chunks) => (
                <span className="text-zinc-500 dark:text-zinc-400 font-medium">{chunks}</span>
              ),
              gradient: (chunks) => (
                <span className="serif-accent bg-gradient-to-br from-coral-600 via-coral-700 to-rose-600 bg-clip-text text-transparent pr-[0.06em]">
                  {chunks}
                </span>
              ),
            })}
          </h1>

        </div>

        {/* La caja de prompt: el centro del héroe, no un extra al final.
            Vuelve a la columna estrecha — es la proporción de la referencia. */}
        <div className="mx-auto mt-12 max-w-2xl sm:mt-14">
          <HeroPromptInput />
        </div>

        {/* zinc-700, no zinc-500: MEDIDO sobre el píxel pintado daba 2.67:1
            — esta línea cayó en la zona más saturada de la malla al bajarla
            del héroe. Se oscurece el texto, que es UNA línea, en vez de
            apagar la malla, que es el héroe entero.

            Y zinc-300 en OSCURO, no zinc-400: ahí medía 4.55:1 contra un
            mínimo de 4.5 — pasa, pero sin margen, y las manchas DERIVAN, así
            que el fondo bajo esta línea cambia con el tiempo. Un contraste al
            filo sobre un fondo que se mueve es un fallo con retardo. */}
        {pagesLive > 0 && (
          <p className="mx-auto mt-8 max-w-2xl text-center text-[13px] text-zinc-700 dark:text-zinc-300">
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

      {/* Segundo compás: la maqueta del producto, ya fuera del primer
          pantallazo. Sangra por abajo (estilo Framer/Linear) para que se lea
          como «sigue leyendo», no como el final de la sección. */}
      <div className="relative mx-auto max-w-[88rem] px-6 mt-28 pb-20 sm:mt-36 sm:pb-24">
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
