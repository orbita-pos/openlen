// @vitest-environment jsdom
//
// LA CARPETA CAMBIÓ: EL LIENZO SE RECARGA (pieza 9 de Len 2.5, revisión final).
// El lienzo sólo se resube cuando cambia el DOCUMENTO; si Len (o el dueño en el
// editor de código) cambia sólo `js/app.js` o `css/site.css`, el iframe seguía
// con lo de antes. El aviso es de cliente, como el del saldo de créditos.
import { describe, expect, it, vi } from "vitest";
import { notifyFolderChanged, onFolderChanged } from "./carpeta-cambiada";

describe("el aviso de que la carpeta cambió", () => {
  it("🔴 llega a quien escucha ESE proyecto, y a nadie más", () => {
    const mio = vi.fn();
    const otro = vi.fn();
    const quitarMio = onFolderChanged("p1", mio);
    const quitarOtro = onFolderChanged("p2", otro);
    notifyFolderChanged("p1");
    expect(mio).toHaveBeenCalledTimes(1);
    expect(otro).not.toHaveBeenCalled();
    quitarMio();
    quitarOtro();
  });

  it("al dejar de escuchar, ya no llega", () => {
    const cb = vi.fn();
    const quitar = onFolderChanged("p1", cb);
    quitar();
    notifyFolderChanged("p1");
    expect(cb).not.toHaveBeenCalled();
  });
});

// Los eslabones: quien cambia la carpeta lo avisa, y el lienzo lo escucha. El
// que falte no rompe nada: el lienzo simplemente enseña el JavaScript de antes.
describe("🔴 los eslabones del aviso", () => {
  it("lo avisan el chat (evento `ficheros` y Deshacer), el editor de código, y lo escucha el lienzo", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const lee = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
    const chat = lee("components", "workspace-v2", "chat", "use-agent-chat.ts");
    expect(chat).toMatch(/ficherosTocados\.push\(\.\.\.ficherosDelEvento\(payload\)\);\s*notifyFolderChanged\(projectId\)/);
    expect(chat).toMatch(/ficherosRestaurados: \(\) => notifyFolderChanged\(projectId\)/);
    const editor = lee("components", "workspace-v2", "editor-de-fichero.tsx");
    expect(editor).toMatch(/notifyFolderChanged\(projectId\)/);
    const lienzo = lee("components", "workspace-v2", "preview-area.tsx");
    expect(lienzo).toMatch(/onFolderChanged\(projectId,/);
  });
});
