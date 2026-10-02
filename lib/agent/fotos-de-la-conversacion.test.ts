// @vitest-environment node
//
// A (plan 2026-10-01-len-foto-en-la-conversacion, paso 3): las fotos de la
// conversación se consiguen al empezar el turno. Las subidas NUESTRAS en disco
// (desarrollo, sin R2) se leen del disco: por internet son `localhost` y la
// defensa SSRF no las baja — por eso en dev Len no veía ninguna foto.
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { conseguirFotos, rutaDeSubidaPropia } from "./fotos-de-la-conversacion";

const ORIGEN = "http://localhost:3007/api/agent";
const DEV = { UPLOADS_DIR: "./public/uploads" };
const R2 = { R2_ACCOUNT_ID: "a", R2_ACCESS_KEY: "b", R2_SECRET_KEY: "c" };

describe("rutaDeSubidaPropia — las subidas NUESTRAS en disco se leen del disco", () => {
  it("una subida de este mismo servidor → su fichero bajo el almacén", () => {
    // La forma real de dev (01/10): la clave ya lleva `uploads/`.
    expect(rutaDeSubidaPropia("http://localhost:3007/uploads/uploads/anon/a_800w.jpg", ORIGEN, DEV)).toBe(
      resolve("./public/uploads", "uploads/anon/a_800w.jpg"),
    );
    expect(rutaDeSubidaPropia("/uploads/abc/f.jpg", ORIGEN, DEV)).toBe(resolve("./public/uploads", "abc/f.jpg"));
  });

  it("otro servidor, R2, salirse del almacén, no ser imagen u otra ruta → no es nuestra", () => {
    expect(rutaDeSubidaPropia("https://otro.com/uploads/f.jpg", ORIGEN, DEV)).toBeNull();
    expect(rutaDeSubidaPropia("http://localhost:3000/uploads/f.jpg", ORIGEN, DEV)).toBeNull();
    expect(rutaDeSubidaPropia("http://localhost:3007/uploads/f.jpg", ORIGEN, R2)).toBeNull();
    expect(rutaDeSubidaPropia("http://localhost:3007/uploads/%2e%2e/secreto.jpg", ORIGEN, DEV)).toBeNull();
    expect(rutaDeSubidaPropia("http://localhost:3007/uploads/a/%2e%2e/%2e%2e/secreto.jpg", ORIGEN, DEV)).toBeNull();
    expect(rutaDeSubidaPropia("http://localhost:3007/uploads/notas.txt", ORIGEN, DEV)).toBeNull();
    expect(rutaDeSubidaPropia("http://localhost:3007/api/x.jpg", ORIGEN, DEV)).toBeNull();
    expect(rutaDeSubidaPropia("no es una dirección", "tampoco", DEV)).toBeNull();
  });
});

describe("conseguirFotos", () => {
  it("las nuestras se leen del disco; las demás, por internet; cada dirección una sola vez", async () => {
    const leer = vi.fn(async () => Buffer.from("hola"));
    const deInternet = vi.fn(async () => ({ mimeType: "image/png", dataBase64: "RED" }));
    const fotos = await conseguirFotos(
      ["http://localhost:3007/uploads/a.jpg", "https://cdn.com/b.png", "https://cdn.com/b.png"],
      { origen: ORIGEN, env: DEV, leer, deInternet },
    );
    expect(fotos.get("http://localhost:3007/uploads/a.jpg")).toEqual({
      mimeType: "image/jpeg",
      dataBase64: Buffer.from("hola").toString("base64"),
    });
    expect(leer).toHaveBeenCalledWith(resolve("./public/uploads", "a.jpg"));
    expect(fotos.get("https://cdn.com/b.png")).toEqual({ mimeType: "image/png", dataBase64: "RED" });
    expect(deInternet).toHaveBeenCalledTimes(1);
  });

  it("una que falla queda en null y no tumba a las demás", async () => {
    const fotos = await conseguirFotos(["http://localhost:3007/uploads/a.jpg", "https://cdn.com/b.png"], {
      origen: ORIGEN,
      env: DEV,
      leer: async () => {
        throw new Error("no existe");
      },
      deInternet: async () => ({ mimeType: "image/png", dataBase64: "RED" }),
    });
    expect(fotos.get("http://localhost:3007/uploads/a.jpg")).toBeNull();
    expect(fotos.get("https://cdn.com/b.png")).not.toBeNull();
  });

  it("una del disco que pasa de 4 MB no se manda", async () => {
    const fotos = await conseguirFotos(["/uploads/grande.jpg"], {
      origen: ORIGEN,
      env: DEV,
      leer: async () => Buffer.alloc(4 * 1024 * 1024 + 1),
    });
    expect(fotos.get("/uploads/grande.jpg")).toBeNull();
  });

  it("sin direcciones no hace nada", async () => {
    const deInternet = vi.fn();
    expect((await conseguirFotos([], { origen: ORIGEN, deInternet })).size).toBe(0);
    expect(deInternet).not.toHaveBeenCalled();
  });
});
