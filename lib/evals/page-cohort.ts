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
  /** El brief pide EXPLÍCITAMENTE que la página calcule algo. Se comprueba de
   *  forma determinista: existe una región `data-ol-calc` y sus fórmulas
   *  compilan (`lib/expr/document.ts`). No se juzga si el cálculo es el
   *  "correcto" — eso sería gusto. */
  readonly expectCalc?: true;
  /** El fallo que este caso vigila. Sólo en los de regresión. */
  readonly guards?: string;
}

// 1.0 → 1.1: entran los dos casos de CÁLCULO (L2, la 9ª conducta). El cohorte
// crece, así que la comparación contra una línea base de 1.0 se descarta a
// propósito — comparar 14 páginas contra 12 diría "+2 limpias" por aritmética,
// no por calidad.
//
// 1.1 → 1.2: dos casos más de L3 (listas por posición y comprensiones). Miden
// lo que ninguna prueba unitaria puede: si el MODELO usa las piezas nuevas
// cuando el brief las pide, ahora que el `doc` se las enseña.
export const PAGE_COHORT_VERSION = "page-cohort/1.2";

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
  // Que el intérprete funcione ya lo prueban lib/behaviors/recipes/calc.test.ts
  // y el gate del navegador; esto mide la otra mitad.
  {
    id: "solar",
    tag: "cotidiano",
    brief:
      "Instalamos paneles solares en casas de Guadalajara. Quiero que el visitante escriba cuánto paga de luz al mes y la página le diga cuánto ahorraría con nosotros (ahorra alrededor del 72%).",
    expectLang: "es",
    expectCalc: true,
  },
  {
    id: "sorteo",
    tag: "cotidiano",
    brief:
      "Página para una rifa de fin de año de una tienda de bicicletas. Que tenga los nombres de los participantes y un botón que elija a uno al azar delante de todos.",
    expectLang: "es",
    expectCalc: true,
  },

  {
    id: "quiz",
    tag: "cotidiano",
    brief:
      "Escuela de manejo en Mérida. Quiero un test de 5 preguntas de señales de tránsito, que el visitante avance una por una y al final le diga cuántas acertó y si aprobó (4 de 5).",
    expectLang: "es",
    expectCalc: true,
  },
  {
    id: "menu-precio",
    tag: "cotidiano",
    brief:
      "Cafetería de especialidad en Xalapa. Que el visitante elija su bebida de una lista y la página le muestre el precio de esa bebida al instante, y cuántas opciones cuestan menos de 60 pesos.",
    expectLang: "es",
    expectCalc: true,
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
]);
