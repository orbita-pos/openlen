import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CajaMenciones, TextoMenciones } from "./menciones";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement;
afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); });
const personas = [{ userId: "u2", nombre: "Luis Pérez" }];
it("ofrece la persona al escribir @Lu y la inserta sin enviar el mensaje", async () => {
  const cambio = vi.fn(), enviar = vi.fn(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<CajaMenciones value="@Lu" onChange={cambio} personas={personas} conLen={true} label="Mensaje" placeholder="Escribe" onEnviar={enviar} />));
  const textarea = host.querySelector("textarea")!; textarea.setSelectionRange(3, 3);
  act(() => textarea.dispatchEvent(new Event("select", { bubbles: true })));
  const opcion = [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(b => b.textContent?.includes("Luis Pérez"));
  expect(opcion).toBeDefined(); act(() => opcion!.click());
  expect(cambio).toHaveBeenCalledWith("@Luis Pérez "); expect(enviar).not.toHaveBeenCalled();
});
it("no ofrece @Len a lectores y pinta las menciones como texto, sin HTML", async () => {
  host = document.createElement("div"); root = createRoot(host);
  await act(async () => root.render(<><CajaMenciones value="@" onChange={vi.fn()} personas={personas} conLen={false} label="Mensaje" placeholder="" onEnviar={vi.fn()} /><TextoMenciones texto="<img src=x> @Luis Pérez" personas={personas} /></>));
  const textarea = host.querySelector("textarea")!; textarea.setSelectionRange(1, 1); act(() => textarea.dispatchEvent(new Event("select", { bubbles: true })));
  expect(host.querySelector('[role="option"]')?.textContent).not.toBe("Len");
  expect(host.querySelector('img')).toBeNull(); expect(host.querySelector('[data-mencion="persona"]')?.textContent).toBe("@Luis Pérez");
});
