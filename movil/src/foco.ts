/** Al terminar una salida, no quitarle el foco a una pantalla más reciente. */
export function devolverFoco(previo: HTMLElement | null) {
  if (!previo?.isConnected) return;
  const actual = document.activeElement;
  if (actual instanceof HTMLElement && actual !== document.body && !actual.closest('[inert],.app-panel-motion.is-exiting')) return;
  const superior = document.querySelector('.app-panel-motion:not(.is-exiting)') ?? document.querySelector('.lm-layer.lm-chat.is-on');
  if (superior && !superior.contains(previo)) return;
  previo.focus({ preventScroll: true });
}
