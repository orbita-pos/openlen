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

/** Avisa de que la carpeta de ESTE proyecto cambió. */
export function notifyFolderChanged(projectId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FOLDER_CHANGED_EVENT, { detail: { projectId } }));
}

/** Escucha los cambios de la carpeta de ese proyecto. Devuelve cómo dejar de
 *  escuchar. */
export function onFolderChanged(projectId: string, cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const oyente = (ev: Event) => {
    if ((ev as CustomEvent<{ projectId?: unknown }>).detail?.projectId === projectId) cb();
  };
  window.addEventListener(FOLDER_CHANGED_EVENT, oyente);
  return () => window.removeEventListener(FOLDER_CHANGED_EVENT, oyente);
}
