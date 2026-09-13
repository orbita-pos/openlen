// lib/evals/page-cohort.ts — el conjunto fijo de briefs con el que se mide la
// creación de páginas.
//
// Datos puros: CERO secretos, CERO I/O, CERO imports nativos. Este archivo se
// commitea y su forma se prueba (page-cohort.test.ts) sin llamar a ningún
// modelo. El harness (scripts/evals-pages.ts) es el que gasta dinero.
//
// POR QUÉ FIJO. Hasta ahora cada corrida mía usaba briefs distintos y se tiraba
// después, así que no se podía decir "el mes pasado fallaba el 12%, ahora el
// 4%". Un conjunto que no cambia es lo que convierte una anécdota en una tasa.
//
// CÓMO SE PUNTÚA. Sólo con lo determinista: la forma del documento, la puerta,
// y lo que el navegador mide. NO hay juez LLM — se midió que su veredicto
// cambia de una corrida a otra sobre la misma página, así que perseguir su tasa
// es perseguir ruido (ver [[llm-judge-is-not-a-ship-gate]]).
//
// CÓMO CRECE. Cada fallo real que aparezca se añade aquí con su expectativa, y
// no se quita nunca. Los tres de 2026-08-19 —el preámbulo, la valla a mitad de
// documento y el idioma— entraron así.

export type CohortTag =
  /** Nichos que un usuario pediría un martes cualquiera. */
  | "cotidiano"
  /** Empuja al modelo a una esquina: tamaño, escritura, contenido peligroso. */
  | "extremo"
  /** Nació de un fallo REAL. No se borra aunque lleve meses en verde. */
  | "regresion";

export interface PageEvalCase {
  readonly id: string;
  readonly tag: CohortTag;
  readonly brief: string;
  /** Código ISO que debe llevar `<html lang>`. Se compara por prefijo. */
  readonly expectLang: string;
  /** `dir="rtl"` obligatorio para escrituras de derecha a izquierda. */
  readonly expectRtl?: true;
  /** El fallo que este caso vigila. Sólo en los de regresión. */
  readonly guards?: string;
  /**
   * Ruta EN EL REPO de una imagen que el usuario adjunta al brief, como si la
   * hubiera subido desde el héroe.
   *
   * 🔴 ESTO ABRE UN PAPEL DEL MODELO QUE NUNCA SE HABÍA MEDIDO. Un turno con
   * referencia no lo escribe el razonador: `writerForTurn(true)` manda el turno
   * a la operación `page_write_with_reference` —el papel con visión— y se cobra
   * a la tarifa de ese papel. Es un camino de producción, de pago, y hasta el
   * 2026-09-07 el cohorte no tenía siquiera un campo donde ponerle una imagen:
   * no es que faltaran casos, es que era imposible.
   *
   * ⚰️ Aquí decía «se cobra a `qwen-vision`, que cuesta ~10x la salida de
   * DeepSeek». Las dos mitades caducaron el 2026-09-12: el papel con visión
   * pasó a `deepseek-v4p1-flash` y hoy cuesta LO MISMO que el razonador. Y el
   * ~10x nunca fue cierto ni con Qwen — eran 2.4x (corregido el 2026-08-28).
   *
   * 🔴 LO QUE SIGUE SIENDO VERDAD, y es el motivo de este caso: fue el camino
   * que destapó que el papel con visión llevaba desde el 2026-08-27 devolviendo
   * 404. Este cohorte murió en el caso 49 con ese error, y por eso se supo.
   *
   * Con UNA sola referencia el brief viaja byte a byte igual que sin ella —el
   * bloque de «REFERENCIAS ADJUNTAS» sólo lo añade la ruta cuando hay más de
   * una—, así que este caso mide el camino con visión y nada más.
   */
  readonly imagen?: string;

