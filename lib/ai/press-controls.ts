// APRETAR LOS BOTONES — un solo programa, todas las superficies.
//
// Vivía dentro de `lib/ai/inline-image.ts`, que es el render de los OJOS del
// Agente, así que sólo se apretaba al EDITAR. Una página recién creada nunca
// veía un clic: nacía, se fotografiaba y se entregaba. Un botón cuyo manejador
// revienta en la segunda jugada carga limpio, sale perfecto en la captura y no
// dice ni una palabra en consola.
//
// Se saca aquí para que el motor de la página (`lib/page-engine/prepare.ts`, que
// comparten crear, el Chat y el Agente) apriete EXACTAMENTE lo mismo. Dos
// programas parecidos derivan; uno compartido no puede.
//
// 🔴 CADENA, NO FUNCIÓN. `page.evaluate` con una función nombrada revienta bajo
// tsx/esbuild: el transformador inyecta el ayudante `__name`, que no existe
// dentro del navegador, y la evaluación muere con un error que no tiene nada
// que ver con la página. Ya costó una sesión ([[render-measured-contrast]]).
// Esta cadena no pasa por ningún transformador.
//
// SE PULSA POR ETIQUETA, no por quién tenga un `click` atado. El primer intento
// envolvía `addEventListener` desde `evaluateOnNewDocument` para marcar
// exactamente lo que el modelo cableaba — y MEDIDO: no corría nunca.
// `page.setContent` usa `document.write`, que no crea un documento nuevo, así
// que el enganche no llega a instalarse. Pulsar lo que pulsaría un visitante es
// además lo honesto: si un botón no tiene nada atado, no pasa nada; si lo tiene
// y revienta, nos enteramos.
//
// Tope de ocho: con eso ya se sabe si los controles viven, y cada clic puede
// disparar trabajo arbitrario del modelo.
export const PULSAR_CONTROLES = `
(() => {
  // Un clic que navega se lleva la página y con ella la medición. Se impide
  // sólo la ACCIÓN por defecto: los manejadores del modelo corren igual, que es
  // justo lo que se quiere comprobar.
  //
  // LA EXCEPCIÓN, copiada de sus dos hermanos (lib/agent/behavior-spec.ts y
  // lib/agent/prueba-js.ts, que la recibieron en b8fcf26e). Cancelar la acción
  // por defecto de un clic sobre \`type="submit"\` impide que el navegador
  // dispare el \`submit\` del formulario, y ahí es donde el modelo engancha su
  // manejador. Sin ella este pase pulsaba el botón y no ejercitaba NADA: un
  // formulario cuya lógica vive en \`submit\` pasaba por sano sin haberse
  // ejecutado, y sus errores no llegaban a contarse. No hacía falta parar la
  // navegación aquí: ya la para el listener de \`submit\` de la línea siguiente.
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest("button,input") : null;
    if (t && t.form && t.type === "submit") return;
    e.preventDefault();
  }, true);
  document.addEventListener("submit", function (e) { e.preventDefault(); }, true);
  const nodos = Array.from(
    document.querySelectorAll("button, [role=button], a[href], input[type=submit], summary, [data-ol-behavior]")
  ).slice(0, 8);
  // DOS rondas, no una. MEDIDO: pulsando una sola vez, un contador que cachea
  // \`{1:'uno'}\` y falla en la jugada 2 pasaba como sano — que es exactamente
  // el fallo que este detector existe para ver. La segunda ronda cuesta unos
  // milisegundos y encuentra los estados que sólo aparecen jugando.
  for (let ronda = 0; ronda < 2; ronda++) {
    for (const n of nodos) {
      try {
        n.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      } catch (e) {}
    }
  }
  return nodos.length;
})();
`;
