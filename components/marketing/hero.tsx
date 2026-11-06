import { getTranslations } from "next-intl/server";
import { countLiveProjects } from "@/lib/projects";
import { HeroPromptInput } from "./hero-prompt-input";
import { HomeGlow } from "./home-glow";
import { HomeQuestion } from "./home-question";

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
// `home-glow.tsx`, dentro del envoltorio de la caja. Y se fueron la píldora de
// aviso de arriba («se ve como un blog») y los ejemplos bajo la caja (Jesús:
// «que se vea más limpio»): queda el titular, la caja y la luz. Y el titular
// es una pregunta que cambia con la hora (`home-question.tsx`); la cara de Len,
// en el menú.
// ─────────────────────────────────────────────────────────────────────────────

export async function Hero() {
  const t = await getTranslations("marketing");
  // Números reales o nada: la línea de páginas vivas se esconde en 0 en vez de
  // presumir de un cero.
  const pagesLive = await countLiveProjects().catch(() => 0);

  return (
    // `flex-1` + centred: the hero fills what the start frame's top row and the one-row footer leave of the screen (the
    // home's `<main>` is a flex column, see `home-shell.tsx`), so the footer stays inside the first screen. No stacking
    // context and no clipping here — both live on the home's wrapper (`app/[locale]/page.tsx`): `overflow-hidden` here
    // cut the light right above the footer (a hard band), and `isolate` here trapped the sign-in dialog under the menu.
    <section className="relative flex flex-1 flex-col justify-center">
      {/* THE ONLY SCREEN (06/11): the question and, under it, the box — the way in, not a button that leads to it
          (Jesús, 09/10). Behind the box, its light (`HomeGlow`); nothing else — no announcement pill, no example chips,
          no product mockup (that lives on /features now). Len's face left the headline for the menu, where the brand
          mark was (`HeroLenMark`): `HeroLenProvider` wraps the whole home in `app/[locale]/page.tsx`, so the face in
          the menu still waves on arrival, listens while you type or dictate here, and thinks when you send. */}
      {/* WHERE IT SITS, like Gemini's (measured on Jesús's screenshot, 06/11): the BOX at the middle of the screen and
          the question ~106 px above it. No top padding (it pushed the whole block down), and a bottom padding about
          the question's height plus the gap, so what the centring puts in the middle is the box, not the block.
          `max-height: 500px` (a phone in landscape): no lift, so the box stays in the first screen.
          `w-full`: in the section's flex column, `mx-auto` alone shrank this block to its content — the box was as
          wide as whichever question came up. */}
      <div className="relative mx-auto w-full max-w-5xl px-6 pb-24 [@media(max-height:500px)]:pb-4">
        <div className="flex flex-col items-center text-center">
          {/* Shown by the browser once it knows the time of day; without JavaScript, the neutral question as it is. */}
          <noscript>
            <style>{".home-question{opacity:1!important}"}</style>
          </noscript>
          <HomeQuestion />

          {/* Sin subtítulo (10/10, Jesús: «para que se vea más clean»): el
              titular y la caja bastan; lo que hace Len lo cuenta /features. */}
          {/* `max-w-3xl` (Jesús, 06/11: «haz el input más largo»): a wide bar, like Gemini's. */}
          <div className="relative mt-8 w-full max-w-3xl text-left [@media(max-height:500px)]:mt-5">
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
    </section>
  );
}
