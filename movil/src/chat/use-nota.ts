// La grabadora de la nota de voz: MediaRecorder + el mismo analizador que el
// halo de la llamada para las barras. Graba lo que el teléfono sepa grabar
// (Android: audio/webm con opus) y para sola a los 2 minutos (`alLimite`).
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { escucharNivel } from "../llamada/halo";
import { barrasDeLaNota } from "./grabadora";

export const MAX_SEGUNDOS = 120;

export interface NotaGrabada {
  audio: Blob;
  /** Para oírla en su burbuja (blob: local). */
  url: string;
  segundos: number;
  barras: number[];
}

interface Grabacion {
  rec: MediaRecorder;
  trozos: Blob[];
  hist: number[];
  desde: number;
  parar: () => void;
  reloj: number;
  corte: number;
}

function formato(): string {
  for (const f of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) if (MediaRecorder.isTypeSupported(f)) return f;
  return "";
}

export function useNota(alLimite: () => void) {
  const [niveles, setNiveles] = useState<number[]>([]);
  const [segundos, setSegundos] = useState(0);
  const g = useRef<Grabacion | null>(null);
  const limite = useRef(alLimite);
  useLayoutEffect(() => {
    limite.current = alLimite;
  });

  const soltar = useCallback(() => {
    const x = g.current;
    if (!x) return;
    x.parar();
    clearInterval(x.reloj);
    clearTimeout(x.corte);
    x.rec.stream.getTracks().forEach((p) => p.stop());
    g.current = null;
    setNiveles([]);
    setSegundos(0);
  }, []);

  const empezar = useCallback(async (): Promise<"ok" | "sinMicro"> => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return "sinMicro";
    }
    const f = formato();
    const rec = new MediaRecorder(stream, f ? { mimeType: f } : undefined);
    const x: Grabacion = { rec, trozos: [], hist: [], desde: performance.now(), parar: () => {}, reloj: 0, corte: 0 };
    rec.ondataavailable = (e) => {
      if (e.data.size) x.trozos.push(e.data);
    };
    let ultimo = 0;
    x.parar = escucharNivel(stream, (n) => {
      const ahora = performance.now();
      if (ahora - ultimo < 90) return;
      ultimo = ahora;
      x.hist.push(n);
      setNiveles(x.hist.slice(-22));
    });
    x.reloj = window.setInterval(() => setSegundos((performance.now() - x.desde) / 1000), 250);
    x.corte = window.setTimeout(() => limite.current(), MAX_SEGUNDOS * 1000);
    rec.start(250);
    g.current = x;
    return "ok";
  }, []);

  const terminar = useCallback(async (): Promise<NotaGrabada | null> => {
    const x = g.current;
    if (!x) return null;
    const parado = new Promise<void>((ok) => {
      x.rec.onstop = () => ok();
    });
    x.rec.stop();
    await parado;
    const segundosGrabados = (performance.now() - x.desde) / 1000;
    const audio = new Blob(x.trozos, { type: x.rec.mimeType || "audio/webm" });
    const hist = x.hist;
    soltar();
    if (audio.size === 0) return null;
    return { audio, url: URL.createObjectURL(audio), segundos: segundosGrabados, barras: barrasDeLaNota(hist) };
  }, [soltar]);

  const cancelar = useCallback(() => {
    const x = g.current;
    if (!x) return;
    x.rec.onstop = null;
    if (x.rec.state !== "inactive") x.rec.stop();
    soltar();
  }, [soltar]);

  return { niveles, segundos, empezar, terminar, cancelar };
}
