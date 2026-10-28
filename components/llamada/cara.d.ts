// `brand/len-cara/cara.js` es un script de navegador sin tipos que deja el motor
// en `window.LenCara`. Se carga tal cual, sin copiarlo (brand/ no se toca).
declare module "@/brand/len-cara/cara.js";

interface MotorDeCara {
  set(estado: string): void;
  setLook?(look: { cabeza: string; cara: string }, animate?: boolean): void;
}
interface Window {
  LenCara?: {
    create(
      host: HTMLElement,
      o: { props: "all" | "compact" | "none"; state?: string; look?: { cabeza: string; cara: string }; onchange?: (estado: string) => void },
    ): MotorDeCara;
    HEAD: Record<string, string>;
    FACE: Record<string, string>;
    LOOKS: { id: string; name: string; tag: string; cabeza: string; cara: string }[];
    icon(cabeza: string, cara: string): string;
    readonly reduced: boolean;
  };
}
