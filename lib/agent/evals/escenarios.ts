// lib/agent/evals/escenarios.ts — conversaciones REALES, para
// `scripts/agent-multiturno.ts`.
//
// Un caso de `cases.ts` es UN turno: mide al Agente empezando de cero. Un
// escenario es una CONVERSACIÓN, y mide lo otro — si se desahoga o se atasca
// según se acumula el hilo. Son las dos mitades y ninguna sustituye a la otra.
//
// Los turnos van tal y como los escribió la persona, erratas incluidas: un
// mensaje "limpiado" mide otro turno.

export interface Escenario {
  /** kebab-case, único. */
  readonly id: string;
  readonly descripcion: string;
  /** El documento de partida, como lo dejó la generación. */
  readonly html: string;
  /** Los mensajes, en orden. */
  readonly turnos: readonly string[];
  /**
   * Qué tiene que seguir siendo verdad del HTML FINAL. Se imprimen al cerrar;
   * no fallan la corrida, porque un escenario no es una puerta: es una lupa.
   * El juicio es de quien lo lee, con la curva de vueltas delante.
   */
  readonly invariantes: Readonly<Record<string, RegExp>>;
}

export const ESCENARIOS: readonly Escenario[] = [
  {
    id: "aurora",
    descripcion:
      "Inmobiliaria de Monterrey (2026-09-02). El catálogo curado no cubre el rubro, así que tres tarjetas conservan su degradado de marcador — que es lo CORRECTO. En la sesión real el crítico las leyó como imágenes rotas y el medidor se inventó un titular blanco sobre blanco: 17 ediciones y una portada peor que la de partida.",
    html: `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Aurora Propiedades</title>
<style>
  :root{--bg:#ffffff;--fg:#0f172a;--fg-muted:#475569;--accent:#1D4ED8;--surface-2:#f1f5f9}
  *,*::before,*::after{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font-family:Manrope,system-ui}img{max-width:100%}
  .nav-link{color:var(--fg-muted);text-decoration:none}
</style></head>
<body>
<header style="position:sticky;top:0;z-index:50;background:rgba(255,255,255,0.9);backdrop-filter:blur(4px);padding:16px 32px;display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center">
  <span style="color:var(--fg);font-weight:700">Aurora Propiedades</span>
  <nav style="display:flex;flex-wrap:wrap;gap:16px"><a class="nav-link" href="#propiedades">Propiedades</a><a class="nav-link" href="#servicios">Servicios</a><a class="nav-link" href="#proceso">Proceso</a><a class="nav-link" href="#contacto">Contacto</a></nav>
</header>

<section style="position:relative">
  <div style="position:absolute;inset:0">
    <div style="width:100%;height:100%" class="photo-placeholder">
      <img src="data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221600%22%20height%3D%22900%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20y1%3D%220%22%20x2%3D%220%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23dbeafe%22%2F%3E%3Cstop%20offset%3D%220.55%22%20stop-color%3D%22%2393c5fd%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%231e293b%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect%20width%3D%221600%22%20height%3D%22900%22%20fill%3D%22url(%2523g)%22%2F%3E%3Crect%20x%3D%22200%22%20y%3D%22480%22%20width%3D%221200%22%20height%3D%22420%22%20fill%3D%22%230f172a%22%2F%3E%3C%2Fsvg%3E" alt="Fachada de casa moderna al atardecer" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
    </div>
    <div style="position:absolute;inset:0;background:linear-gradient(to right, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.1) 70%)"></div>
  </div>
  <div style="position:relative;padding:96px 32px">
    <div style="max-width:42rem">
      <p style="color:var(--fg-muted);letter-spacing:.08em;font-size:13px;margin:0 0 16px">Monterrey · San Pedro · Cumbres · Contry</p>
      <h1 style="color:var(--fg);font-family:'Bricolage Grotesque',system-ui;font-size:48px;line-height:1.05;margin:0 0 20px">Encuentra casa en Monterrey sin dar vueltas.</h1>
      <p style="color:var(--fg-muted);font-size:18px;margin:0 0 28px">Doce años acompañando a familias regiomontanas a comprar, vender y rentar. Un solo asesor desde la primera visita hasta la firma.</p>
      <a href="#propiedades" style="background:var(--accent);color:#fff;padding:14px 22px;border-radius:6px;text-decoration:none">Ver propiedades</a>
      <a href="#proceso" style="border:1px solid var(--fg);color:var(--fg);padding:14px 22px;border-radius:6px;text-decoration:none;margin-left:12px">Cómo trabajamos</a>
    </div>
  </div>
</section>

<section id="propiedades" style="padding:72px 32px">
  <h2 style="font-size:32px;margin:0 0 32px">Propiedades destacadas</h2>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px">
    <article><div style="height:200px;border-radius:6px;overflow:hidden;position:relative"><img src="data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221600%22%20height%3D%22900%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20y1%3D%220%22%20x2%3D%221%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23cbd5e1%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23475569%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect%20width%3D%221600%22%20height%3D%22900%22%20fill%3D%22url(%2523g)%22%2F%3E%3Crect%20x%3D%22120%22%20y%3D%22420%22%20width%3D%221360%22%20height%3D%22480%22%20fill%3D%22%23475569%22%2F%3E%3C%2Fsvg%3E" alt="Casa" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></div><h3>Casa en San Pedro Garza García</h3><p style="color:var(--accent);font-weight:700">$8,900,000</p><p style="color:var(--fg-muted)">320 m² · 4 rec · 4.5 baños</p></article>
    <article><div style="height:200px;border-radius:6px;overflow:hidden;position:relative"><img src="data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221600%22%20height%3D%22900%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20y1%3D%220%22%20x2%3D%221%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23fde68a%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%2392400e%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect%20width%3D%221600%22%20height%3D%22900%22%20fill%3D%22url(%2523g)%22%2F%3E%3Crect%20x%3D%22120%22%20y%3D%22420%22%20width%3D%221360%22%20height%3D%22480%22%20fill%3D%22%2392400e%22%2F%3E%3C%2Fsvg%3E" alt="Interior" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></div><h3>Departamento en Valle Oriente</h3><p style="color:var(--accent);font-weight:700">$4,200,000</p><p style="color:var(--fg-muted)">118 m² · 2 rec · 2 baños</p></article>
    <article><div style="height:200px;border-radius:6px;overflow:hidden;position:relative"><img src="data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221600%22%20height%3D%22900%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%22%20y1%3D%220%22%20x2%3D%221%22%20y2%3D%221%22%3E%3Cstop%20offset%3D%220%22%20stop-color%3D%22%23bbf7d0%22%2F%3E%3Cstop%20offset%3D%221%22%20stop-color%3D%22%23166534%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect%20width%3D%221600%22%20height%3D%22900%22%20fill%3D%22url(%2523g)%22%2F%3E%3Crect%20x%3D%22120%22%20y%3D%22420%22%20width%3D%221360%22%20height%3D%22480%22%20fill%3D%22%23166534%22%2F%3E%3C%2Fsvg%3E" alt="Sala" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></div><h3>Casa en Cumbres Elite</h3><p style="color:var(--accent);font-weight:700">$5,650,000</p><p style="color:var(--fg-muted)">240 m² · 3 rec · 3 baños</p></article>
    <article><div class="bg-gradient-to-br" style="height:200px;border-radius:6px;background:linear-gradient(135deg,#e2e8f0,#cbd5e1)"></div><h3>Departamento en el centro, renta</h3><p style="color:var(--accent);font-weight:700">$18,500/mes</p><p style="color:var(--fg-muted)">74 m² · 1 rec · 1 baño</p></article>
    <article><div class="bg-gradient-to-br" style="height:200px;border-radius:6px;background:linear-gradient(135deg,#e2e8f0,#cbd5e1)"></div><h3>Casa en Contry</h3><p style="color:var(--accent);font-weight:700">$3,750,000</p><p style="color:var(--fg-muted)">195 m² · 3 rec · 2.5 baños</p></article>
    <article><div class="bg-gradient-to-br" style="height:200px;border-radius:6px;background:linear-gradient(135deg,#e2e8f0,#cbd5e1)"></div><h3>Terreno en Carretera Nacional</h3><p style="color:var(--accent);font-weight:700">$2,100,000</p><p style="color:var(--fg-muted)">480 m²</p></article>
  </div>
</section>

<section id="servicios" style="padding:72px 32px;background:var(--surface-2)">
  <h2 style="font-size:32px;margin:0 0 24px">Servicios</h2>
  <p style="color:var(--fg-muted)">Venta, renta, avalúo comercial y asesoría de crédito (Infonavit, bancario y cofinanciado).</p>
</section>

<section id="proceso" style="padding:72px 32px">
  <h2 style="font-size:32px;margin:0 0 24px">Cómo trabajamos</h2>
  <ol style="color:var(--fg-muted)"><li>Nos dices qué buscas.</li><li>Te armamos una lista corta y visitamos.</li><li>Te llevamos el papeleo hasta la escritura.</li></ol>
</section>

<section id="contacto" style="padding:72px 32px;background:var(--surface-2)">
  <h2 style="font-size:32px;margin:0 0 24px">Contacto</h2>
  <p style="color:var(--fg-muted)">Lunes a sábado de 9 a 19 · Av. Gómez Morín 955, San Pedro Garza García, Nuevo León</p>
</section>
</body></html>`,
    turnos: [
      "este texto no se ve por la imagen Monterrey · San Pedro · Cumbres · Contry  Encuentra casa en Monterrey sin dar vueltas. Doce años acompañando a familias regiomontanas a comprar, vender y rentar. Un solo asesor desde la primera visita hasta la firma.",
      "te paso la imagen de como se ve, para que veas que la imagen hace que el texto no se vea tanto, no se si con un texto blanco o como se soluciona",
      "ahora el navbar solamente cuando paso encima del hero donde esta la img se esconde su texto, no se si cuando este por encima de la img se texto blanco solamente o cual seria la mejor solucion",
    ],
    invariantes: {
      // Los tres síntomas de la sesión real, en el mismo orden en que dolieron.
      "las 3 cajas de marcador siguen": /(?:bg-gradient-to-br[\s\S]*?){3}/,
      "el hero acabó pintado de sólido (MALO)": /#0b1220|#0f172a[^;)]*\)\s*;?\s*$/m,
      "el velo del hero sigue siendo un velo": /linear-gradient\([^)]*rgba\(/,
      // LA PREGUNTA DE JESUS, HECHA COMPROBABLE. El arnes miraba las cajas de
      // marcador, el color del hero y el velo — y NUNCA si las fotos seguian.
      // Por eso «¿por que quita la foto?» no se podia responder con una corrida:
      // nadie contaba. El fixture nace con CUATRO <img>; si acaba con menos, el
      // turno se llevo una por delante. Cuenta etiquetas, no URLs, a proposito:
      // cambiar la foto por otra es legitimo y no debe fallar; quitarla, no.
      "las 4 fotos siguen": /(?:<img[\s\S]*?){4}/,
    },
  },
];
