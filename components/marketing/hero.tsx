import { getTranslations } from "next-intl/server";
import { countLiveProjects } from "@/lib/projects";
import { ArrowUpRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { LenLetra } from "./len-letra";
import { HeroPromptInput } from "./hero-prompt-input";
import { HeroLenProvider } from "./hero-len";
import { HomeGlow } from "./home-glow";

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
//
// 06/11 — LA PORTADA ES SÓLO EL INPUT (spec local 2026-11-06-portada-solo-input).
// El héroe ocupa la pantalla y es lo único: la maqueta se fue a /features. Y
// vuelve una luz, pero no la de antes: el 09/10 se quitaron la malla coral y el
// `aurora-dawn` por manchas de color que competían con el titular; ésta es UNA
// luz, enorme y tenue, que nace debajo de la caja (la receta del fondo de
// Gemini, medida sobre la captura de Jesús, en el naranja de OpenLen). Vive en
// `home-glow.tsx`, dentro del envoltorio de la caja.
// ─────────────────────────────────────────────────────────────────────────────

export async function Hero() {
  const t = await getTranslations("marketing");
  // Números reales o nada: la línea de páginas vivas se esconde en 0 en vez de
  // presumir de un cero.
  const pagesLive = await countLiveProjects().catch(() => 0);

  return (
  // `-mt-14 pt-14`: la sección sube bajo la nav (que es transparente arriba)
  // y devuelve esos 56px como relleno, así que el fondo es uno solo.
    // `flex-1` + centred: the hero fills what the menu and the one-row footer leave of the screen (the home's `<main>`
    // is a flex column, see `MarketingChrome`), so the footer stays inside the first screen. No stacking context and no
    // clipping here — both live on the home's wrapper (`app/[locale]/page.tsx`): `overflow-hidden` here cut the light
    // right above the footer (a hard band), and `isolate` here trapped the sign-in dialog under the menu and footer.
    <section className="relative -mt-14 flex flex-1 flex-col justify-center pt-14">
      {/* EL PRIMER PANTALLAZO A LO GROK BOT (09/10, Jesús, con su portada de
          referencia): un aviso en píldora, UN titular con Len dentro haciendo
          de «o» y, donde Grok pone dos botones, la caja
          de prompt (Jesús, el mismo día: la caja es la entrada, no un botón
          que lleva a ella). Y justo después, sin pausa, la maqueta del taller.

          El fondo es LIMPIO: se fueron la malla coral (`hero-mesh`) y el
          resplandor de arriba de la portada (`aurora-dawn`). El color lo pone
          Len, en el titular, y nada más.

          El proveedor envuelve el titular y la caja: la cara que hace de «o»
          saluda al llegar y luego escucha si escribes o dictas, y piensa al
          enviar. */}
      <HeroLenProvider>
      <div className="relative mx-auto max-w-5xl px-6 pt-16 pb-4 sm:pt-24">
        <div className="flex flex-col items-center text-center">
          <Link
            href="/register"
            className="group inline-flex items-center gap-2 rounded-full bg-coral-700 py-1 pl-3.5 pr-1 text-[13px] text-white/90 transition-colors hover:bg-coral-800"
          >
            {t.rich("hero.announce", {
              strong: (chunks) => <span className="font-semibold text-white">{chunks}</span>,
              dot: () => <span className="text-white/60" aria-hidden>·</span>,
            })}
            <span className="inline-flex size-6 items-center justify-center rounded-full bg-white/20 text-white transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden>
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

          {/* Sin subtítulo (10/10, Jesús: «para que se vea más clean»): el
              titular y la caja bastan; lo que hace Len lo enseña la maqueta. */}
          <div className="relative mt-12 w-full max-w-2xl text-left">
            <HomeGlow />
            <HeroPromptInput />
          </div>

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
      </HeroLenProvider>
    </section>
  );
}
