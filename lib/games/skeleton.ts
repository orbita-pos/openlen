// WHAT A GAME IS BORN WITH (spec local 2026-11-05-modo-juego-design, §8.3): the app's skeleton without its router
// and its backend client, full screen, and WITHOUT an engine — Len picks three or Phaser from what the person
// asks for, and importing it installs it (as Claude Code and Kimi Code run `npm install` when they need one). It
// stays React + TypeScript because Phaser's own official template is (`phaserjs/template-react-ts`): screens and
// HUD in React, the game in its canvas.
//
// 🔴 Nothing here invents a format: no loop, input layer or hooks of our own. What the canvas draws is a
// placeholder, like an app's «Inicio» screen: it is there to compile, start and be seen, and Len replaces it.
//
// Pure: no disk, no network. `born-as-game.ts` writes it.

import { CATALOGO_ACTUAL } from "@/lib/apps/dependencias";
import { cascaronDeLaApp, ENTRADA, esqueletoDeApp } from "@/lib/apps/esqueleto";
import { catalogRange, serializePackageJson } from "@/lib/apps/npm/lock";
import { PACKAGE_JSON_PATH } from "@/lib/apps/npm/paths";
import type { AppDeProyecto } from "@/lib/projects/types";

import type { GameOfProject } from "./types";

const MAIN = `import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(<App />);
`;

const APP = `import Game from "./game/Game";

export default function App() {
  return (
    <main className="h-full w-full overflow-hidden bg-slate-950">
      <Game />
    </main>
  );
}
`;

function gameComponent(title: string): string {
  return `import { useEffect, useRef } from "react";

const TITLE = ${JSON.stringify(title)};

// A placeholder: a full-screen canvas whose loop draws the title. The game replaces it.
export default function Game() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * ratio);
      canvas.height = Math.round(canvas.clientHeight * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    let frame = 0;
    const draw = (time: number) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.fillStyle = "#020617";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "600 32px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(TITLE, w / 2, h / 2 + Math.sin(time / 500) * 8);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="block h-full w-full" style={{ touchAction: "none" }} />;
}
`;
}

export function gameSkeleton(o: { readonly title: string; readonly locale: string }): {
  html: string;
  files: Record<string, string>;
  app: AppDeProyecto;
  game: GameOfProject;
} {
  const title = o.title.trim().slice(0, 120) || "Game";
  // The app's skeleton underneath (its catalog and entry); its router, screens and backend client stay out.
  const app = esqueletoDeApp({ titulo: title, idioma: o.locale });
  return {
    html: cascaronDeLaApp({ titulo: title, idioma: o.locale, pantallaCompleta: true }),
    app: app.app,
    game: { bornAt: new Date().toISOString() },
    files: {
      [ENTRADA]: MAIN,
      "/src/App.tsx": APP,
      "/src/game/Game.tsx": gameComponent(title),
      [PACKAGE_JSON_PATH]: serializePackageJson({
        name: "game",
        private: true,
        type: "module",
        dependencies: Object.fromEntries(["react", "react-dom"].map((n) => [n, catalogRange(CATALOGO_ACTUAL, n)])),
      }),
    },
  };
}
