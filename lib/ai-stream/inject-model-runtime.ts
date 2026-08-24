// El injerto del runtime del modelo — SIN una sola importación de Node.
//
// Vive aparte de `model-runtime.ts` porque ese módulo importa `node:vm` (para
// comprobar que el código del modelo compila) y `node-html-parser`, y el
// taller —`components/workspace-v2/preview-area.tsx`, un componente de
// cliente— tiene que injertar EXACTAMENTE igual que el publicador. Mismo
// criterio que `lib/templates/families.ts`: lo que cruza al navegador vive en
// un fichero sin dependencias de servidor.

/**
 * Vuelve a juntar el documento con su cápsula, al final del `<body>`.
 *
 * Al FINAL y no en el `<head>` porque el contrato que se le dio al modelo dice
 * que la página tiene que estar completa sin él: un script que corre antes de
 * que exista el DOM que va a tocar no mejora nada, falla.
 *
 * El marcador `data-openlen-model-runtime` NO viaja al documento resultante. En
 * el HTML servido no confiere autoridad a nadie —la autoridad la dio la cápsula
 * y la CSP la fija por hash— y dejarlo puesto sólo serviría para que alguien lo
 * copiara creyendo que significa algo.
 *
 * Sin `</body>` se pega al final. Un documento así ya pasó por el normalizador,
 * de modo que es un caso que no debería existir; perder el runtime en silencio
 * sería peor que ponerlo donde el navegador lo va a leer igual.
 *
 * VIVE AQUÍ y no en el publicador porque ya tiene tres llamadores: publicar
 * (`lib/publish/filesystem.ts`), los ojos del Agente (`lib/agent/verify.ts`) y
 * la medición del motor (`lib/page-engine/prepare.ts`). Las tres tenían que
 * injertar EXACTAMENTE igual —si los ojos miran un documento armado de otra
 * forma, miran una página que nadie recibe— y hasta ahora eran dos copias
 * escritas a mano.
 */
export function injectModelRuntime(html: string, code: string): string {
  const tag = `<script>${code}</script>`;
  const i = html.toLowerCase().lastIndexOf("</body>");
  return i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
}
