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
    <section className="relative overflow-hidden">
      {/* La malla. Cuatro manchas con los centros desalineados a propósito:
          alineadas se leen como un degradado de plantilla. Ver `.hero-mesh` en
          app/globals.css para la mecánica (desvanecido bajo la nav, deriva,
          reduced-motion). */}
      <div className="hero-mesh" aria-hidden>
        <div
          className="hero-mesh__blob hero-mesh__blob--a"
          style={{
            left: "-12%", top: "14%", width: "58%", height: "68%",
            background: "radial-gradient(circle, rgba(255,90,54,0.78) 0%, rgba(255,90,54,0) 70%)",
          }}
        />
        <div
          className="hero-mesh__blob hero-mesh__blob--b"
          style={{
            right: "-14%", top: "4%", width: "62%", height: "62%",
            background: "radial-gradient(circle, rgba(244,63,94,0.62) 0%, rgba(244,63,94,0) 70%)",
          }}
        />
        <div
          className="hero-mesh__blob hero-mesh__blob--c"
          style={{
            left: "8%", bottom: "-26%", width: "80%", height: "76%",
            background: "radial-gradient(circle, rgba(139,92,246,0.55) 0%, rgba(139,92,246,0) 70%)",
          }}
        />
        {/* El ámbar de arriba a la derecha es lo que impide que sea una rampa
            de dos colores — un amanecer tiene calor antes que color. */}
        <div
          className="hero-mesh__blob hero-mesh__blob--d"
          style={{
            right: "8%", top: "-10%", width: "42%", height: "46%",
            background: "radial-gradient(circle, rgba(251,191,36,0.48) 0%, rgba(251,191,36,0) 72%)",
          }}
        />
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
            apagar la malla, que es el héroe entero. */}
        {pagesLive > 0 && (
          <p className="mx-auto mt-8 max-w-2xl text-center text-[13px] text-zinc-700 dark:text-zinc-400">
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