  /**
   * Cuántas páginas SEPARADAS pide este brief, al menos.
   *
   * El caso declara lo que espera, igual que en `plugin eval` los `graders`
   * los declara el caso y no el arnés. Sin esto el hueco vuelve a ser
   * invisible: una portada que no declarara ninguna saldría LIMPIA, que es
   * justo cómo este camino llevaba desde el 2026-08-27 sin medir.
   *
   * 🔴 SE COMPRUEBA EL NÚMERO, NUNCA LOS NOMBRES. Exigir `/equipo` en vez de
   * aceptar `/nosotros` sería enseñarle al modelo nuestro vocabulario y
   * medirle después cómo lo usa — las dos veces que lo hicimos (`calc`,
   * `prueba`) hubo que retirar el veredicto.
   */
  readonly expectPages?: number;
}

// 1.0 → 1.1: entran los dos casos de CÁLCULO (L2, la 9ª conducta). El cohorte
// crece, así que la comparación contra una línea base de 1.0 se descarta a
// propósito — comparar 14 páginas contra 12 diría "+2 limpias" por aritmética,
// no por calidad.
//
// 1.1 → 1.2: dos casos más de L3 (listas por posición y comprensiones). Miden
// lo que ninguna prueba unitaria puede: si el MODELO usa las piezas nuevas
// cuando el brief las pide, ahora que el `doc` se las enseña.
// 1.2 → 1.3: los MISMOS casos, un medidor más afilado. Entra el veredicto
// `enlace` (el ancla a una sección que no existe), y por eso hay que subir la
// versión aunque no se toque ni un brief: sin esto, `compareScorecards` diría
// «REGRESIÓN: contradictorio» sobre una página que no ha cambiado ni una letra
// —lo que cambió es que ahora se le ve el defecto—. Es exactamente el fantasma
// que se cazó el 2026-09-07 al revés: aquella corrida regaló «+3 arregladas»
// por RETIRAR el veredicto `prueba`, y ninguna página se había arreglado.
// 1.3 → 1.4: entra `referencia-calida`, el PRIMER caso con imagen adjunta. No
// es un brief más: abre el papel con visión —otra operación, otro modelo, otra
// tarifa— que llevaba meses en producción sin una sola medición porque
// `PageEvalCase` ni siquiera tenía dónde poner una imagen.
// 1.4 → 1.5: entra `multipagina`, el primer brief que pide páginas SEPARADAS.
// El camino de las subpáginas —una llamada y un crédito por cada una, la misma
// tubería que la portada— nunca se había disparado aquí: `paginasDeclaradas`
// sobre los 49 artefactos del corpus devolvió CERO, y no por un fallo nuestro
// sino porque ningún brief pedía más de una página.
export const PAGE_COHORT_VERSION = "page-cohort/1.5";

