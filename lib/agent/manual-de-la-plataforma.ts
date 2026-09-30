// lib/agent/manual-de-la-plataforma.ts — el texto de /AGENTS.md, y cómo se adjunta.
//
// PASO 7 DE LEN 2.5 (2026-09-29, OK de Jesús). El prompt de Len mezclaba dos
// cosas: CÓMO TRABAJAR (conducta: alcance, probar, preguntar, no inventar) y
// CÓMO FUNCIONA OPENLEN (los contratos que el modelo no puede adivinar: dónde se
// guarda cada cosa, el `/api/d`, los formularios, los enlaces, los almacenes,
// la guía de diseño, las librerías). Claude Code las separa igual: su prompt de
// sistema es conducta, y lo del proyecto y de la organización llega en sus
// ficheros de instrucciones (`CLAUDE.md`, `AGENTS.md`, el gestionado), que el
// ARNÉS adjunta al principio de la conversación. DeepSeek no cargaría nada por
// su cuenta (abrió la lista 1 vez de 57), así que lo adjunta el arnés siempre.
//
// El texto se MOVIÓ, no se reescribió: las mismas secciones, con las mismas
// palabras, y las tres transformaciones de antes (el contrato mínimo, las
// cláusulas del JavaScript y el contrato dicho para Len) aplicadas aquí, que es
// donde ahora viven sus marcas. Lo que cambia es el sitio. Quitar o mover texto
// del prompt es una hipótesis: se mide en la medición única de Len-Bench.
//
// POR QUÉ AL PRINCIPIO Y NO EN EL ÚLTIMO MENSAJE. El contexto de Len va en el
// último mensaje porque cambia en cada petición. El manual no cambia: justo
// después del prompt de sistema forma parte del prefijo fijo, y se lee de
// caché. Es también donde Claude Code pone sus ficheros de instrucciones.

import { PUBLISH_CONTRACT } from "@/lib/design-guidance";
import { swapJsClauses } from "@/lib/ai/js-clause";
import { conContratoMinimo, contratoParaSuperficie } from "@/lib/publish-contract-min";
import { bloqueDeLibrerias } from "@/lib/librerias";
import { PRINCIPIO_DEL_ADJUNTO } from "@/lib/agent/ficheros/manual";

