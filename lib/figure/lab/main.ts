// The lab's page (see scripts/figure-lab.mjs). Local only: nothing of the app imports it.
import { DEFAULT_LOOK, FIGURE_COLORS, FIGURE_SHAPES, offered, type FigureCategory, type FigureLook } from "../look";
import { curatedLook } from "../random";
import { flatFigureSvg } from "../flat";
import { createFigure, type Figure, type FigureActivity } from "../engine/index";

const ACTIVITIES: FigureActivity[] = ["ready", "listening", "thinking", "working", "talking", "asleep", "error"];
const LABELS: Record<string, string> = { shape: "Forma", eyes: "Ojos", eyewear: "Gafas", accessory: "Accesorio", activity: "Actividad", color: "Color" };
const SMALL = [96, 72, 44];

let look: FigureLook = { ...DEFAULT_LOOK };
let activity: FigureActivity = "ready";
let reduced = false;
const figures: Figure[] = [];
const flats: { element: HTMLElement; size: number }[] = [];
const $ = (id: string) => document.getElementById(id)!;

function live(canvas: HTMLCanvasElement): void {
  // What a host does when the engine gives up (no WebGL2, context lost, device too slow): the flat figure takes over.
  const size = canvas.clientWidth || 96;
  const fallBack = (): void => {
    const flat = Object.assign(document.createElement("span"), { title: "plana: el motor se rindió en este dispositivo" });
    flat.style.outline = "1px dashed #c00";
    flats.push({ element: flat, size });
    flat.innerHTML = flatFigureSvg(look, size);
    canvas.replaceWith(flat);
  };
  const figure = createFigure(canvas, look, { activity, reducedMotion: reduced, onLost: fallBack });
  if (figure) figures.push(figure);
  else fallBack();
}

function buildStage(): void {
  live($("hero") as HTMLCanvasElement);
  for (const tone of ["light", "tint", "dark"]) {
    const row = document.createElement("div");
    row.className = `row ${tone}`;
    for (const size of SMALL) {
      const cell = document.createElement("div");
      cell.className = "cell";
      const pair = document.createElement("div");
      pair.className = "pair";
      const canvas = document.createElement("canvas");
      canvas.style.cssText = `width:${size}px;height:${size}px`;
      const flat = document.createElement("span");
      flats.push({ element: flat, size });
      pair.append(canvas, flat);
      cell.append(pair, `${size} px · viva y plana`);
      row.append(cell);
      live(canvas);
    }
    $("rows").append(row);
  }
}

function refresh(): void {
  for (const figure of figures) figure.setLook(look);
  for (const { element, size } of flats) element.innerHTML = flatFigureSvg(look, size);
  $("grid").innerHTML = FIGURE_SHAPES.map((shape) => flatFigureSvg({ ...look, shape }, 56)).join("");
  ($("color") as HTMLInputElement).value = look.color;
  document.documentElement.style.setProperty("--tint", `color-mix(in srgb, ${look.color} 16%, white)`);
  for (const button of document.querySelectorAll<HTMLButtonElement>("#controls button")) {
    const { key, value } = button.dataset;
    button.setAttribute("aria-pressed", String(key === "activity" ? value === activity : (look as unknown as Record<string, string>)[key!] === value));
  }
}

function options(key: string, values: readonly string[], pick: (value: string) => void): void {
  const box = document.createElement("div");
  box.innerHTML = `<div class="label">${LABELS[key]}</div>`;
  const row = document.createElement("div");
  row.className = "options";
  for (const value of values) {
    const button = document.createElement("button");
    button.dataset.key = key;
    button.dataset.value = value;
    if (key === "color") {
      button.className = "swatch";
      button.style.background = value;
      button.title = value;
    } else button.textContent = value;
    button.onclick = () => {
      pick(value);
      refresh();
    };
    row.append(button);
  }
  box.append(row);
  $("controls").append(box);
}

for (const category of ["shape", "eyes", "eyewear", "accessory"] as FigureCategory[]) options(category, offered(category), (value) => (look = { ...look, [category]: value } as FigureLook));
options("color", FIGURE_COLORS, (value) => (look = { ...look, color: value }));
options("activity", ACTIVITIES, (value) => {
  activity = value as FigureActivity;
  for (const figure of figures) figure.setActivity(activity);
});
$("color").oninput = (event) => {
  look = { ...look, color: (event.target as HTMLInputElement).value };
  refresh();
};
$("surprise").onclick = () => {
  look = curatedLook(Math.floor(Math.random() * 2 ** 31));
  refresh();
};
$("reduced").onclick = () => {
  reduced = !reduced;
  $("reduced").setAttribute("aria-pressed", String(reduced));
  for (const figure of figures) figure.setReducedMotion(reduced);
};
addEventListener("pointermove", (event) => {
  const box = $("hero").getBoundingClientRect();
  figures[0]?.lookAt((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
});

buildStage();
refresh();

// The contact sheet: every shape as the engine captures it, bare and dressed. What gets sent to Jesús.
const DRESSED: Partial<FigureLook>[] = [
  { accessory: "beret" }, { accessory: "headphones", eyes: "smile" }, { accessory: "crown", eyewear: "shades" }, { accessory: "hat", eyewear: "round" },
  { accessory: "bow", eyes: "round" }, { accessory: "beanie", eyes: "sleepy" }, { accessory: "none", eyes: "dot", eyewear: "round" }, { accessory: "beret", eyes: "smile" },
];
function sheet(): void {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;left:-999px;width:160px;height:160px";
  document.body.append(canvas);
  const figure = createFigure(canvas, look);
  const out = $("sheet") as HTMLCanvasElement;
  const SIZE = 160;
  out.width = SIZE * 8;
  out.height = SIZE * 2;
  const pen = out.getContext("2d")!;
  pen.clearRect(0, 0, out.width, out.height);
  FIGURE_SHAPES.forEach((shape, i) => {
    for (const [row, extra] of [[0, {}], [1, DRESSED[i]!]] as const) {
      figure?.setLook({ ...look, eyewear: "none", accessory: "none", eyes: "oval", shape, color: FIGURE_COLORS[i % FIGURE_COLORS.length]!, ...extra });
      const image = figure?.capture(SIZE);
      if (image) pen.putImageData(image, i * SIZE, row * SIZE);
    }
  });
  figure?.destroy();
  canvas.remove();
}
$("sheetButton").onclick = sheet;

let frames = 0;
let since = performance.now();
(function count() {
  frames++;
  const now = performance.now();
  if (now - since > 500) {
    $("stats").textContent = `${Math.round((frames * 1000) / (now - since))} cuadros por segundo\n${figures.length} figuras vivas a la vez\npantalla ×${devicePixelRatio}
calidad ${figures[0]?.quality ?? "-"} de 2`;
    frames = 0;
    since = now;
  }
  requestAnimationFrame(count);
})();
