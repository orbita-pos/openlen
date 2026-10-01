// `brand/len-cara/cara.js` es un script de navegador sin tipos que deja el motor
// en `window.LenCara`. Se carga tal cual, sin copiarlo (brand/ no se toca).
declare module "@/brand/len-cara/cara.js";

interface MotorDeCara {
  set(estado: string): void;
}
interface Window {
  LenCara?: {
    create(
      host: HTMLElement,
      o: { props: "all" | "compact" | "none"; state?: string; onchange?: (estado: string) => void },
    ): MotorDeCara;
  };
}