export const PAGE_COHORT: readonly PageEvalCase[] = Object.freeze([
  // ── cotidiano ────────────────────────────────────────────────────────────
  {
    id: "terror",
    tag: "cotidiano",
    brief:
      "Escape room de terror en Monterrey. Tres salas temáticas, grupos de 4 a 8 personas, no apto para menores de 16. Reservas por hora.",
    expectLang: "es",
  },
  {
    id: "colegio",
    tag: "cotidiano",
    brief:
      "Colegio bilingüe en Puebla, de preescolar a secundaria. Grupos de 20 alumnos, laboratorio de ciencias, y admisiones abiertas para el ciclo que entra.",
    expectLang: "es",
  },
  {
    id: "saas",
    tag: "cotidiano",
    brief:
      "Herramienta para que equipos de soporte respondan tickets más rápido. Bandeja unificada, respuestas guardadas, e informes de tiempo de respuesta. Prueba gratis 14 días.",
    expectLang: "es",
    guards: "el modelo cerró la valla de markdown a mitad y siguió escribiendo notas de diseño",
  },
  {
    id: "comida",
    tag: "cotidiano",
    brief:
      "Taquería de barrio en la Roma. Diez guisos diarios, salsas de la casa, y servicio hasta las 3 de la mañana los fines de semana.",
    expectLang: "es",
    guards: "el modelo escribió una frase de cortesía antes del <!doctype, dos intentos de dos",
  },
  {
    id: "documentacion",
    tag: "cotidiano",
    brief:
      "Documentación de una API de pagos para desarrolladores. Referencia de endpoints, guías de inicio rápido, ejemplos en curl y JavaScript, y registro de cambios.",
    expectLang: "es",
    guards: "una página que muestra ``` en su contenido no puede recortarse por eso",
  },

  // ── extremo ──────────────────────────────────────────────────────────────
  {
    id: "minimo",
    tag: "extremo",
    brief: "Vendo miel de abeja",
    expectLang: "es",
  },
  {
    id: "larguisimo",
    tag: "extremo",
    brief:
      "Somos una cooperativa agrícola en Oaxaca fundada en 1987 por catorce familias zapotecas. Producimos café de altura de las variedades typica, bourbon y geisha en parcelas entre 1,200 y 1,800 metros. El beneficio es húmedo, con fermentación controlada de 36 a 48 horas y secado en patio de cemento y camas africanas. Tenemos certificación orgánica desde 2003 y comercio justo desde 2007. Exportamos a Alemania, Japón y Canadá, y vendemos al menudeo en nuestra tienda de la ciudad de Oaxaca y por envío nacional. Ofrecemos visitas guiadas a las parcelas en temporada de cosecha, de noviembre a marzo, con hospedaje en cabañas de las familias socias, comida incluida, y un taller de catación. También damos cursos de barismo de fin de semana, tenemos un programa de apadrinamiento de cafetos, vendemos por suscripción mensual con tres niveles, y donamos el 2% de las ventas a un fondo de becas para hijos de socios. El precio del kilo va de 380 a 1,400 pesos según variedad y proceso. Aceptamos transferencia, tarjeta y pago contra entrega en Oaxaca capital. Nuestro horario de tienda es de lunes a sábado de 8 a 20 horas y domingo de 9 a 14. El teléfono es 951 123 4567 y respondemos WhatsApp. Queremos que la página cuente la historia de las familias, muestre el proceso del grano, tenga la tienda con los precios, el calendario de visitas, los cursos, y un formulario para mayoristas.",
    expectLang: "es",
  },
  {
    id: "arabe",
    tag: "extremo",
    brief:
      "مخبز تقليدي في القاهرة. خبز بلدي، فطير مشلتت، وحلويات شرقية. مفتوح من السادسة صباحاً.",
    expectLang: "ar",
    expectRtl: true,
    guards: "una regla de idioma que fijara el español rompería este caso",
  },
  {
    id: "con-html",
    tag: "extremo",
    brief:
      'Curso para aprender HTML desde cero. La página debe mostrar ejemplos como <div class="card"> y <script>alert(1)</script> dentro de bloques de código, y explicar qué hace cada uno.',
    expectLang: "es",
    guards: "HTML dentro del brief no puede escaparse a la página ni burlar el saneo",
  },
  {
    id: "una-seccion",
    tag: "extremo",
    brief:
      "Solo quiero un formulario de contacto. Nada más. Sin menú, sin secciones, sin pie de página. Únicamente el formulario centrado.",
    expectLang: "es",
  },

  // ── cálculo (L2) ─────────────────────────────────────────────────────────
  // Los dos que Jesús trajo de peticiones REALES. Miden lo que ninguna prueba
  // unitaria puede: si el MODELO adopta la conducta cuando el brief la pide.
  // Que el intérprete funcione ya lo prueban lib/conductas-heredadas/recipes/calc.test.ts
  // y el gate del navegador; esto mide la otra mitad.
  {
    id: "solar",
    tag: "cotidiano",
    brief:
      "Instalamos paneles solares en casas de Guadalajara. Quiero que el visitante escriba cuánto paga de luz al mes y la página le diga cuánto ahorraría con nosotros (ahorra alrededor del 72%).",
    expectLang: "es",
  },
  {
    id: "sorteo",
    tag: "cotidiano",
    brief:
      "Página para una rifa de fin de año de una tienda de bicicletas. Que tenga los nombres de los participantes y un botón que elija a uno al azar delante de todos.",
    expectLang: "es",
  },

  {
    id: "quiz",
    tag: "cotidiano",
    brief:
      "Escuela de manejo en Mérida. Quiero un test de 5 preguntas de señales de tránsito, que el visitante avance una por una y al final le diga cuántas acertó y si aprobó (4 de 5).",
    expectLang: "es",
  },
  {
    id: "menu-precio",
    tag: "cotidiano",
    brief:
      "Cafetería de especialidad en Xalapa. Que el visitante elija su bebida de una lista y la página le muestre el precio de esa bebida al instante, y cuántas opciones cuestan menos de 60 pesos.",
    expectLang: "es",
  },

  // ── regresión ────────────────────────────────────────────────────────────
  {
    id: "contradictorio",
    tag: "regresion",
    brief:
      "Una página completamente vacía pero que venda relojes de lujo y convenza al visitante de comprar hoy mismo.",
    expectLang: "es",
    guards: "brief en español devolvía una página entera en inglés (lang=en)",
  },
  {
    id: "fecha-derivada",
    tag: "regresion",
    brief:
      "Taller de cerámica en Oaxaca. Clases para principiantes los sábados y un horno de leña que usamos desde 1998. Di cuántos años llevamos.",
    expectLang: "es",
    guards: "sin la fecha, el modelo contaba desde 2024: 'desde 1998' salía como 26 años",
  },

  // ── con referencia adjunta ───────────────────────────────────────────────
  // 🔴 EL PAPEL QUE NADIE HABÍA MEDIDO. Todo lo de arriba lo escribe el
  // razonador; esto lo escribe el papel CON VISIÓN, y es otro modelo, otra
  // operación (`page_write_with_reference`) y otra tarifa (~10x la salida).
  // Llevaba meses en producción sin una sola medición.
  //
  // La imagen es una maqueta de interfaz en luz cálida —crema, coral, paneles
  // de cristal—, elegida porque su dirección visual es INEQUÍVOCA: si el turno
  // con visión funciona, se nota; si el modelo escribe a ciegas, también.
  // Vive ya en el repo, así que el cohorte no engorda con un binario nuevo.
  {
    id: "referencia-calida",
    tag: "cotidiano",
    brief:
      "Estudio de diseño de interiores en Guadalajara. Proyectos residenciales, asesoría de color y un formulario para pedir cita. Que la página siga el estilo de la imagen que adjunto.",
    expectLang: "es",
    imagen: "designs/creator/img/warm/openlen.webp",
  },

  // ── un sitio de varias páginas ───────────────────────────────────────────
  // 🔴 EL CAMINO QUE NUNCA SE DISPARÓ. Cuando la portada enlaza una ruta
  // relativa de un tramo, `construirPaginasDeclaradas` crea esa página de
  // verdad: una llamada y un crédito por cada una, con la misma tubería que la
  // portada. Es un camino de producción, de pago, y en los 49 artefactos del
  // corpus `paginasDeclaradas` devolvió CERO — el mismo hueco que tenía el
  // papel con visión hasta el caso de aquí arriba.
  //
  // Y NO es que estuviera roto: el contrato le dice al modelo que una página
  // con secciones «es la respuesta por defecto», así que con briefs que caben
  // en una página el modelo acertaba al no crear ninguna. Faltaba el brief que
  // pide lo otro.
  //
  // 🔴 EL BRIEF PIDE PÁGINAS COMO LAS PEDIRÍA UN CLIENTE, y no nombra
  // `/servicios` ni ninguna otra pieza nuestra. Enseñarle nuestro vocabulario
  // y medirle después cómo lo usa es letra por letra como murieron los
  // veredictos `calc` y `prueba`.
  {
    id: "multipagina",
    tag: "cotidiano",
    brief:
      "Clínica veterinaria en Guadalajara. Consulta general, vacunas, cirugía y urgencias 24 horas. Quiero un sitio con páginas separadas: una para los servicios, otra para el equipo de veterinarios y otra para contacto — no quiero que todo esté en la misma.",
    expectLang: "es",
    // Tres, las que el brief nombra. Medido el 2026-09-07 en el brazo de
    // control: el modelo declaró `/servicios`, `/equipo` y `/contacto` —pero
    // eso fue UNA corrida, y sin este número una portada de una sola página
    // volvería a puntuar limpia.
    expectPages: 3,
  },
]);
