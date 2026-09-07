// DESPERTAR LA PÁGINA ANTES DE MIRARLA — un solo programa, los dos ojos.
//
// 🔴 EL FALLO. Una captura de página entera no hace scroll: la ventana mide
// 1280x720 y el documento 7.000px. Todo lo que el modelo revela AL BAJAR se
// fotografía como no existe.
//
// MEDIDO el 2026-09-07 sobre `referencia-calida`, dentro del propio render:
//
//     .service-card → 352x288, maquetada, en y=1391 … opacity: "0"
//
// Tres tarjetas de servicios, con su texto en el DOM y su caja puesta, y la
// foto salió con el titular «Lo que hacemos» encima de un hueco vacío. La
// página puntuó LIMPIA. En un navegador de verdad se ven perfectamente: el
// `IntersectionObserver` dispara al bajar y les pone `opacity: 1`.
//
// ALCANCE: 3 de las 17 páginas del cohorte (18%) usan ese patrón.
//
// A QUIÉN HACE DAÑO. Al visitante NO —baja y lo ve todo—. El daño es a
// NOSOTROS: el crítico con visión y los ojos del Agente juzgan una página que
// parece medio vacía, y el medidor determinista está MUDO justo ahí, porque un
// texto invisible no tiene píxeles que puedan fallar el contraste
// (`unreadable: 0` sobre una sección entera que no se ve).
//
// ⚰️ Y NO ES LA PRIMERA VEZ, es la misma ceguera por otra puerta. El
// 2026-08-30 se midió con `loading="lazy"`: 4 imágenes, 2 pintadas, los ojos
// declararon la página rota y el Agente gastó un ciclo entero «arreglando»
// portadas que el visitante ve bien — 17 créditos. Aquello se tapó poniendo
// `img.loading = "eager"` DENTRO de `inline-image.ts`, y por vivir en un solo
// lado dejó al renderizador de Crear sin el arreglo y a las secciones sin él en
// los dos. Por eso esto nace COMPARTIDO: se recorre la página como la
// recorrería un visitante, y con eso despiertan las dos cosas a la vez.
//
// 🔴 CADENA, NO FUNCIÓN, igual que `PULSAR_CONTROLES`: `page.evaluate` con una
// función nombrada revienta bajo tsx/esbuild —el transformador inyecta el
// ayudante `__name`, que no existe en el navegador— y la evaluación muere con
// un error que no tiene nada que ver con la página. Esta cadena no pasa por
// ningún transformador.
//
// LO QUE NO HACE, a propósito: no fuerza `opacity` a nadie. Poner los elementos
// visibles a mano nos haría ciegos AL REVÉS —una sección que de verdad nace
// invisible pasaría por buena—, y eso es peor que el fallo que arregla. Aquí
// sólo se hace lo que hace una persona: bajar hasta el final y volver.

/** Devuelve `{ pasos, despertados, altura }` — `despertados` son los elementos
 *  que estaban a `opacity: 0` antes de bajar y ya no lo están. Cero significa
 *  que la página no revelaba nada, que es lo normal en la mayoría. */
export const DESPERTAR_LA_PAGINA = `
(async () => {
  const invisibles = () => {
    let n = 0;
    const todos = document.body ? document.body.getElementsByTagName('*') : [];
    const tope = Math.min(todos.length, 3000);
    for (let i = 0; i < tope; i++) {
      if (getComputedStyle(todos[i]).opacity === '0') n++;
    }
    return n;
  };
  const antes = invisibles();

  // Las imágenes perezosas: asignar la propiedad a una que aún no cargó dispara
  // su carga. Se hace SOBRE LA VISTA, que es de usar y tirar — el documento
  // guardado conserva su 'lazy', que para un visitante de verdad es lo correcto.
  const imgs = document.images;
  for (let i = 0; i < imgs.length; i++) imgs[i].loading = 'eager';

  const marco = () => new Promise((r) => requestAnimationFrame(() => r(null)));
  const alto = () => Math.max(
    document.documentElement.scrollHeight,
    document.body ? document.body.scrollHeight : 0,
  );
  const salto = Math.max(200, Math.round(window.innerHeight * 0.8));
  // Tope de pasos: una página de 40.000px no puede tener a los ojos esperando,
  // y con 60 saltos ya se ha recorrido cualquier landing de verdad.
  let pasos = 0;
  for (let y = 0; y <= alto() && pasos < 60; y += salto) {
    window.scrollTo(0, y);
    // DOS marcos: el observador entrega sus llamadas en el siguiente, y el
    // estilo que ponen no se aplica hasta el de despues.
    await marco();
    await marco();
    pasos++;
  }
  window.scrollTo(0, 0);
  await marco();
  await marco();

  return { pasos: pasos, despertados: Math.max(0, antes - invisibles()), altura: alto() };
})()
`;
