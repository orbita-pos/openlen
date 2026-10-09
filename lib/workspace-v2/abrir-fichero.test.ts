import { describe, expect, it } from "vitest";

import { createCambiosEnVivo } from "./cambios-en-vivo";
import { abrirFicheroDelTurno, createAbrirEnElCodigo, rutaDeLaTarjeta, rutaMencionada, rutasDelTurno } from "./abrir-fichero";

describe("rutaDeLaTarjeta — la ruta con la que empieza el resumen de Read, Edit y Write", () => {
  it("las tres formas del resumen", () => {
    expect(rutaDeLaTarjeta({ tool: "Read", summary: "index.html" })).toBe("/index.html");
    expect(rutaDeLaTarjeta({ tool: "Edit", summary: "menu/index.html: «Tel 55» → «Tel 56»" })).toBe("/menu/index.html");
    expect(rutaDeLaTarjeta({ tool: "Write", summary: "clases/index.html (página nueva)" })).toBe("/clases/index.html");
    expect(rutaDeLaTarjeta({ tool: "Write", summary: "datos/reservas.json" })).toBe("/datos/reservas.json");
  });

  it("las demás herramientas no llevan ruta, y lo que no parece un fichero tampoco", () => {
    expect(rutaDeLaTarjeta({ tool: "Grep", summary: "Calle Marea" })).toBeNull();
    expect(rutaDeLaTarjeta({ tool: "bash", summary: "cat /index.html" })).toBeNull();
    expect(rutaDeLaTarjeta({ tool: "Read", summary: "" })).toBeNull();
    expect(rutaDeLaTarjeta({ tool: "Read", summary: "menu" })).toBeNull();
  });
});

describe("rutaMencionada — la regla de DeepSeek: ruta exacta o nombre de UNO solo", () => {
  const turno = ["/index.html", "/menu/index.html", "/datos/reservas.json", "/LEN.md"];

  it("la ruta exacta, con o sin la barra del principio y con :línea detrás", () => {
    expect(rutaMencionada("menu/index.html", turno)).toBe("/menu/index.html");
    expect(rutaMencionada("/menu/index.html", turno)).toBe("/menu/index.html");
    expect(rutaMencionada("menu/index.html:41", turno)).toBe("/menu/index.html");
    expect(rutaMencionada("index.html", turno)).toBe("/index.html");
  });

  it("un nombre suelto sólo si es de uno solo", () => {
    expect(rutaMencionada("reservas.json", turno)).toBe("/datos/reservas.json");
    expect(rutaMencionada("index.html", ["/menu/index.html", "/contacto/index.html"])).toBeNull();
  });

  it("lo que el turno no tocó, o no es una ruta, se queda en texto", () => {
    expect(rutaMencionada("notas.txt", turno)).toBeNull();
    expect(rutaMencionada("clases/index.html", turno)).toBeNull();
    expect(rutaMencionada("sed -i", turno)).toBeNull();
    expect(rutaMencionada("", turno)).toBeNull();
  });
});

describe("rutasDelTurno", () => {
  it("las de sus tarjetas y las que cambió, sin repetir", () => {
    const rutas = rutasDelTurno(
      [
        { tool: "Read", summary: "index.html" },
        { tool: "bash", summary: "grep -rn x /" },
        { tool: "Edit", summary: "index.html: «a» → «b»" },
      ],
      ["/index.html", "/datos/reservas.json"],
    );
    expect(rutas.sort()).toEqual(["/datos/reservas.json", "/index.html"]);
  });
});

describe("abrirFicheroDelTurno — en «Cambios» si cambió en ESE turno; si no, en «Código»", () => {
  it("decide por el turno, no por si cambió alguna vez", () => {
    const cambios = createCambiosEnVivo();
    const codigo = createAbrirEnElCodigo();
    cambios.guardar("p", { turnId: "t1", pedido: "x", ficheros: [{ ruta: "/index.html", tipo: "texto", antes: "a", despues: "b" }] });

    expect(abrirFicheroDelTurno("p", "t1", "/index.html", { cambios, codigo })).toBe("cambios");
    expect(cambios.peticion("p")).toMatchObject({ turnId: "t1", ruta: "/index.html" });

    expect(abrirFicheroDelTurno("p", "t2", "/index.html", { cambios, codigo })).toBe("codigo");
    expect(abrirFicheroDelTurno("p", "t1", "/menu/index.html", { cambios, codigo })).toBe("codigo");
    expect(codigo.peticion("p")).toMatchObject({ ruta: "/menu/index.html" });
  });

  it("cada petición sube su número, también si es la misma ruta, y avisa", () => {
    const codigo = createAbrirEnElCodigo();
    let avisos = 0;
    codigo.subscribe(() => avisos++);
    codigo.abrir("p", "/index.html");
    const n = codigo.peticion("p")!.n;
    codigo.abrir("p", "/index.html");
    expect(codigo.peticion("p")!.n).toBe(n + 1);
    expect(avisos).toBe(2);
    expect(codigo.peticion("otro")).toBeNull();
  });
});
