"use client";

// LA CAJA ESCRIBE SOLA (04/10). Mientras la caja del héroe está vacía y nadie
// la toca, teclea encargos de verdad, los borra y escribe el siguiente, como si
// alguien se los estuviera pidiendo a Len. En cuanto el visitante entra en la
// caja, se calla y la caja es suya. Con movimiento reducido no teclea: deja la
// primera frase quieta.
import { useEffect, useState } from "react";

const START_MS = 900;
const HOLD_MS = 1900;
const NEXT_MS = 450;
const ERASE_MS = 14;

export function useGhostTyping(lines: readonly string[], active: boolean) {
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  // Las frases llegan de next-intl y su array puede ser otro en cada render;
  // la clave es su contenido.
  const key = lines.join("\n");

  useEffect(() => {
    const all = key ? key.split("\n") : [];
    if (!active || all.length === 0) {
      setText("");
      setTyping(false);
      return;
    }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setText(all[0]!);
      return;
    }

    let line = 0;
    let i = 0;
    let phase: "type" | "erase" = "type";
    let timer: number;

    const tick = () => {
      const full = all[line]!;
      if (phase === "type") {
        i += 1;
        setText(full.slice(0, i));
        setTyping(true);
        if (i >= full.length) {
          phase = "erase";
          setTyping(false);
          timer = window.setTimeout(tick, HOLD_MS);
          return;
        }
        // Un pulso irregular: a ritmo fijo se lee como máquina.
        timer = window.setTimeout(tick, 34 + Math.random() * 46);
        return;
      }
      i = Math.max(0, i - 2);
      setText(full.slice(0, i));
      if (i === 0) {
        phase = "type";
        line = (line + 1) % all.length;
        timer = window.setTimeout(tick, NEXT_MS);
        return;
      }
      timer = window.setTimeout(tick, ERASE_MS);
    };

    timer = window.setTimeout(tick, START_MS);
    return () => {
      window.clearTimeout(timer);
      setTyping(false);
    };
  }, [active, key]);

  return { text, typing };
}
