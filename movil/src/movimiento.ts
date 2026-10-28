export const movimientoReducido = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Sólo la app móvil: mantiene la cara y el CSS al día si cambia Android. */
export function seguirMovimientoDelTelefono() {
  const preferencia = matchMedia("(prefers-reduced-motion: reduce)");
  const aplicar = () => {
    document.documentElement.classList.toggle("len-reduced", preferencia.matches);
    const cara = window.LenCara as { setReduced?: (reducir: boolean) => void } | undefined;
    cara?.setReduced?.(preferencia.matches);
  };
  aplicar();
  preferencia.addEventListener("change", aplicar);
  return () => preferencia.removeEventListener("change", aplicar);
}