/** El contenido de /AGENTS.md: lo que Read devuelve y lo que se adjunta. */
export function buildManualDeLaPlataforma(): string {
  const manual = `# OpenLen: cómo funciona la plataforma

LO QUE HAY Y LO QUE NO:
- Lo guardado con localStorage SOBREVIVE a cerrar la pestaña y el navegador; lo que no hace es viajar a otro dispositivo, a otro visitante ni al usuario. Lo guardado en un ALMACÉN vive en el servidor: en modo propio cada visitante ve lo suyo, y el usuario lo ve todo en el editor, en la vista «Datos» (no en la Bandeja, que es la de los formularios). Decirle «se guarda en el navegador» de algo que guardaste en un almacén es mentirle.
- Los formularios funcionan: lo que envía el visitante llega al correo del usuario y a su Bandeja (cómo se escribe uno, en la guía de abajo). Cuando haga falta que le escriban, ofrece el formulario; el WhatsApp o el chat, además, no en su lugar.
- OpenLen NO ejecuta JavaScript de la página: ESTA LÍNEA NO LA LEE EL MODELO — es la MARCA de la cláusula \`agente\` y \`swapJsClauses\` la sustituye entera, del guion al salto de línea, por la versión permisiva (lib/ai/js-clause.ts). El texto tiene que quedarse porque el intercambio LANZA si no encuentra su marca. Lo sujeta lib/agent/catalog.test.ts, que exige que esta frase NO salga en el prompt montado.
- LO QUE DE VERDAD NO SE PUEDE, y es poco: cobrar con tarjeta DENTRO de la página (no hay pasarela: se cobra con el enlace de pago del usuario, como arriba, o por WhatsApp o transferencia), que el usuario se entere de lo que el visitante hizo en su navegador (para eso está el formulario) y mandar correos por tu cuenta.

ENLACES (<a href>):
- Las URLs que te da son datos reales suyos: van al href VERBATIM, carácter por carácter, con su query string y sus mayúsculas.
- ABSOLUTAS, SIEMPRE: «instagram.com/juan» o «@juan» se completan a https://instagram.com/juan. Un href sin esquema es una ruta RELATIVA del propio sitio, y el fallo es SILENCIOSO: el servidor vuelve a servir la home con 200 y el visitante aterriza en la misma página. mailto: y tel: también valen.
- INTERNAS: la ruta "/<slug>" de su fichero /<slug>/index.html (p. ej. /menu); jamás "menu.html" ni "menu" a secas, que caen en el mismo fallback silencioso a la home. La portada es "/".
- ANCLAS ("#precios"): sólo si ese id EXISTE en la página de destino; si no, créalo en la misma edición.

ALMACENES (los datos de la página, en /datos):
Un ALMACÉN guarda datos de verdad en el servidor —un plato del menú, un producto del catálogo, una reseña— y sobrevive a recargas y a republicaciones. Se DECLARA en la página, con Edit: un bloque \`<script type="application/json" data-ol-stores>\` dentro del <body>, fuera de cualquier sección que se pueda borrar, que dice qué campos tiene y quién puede tocarlos. Su forma: {"menu":{"visitante":"lectura","campos":{"plato":"texto","precio":"numero"}}}. \`visitante\` es "lectura" (lo mantienes tú, el visitante sólo lo lee — el caso normal de un menú o un catálogo), "propio" (cada visitante escribe y lee LO SUYO — un carrito), "publico" (cualquiera escribe y TODOS lo leen — RESEÑAS, comentarios, un muro: se publica al momento y lo ve todo el mundo, como en Mercado Libre) o "añadir" (el visitante crea y NO lee lo de otros — un formulario de inscripción, donde lo que cada uno deja es privado). Los tipos son texto, numero, booleano, fecha y lista.
Declarado, cada almacén es un FICHERO: /datos/<almacén>.json, la lista de sus filas con su id. Léelo con Read y cámbialo con Edit o Write como cualquier fichero: una fila sin id es nueva, la que cambias se actualiza y la que quitas se borra. Todo se comprueba antes de guardar nada —un campo que el almacén no declara, o un valor del tipo equivocado, te vuelve como error—. Si el almacén no existe todavía, declara el bloque con Edit y escribe su fichero en el MISMO turno. Para que el contenido de un almacén "lectura" se vea en la página publicada, deja un contenedor con data-ol-datos="<nombre>" donde quieras que salga.

GUÍA DE DISEÑO (para las páginas que creas tú y para el rediseño que te pidan; lo que añades a una página que ya existe se escribe como ella):
${PUBLISH_CONTRACT}

${bloqueDeLibrerias({ dondeVaElScript: "libre" })}`;

  // Las tres transformaciones que antes se aplicaban al prompt entero, en el
  // mismo orden y con el mismo nombre de quien las pide: sus marcas viven
  // ahora aquí. 🔴 EL CONTRATO MÍNIMO porque esto se paga en cada petición.
  const quien = "buildManualDeLaPlataforma";
  const { prompt: recortado, min } = conContratoMinimo(manual, quien);
  const conClausulas = swapJsClauses(
    recortado,
    min ? ["agente", "contrato-min"] : ["agente", "contrato-completo", "conductas"],
  );
  if (!min) return conClausulas;
  // EL CONTRATO, DICHO PARA LEN (2026-09-04). Va DESPUÉS de `swapJsClauses` a
  // propósito: la viñeta del JavaScript se retira en su versión ya
  // intercambiada, y hacerlo antes dejaría al intercambio sin su marca.
  return contratoParaSuperficie(conClausulas, quien, {
    // La respuesta de Len son llamadas a herramientas más prosa para el
    // usuario. El contrato decía «el primer carácter de tu respuesta es `<`».
    respuestaEsElDocumento: false,
    // Una página nace con un Write a /<slug>/index.html; un enlace no crea nada.
    elEnlaceCreaLaPagina: false,
    // El JavaScript y los enlaces los cubren sus secciones de arriba, con más
    // precisión que el contrato; `data-slot-path` no lo dice ninguna de las
    // dos, porque Write y Edit lo rechazan con su error.
    yaLoDiceLaSuperficie: ["javascript", "enlaces", "data-slot-path"],
    // Len edita documentos que ya traen su `<head>`, y una página nueva la
    // escribe leyendo antes /index.html: «añade dentro, no dupliques» es la
    // orden que le sirve en los dos casos.
    escribeElHead: false,
    // Lo que añade a una página que ya existe se escribe como ella («CÓMO
    // TRABAJAR»); la guía manda en lo que crea (H8).
    laGuiaEsParaLoQueCrea: true,
    // Dos reglas que protegían al editor de defectos suyos, ya arreglados
    // (2026-09-29, OK de Jesús): el prefijo `--ol-` obligatorio y «enlaza
    // Spotify, que el editor borra el iframe». Ver `ReglaRetirada`.
    retira: ["vocabulario-ol", "iframes-que-borraba-el-editor"],
  });
}

/** El mensaje que el arnés pone justo después del prompt de sistema. */
export function adjuntoDelManual(manual: string = buildManualDeLaPlataforma()): string {
  return `${PRINCIPIO_DEL_ADJUNTO}

${manual.trim()}

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.
</system-reminder>
`;
}
