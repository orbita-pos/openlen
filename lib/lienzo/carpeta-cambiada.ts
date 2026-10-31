// LA CARPETA CAMBIÓ: EL LIENZO SE RECARGA (pieza 9 de Len 2.5).
//
// DE CLIENTE, sin nada de servidor: lo importan el chat, el editor de código y
// el lienzo (`preview-area.tsx`). El lienzo sólo se resube cuando cambia el
// DOCUMENTO, y un cambio de `js/app.js` o `css/site.css` no lo cambia: el
// iframe seguía corriendo lo de antes. Quien cambia la carpeta lo avisa; el
// lienzo recarga el mismo documento, que vuelve a pedir sus ficheros (el host
// del lienzo los sirve sin caché). Un evento de `window`, como el del saldo de
// créditos (`notifyCreditBalanceChanged`): sin cablear props por cinco ficheros.

export const FOLDER_CHANGED_EVENT = "openlen:folder-changed";

/** Avisa de que la carpeta de ESTE proyecto cambió. `outside`: desde fuera de
 *  los caminos que la pestaña ya sigue (el turno de Len, el editor), como el
 *  arreglo de Len Watch traído en el servidor: la lente Código vuelve a pedir
 *  la lista sólo entonces (pedirla en cada escritura de Len la traería entera). */
export function notifyFolderChanged(projectId: string, o: { outside?: boolean } = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FOLDER_CHANGED_EVENT, { detail: { projectId, outside: o.outside === true } }));
}

/** Escucha los cambios de la carpeta de ese proyecto. Devuelve cómo dejar de
 *  escuchar. */
export function onFolderChanged(projectId: string, cb: (cambio: { outside: boolean }) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const oyente = (ev: Event) => {
    const detail = (ev as CustomEvent<{ projectId?: unknown; outside?: unknown }>).detail;
    if (detail?.projectId === projectId) cb({ outside: detail.outside === true });
  };
  window.addEventListener(FOLDER_CHANGED_EVENT, oyente);
  return () => window.removeEventListener(FOLDER_CHANGED_EVENT, oyente);
}
