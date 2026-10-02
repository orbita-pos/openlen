// @vitest-environment node
//
// A (plan 2026-10-01-len-foto-en-la-conversacion, paso 3): las fotos de la
// conversación se consiguen al empezar el turno. Las subidas NUESTRAS en disco
// (desarrollo, sin R2) se leen del disco: por internet son `localhost` y la
// defensa SSRF no las baja — por eso en dev Len no veía ninguna foto.
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { conseguirFotos, fotosQueCaben, PRESUPUESTO_FOTOS_BYTES, rutaDeSubidaPropia } from "./fotos-de-la-conversacion";
import { NO_CABE } from "./transcripcion";

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

// Como DeepSeek (`requiredImageOffload`, su nota «durable image offload»): la
// petición tiene un presupuesto de imagen; si no caben, las MÁS VIEJAS pierden
// los píxeles y el turno sigue. Aquí conservan su dirección en la nota.
describe("fotosQueCaben — las más viejas pierden los píxeles, no el turno", () => {
  const foto = (chars: number) => ({ mimeType: "image/jpeg", dataBase64: "A".repeat(chars) });

  it("caben todas: no cambia nada", () => {
    const fotos = new Map([["nueva", foto(10)], ["vieja", foto(10)]]);
    expect(fotosQueCaben(["nueva", "vieja"], fotos, 20)).toEqual(fotos);
  });

  it("se quedan las más nuevas; a partir de la primera que no cabe, ella y las más viejas pierden los píxeles", () => {
    const fotos = new Map([["nueva", foto(8)], ["media", foto(8)], ["vieja", foto(1)]]);
    const r = fotosQueCaben(["nueva", "media", "vieja"], fotos, 10);
    expect(r.get("nueva")).toEqual(foto(8));
    expect(r.get("media")).toBe(NO_CABE);
    // Aunque ella sola cabría: lo que se quita es el PRINCIPIO de la conversación, como en DeepSeek.
    expect(r.get("vieja")).toBe(NO_CABE);
  });

  it("el límite exacto cabe", () => {
    expect(fotosQueCaben(["a", "b"], new Map([["a", foto(6)], ["b", foto(4)]]), 10).get("b")).toEqual(foto(4));
  });

  it("una que no se pudo cargar sigue siendo null, y no gasta presupuesto", () => {
    const r = fotosQueCaben(["nueva", "rota", "vieja"], new Map([["nueva", foto(5)], ["rota", null], ["vieja", foto(5)]]), 10);
    expect(r.get("rota")).toBeNull();
    expect(r.get("vieja")).toEqual(foto(5));
  });

  it("el presupuesto es el de DeepSeek: 20 MiB de imagen por petición", () => {
    expect(PRESUPUESTO_FOTOS_BYTES).toBe(20 * 1024 * 1024);
  });
});
