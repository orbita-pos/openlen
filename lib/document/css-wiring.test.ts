import { describe, expect, it } from "vitest";

import { avisoReglasMuertas, reglasQueNuncaAplican } from "./css-wiring";

// EL CASO REAL, copiado del pomodoro que generó el modelo el 2026-08-23.
// El CSS y el markup existen los dos; lo que falta es `class="timer-ring"` en
// el contenedor, así que las reglas del anillo nunca aplican y los <circle>
// salen NEGROS (el `fill` por defecto de SVG).
const POMODORO = `<!doctype html><html><head><style>
  .surface { background: var(--surface); border-radius: 1rem; }
  .timer-ring { background: radial-gradient(circle at center, var(--surface) 60%, transparent 61%); }
  .timer-ring .progress-ring { stroke: var(--accent); stroke-linecap: round; fill: none; }
  .timer-ring .track-ring { stroke: var(--border); fill: none; }
  .progress-ring { transition: stroke-dashoffset 0.4s linear; }
</style></head><body>
  <div class="surface p-8">
    <div class="relative w-56 h-56 mx-auto my-8">
      <svg viewBox="0 0 100 100">
        <circle class="track-ring" cx="50" cy="50" r="45"></circle>
        <circle id="progressCircle" class="progress-ring" cx="50" cy="50" r="45"></circle>
      </svg>
    </div>
  </div>
</body></html>`;

describe("el anillo negro del pomodoro", () => {
  it("caza las DOS reglas que no pueden aplicar", () => {
    const r = reglasQueNuncaAplican(POMODORO);
    const selectores = r.map((x) => x.selector);
    expect(selectores).toContain(".timer-ring .progress-ring");
    expect(selectores).toContain(".timer-ring .track-ring");
  });

  it("nombra la clase que falta y la que sí está — el arreglo, no el síntoma", () => {
    const r = reglasQueNuncaAplican(POMODORO).find((x) => x.selector.includes("track-ring"))!;
    expect(r.ausentes).toEqual(["timer-ring"]);
    expect(r.presentes).toEqual(["track-ring"]);
  });

  it("y NO acusa a `.timer-ring` a secas ni a `.progress-ring` a secas", () => {
    // `.timer-ring {}` suelto es CSS de sobra: nadie prometió nada.
    // `.progress-ring {}` suelto SÍ aplica. Ninguno es un defecto.
    const sueltos = reglasQueNuncaAplican(POMODORO).map((x) => x.selector);
    expect(sueltos).not.toContain(".timer-ring");
    expect(sueltos).not.toContain(".progress-ring");
    expect(sueltos).not.toContain(".surface");
  });

  it("el aviso dice qué añadir y POR QUÉ importa", () => {
    const aviso = avisoReglasMuertas(reglasQueNuncaAplican(POMODORO));
    expect(aviso).toContain("timer-ring");
    expect(aviso).toContain("NEGRO");
  });

  it("con la clase puesta, cero avisos — es el arreglo, verificado", () => {
    const arreglado = POMODORO.replace(
      'class="relative w-56 h-56 mx-auto my-8"',
      'class="relative w-56 h-56 mx-auto my-8 timer-ring"',
    );
    expect(reglasQueNuncaAplican(arreglado)).toEqual([]);
  });
});

describe("lo que NO puede acusar — cada falso positivo enseña a ignorar el aviso", () => {
  it("una clase que el JavaScript añade en caliente es correcta", () => {
    const html = `<html><head><style>.panel.abierto{display:block}</style></head><body><div class="panel"></div></body></html>`;
    const js = `document.querySelector(".panel").classList.add("abierto");`;
    expect(reglasQueNuncaAplican(html, js)).toEqual([]);
    // Sin el runtime delante, el mismo documento SÍ se acusa — que es justo
    // por lo que la firma lo lleva.
    expect(reglasQueNuncaAplican(html)).toHaveLength(1);
  });

  it("los carriers de tema de OpenLen no se auditan: no los escribió el modelo", () => {
    const html = `<html><head><style data-ol-color>.dark .foo{color:#fff}</style></head><body><p class="foo">x</p></body></html>`;
    expect(reglasQueNuncaAplican(html)).toEqual([]);
  });

  it("un documento sin <style> propio no paga nada", () => {
    expect(reglasQueNuncaAplican(`<html><body><p class="x">hola</p></body></html>`)).toEqual([]);
  });

  it("las pseudo-clases no son clases", () => {
    const html = `<html><head><style>.btn:hover{opacity:.9}.btn::after{content:""}</style></head><body><a class="btn">x</a></body></html>`;
    expect(reglasQueNuncaAplican(html)).toEqual([]);
  });
});

describe("el escaneo del CSS aguanta lo que el modelo escribe de verdad", () => {
  it("dentro de un @media sigue viendo los selectores", () => {
    const html = `<html><head><style>@media (min-width:640px){.envoltorio .pieza{gap:2rem}}</style></head><body><span class="pieza">x</span></body></html>`;
    expect(reglasQueNuncaAplican(html)[0]?.ausentes).toEqual(["envoltorio"]);
  });

  it("un comentario con llaves dentro no rompe el escaneo", () => {
    const html = `<html><head><style>/* nota { con llave } */ .caja .parte{color:red}</style></head><body><i class="parte">x</i></body></html>`;
    expect(reglasQueNuncaAplican(html)[0]?.ausentes).toEqual(["caja"]);
  });

  it("una lista `a, b` se juzga miembro a miembro", () => {
    const html = `<html><head><style>.viva .hija, .muerta .hija{color:red}</style></head><body><b class="viva"><i class="hija">x</i></b></body></html>`;
    const r = reglasQueNuncaAplican(html);
    expect(r).toHaveLength(1);
    expect(r[0].selector).toBe(".muerta .hija");
  });

  it("no arrastra declaraciones al selector siguiente", () => {
    const html = `<html><head><style>.a{color:red}.b .c{color:blue}</style></head><body><p class="a c">x</p></body></html>`;
    expect(reglasQueNuncaAplican(html).map((r) => r.selector)).toEqual([".b .c"]);
  });
});
