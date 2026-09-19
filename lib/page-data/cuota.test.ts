import { describe, expect, it } from "vitest";
import { avisoDeCuotaParaElModelo, estadoDeCuota, BYTES_POR_PLAN, MAX_BYTES_DOCUMENTO, bytesDe, cabe } from "./cuota";

describe("bytesDe", () => {
  it("mide el JSON serializado", () => {
    expect(bytesDe({ a: "hola" })).toBe(Buffer.byteLength(JSON.stringify({ a: "hola" })));
  });

  it("cuenta bytes UTF-8, no caracteres", () => {
    expect(bytesDe({ a: "ñ" })).toBeGreaterThan(bytesDe({ a: "n" }));
  });
});

describe("cabe", () => {
  it("un documento por encima del tope se rechaza aunque haya sitio", () => {
    expect(cabe({ plan: "pro", usados: 0, entrantes: MAX_BYTES_DOCUMENTO + 1 })).toEqual({
      ok: false,
      razon: "documento_grande",
    });
  });

  it("acepta mientras quepa", () => {
    expect(cabe({ plan: "free", usados: 0, entrantes: 1000 })).toEqual({ ok: true });
  });

  it("rechaza cuando el proyecto llenó su cuota", () => {
    expect(cabe({ plan: "free", usados: BYTES_POR_PLAN.free, entrantes: 1 })).toEqual({
      ok: false,
      razon: "cuota_llena",
    });
  });

  // Sin esto, cambiar un documento por otro del mismo tamaño falla en cuanto el
  // proyecto está lleno — y editar el carrito se vuelve imposible.
  it("al reemplazar, descuenta lo que se va", () => {
    expect(
      cabe({ plan: "free", usados: BYTES_POR_PLAN.free, entrantes: 500, salientes: 500 }),
    ).toEqual({ ok: true });
  });

  it("pro tiene diez veces lo de free", () => {
    expect(BYTES_POR_PLAN.pro).toBe(BYTES_POR_PLAN.free * 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EL ESTADO DE LA CUOTA, PARA QUE EL DUEÑO LO VEA (2026-09-19).
//
// 🔴 POR QUÉ EXISTE. `bytesUsados` lo llamaban DOS sitios —la ruta pública y la
// herramienta de datos del Agente— y ninguno se lo enseñaba al dueño:
// `/api/projects/[id]/datos` devolvía los almacenes y sus filas, sin un solo
// byte de cuota, y la vista Datos no pintaba nada. Cuando el proyecto se llena,
// el visitante recibe un 507 y el dueño NO SE ENTERA: ni aviso, ni panel, ni
// correo.
//
// Es el fallo que LLEGA CON EL ÉXITO — cuanto mejor le va a la página, antes
// ocurre— y su síntoma es que los carritos dejan de guardarse en silencio. El
// silencio otra vez, y en el peor sitio: los datos de sus clientes.
//
// El umbral de aviso es 80%: hay que decirlo con sitio para reaccionar, no
// cuando ya no cabe nada.
describe("estadoDeCuota", () => {
  it("🔴 un proyecto vacío está bien, y lo dice con su tope", () => {
    const e = estadoDeCuota(0, "free");
    expect(e.nivel).toBe("bien");
    expect(e.tope).toBe(BYTES_POR_PLAN.free);
    expect(e.porcentaje).toBe(0);
  });

  it("🔴 al 80% avisa: queda sitio para reaccionar", () => {
    expect(estadoDeCuota(BYTES_POR_PLAN.free * 0.79, "free").nivel).toBe("bien");
    expect(estadoDeCuota(BYTES_POR_PLAN.free * 0.8, "free").nivel).toBe("cerca");
  });

  it("🔴 lleno es lleno: a partir del tope ya se rechazan escrituras", () => {
    expect(estadoDeCuota(BYTES_POR_PLAN.free, "free").nivel).toBe("llena");
    // Y por encima no se pasa del 100: un 137% en pantalla no dice nada útil.
    expect(estadoDeCuota(BYTES_POR_PLAN.free * 2, "free").porcentaje).toBe(100);
  });

  it("el plan manda: lo que llena un gratuito le sobra a un pro", () => {
    expect(estadoDeCuota(BYTES_POR_PLAN.free, "pro").nivel).toBe("bien");
  });

  // CONTRA-PRUEBA: el porcentaje se REDONDEA, no se trunca a cero. Un proyecto
  // con unos pocos kilobytes enseñando «0%» se lee como «no has usado nada»,
  // que es lo mismo que no decir nada.
  it("CONTRA-PRUEBA: unos kilobytes no se pintan como 0%", () => {
    expect(estadoDeCuota(6 * 1024, "free").porcentaje).toBe(1);
  });
});

// 🔴 Y AL MODELO TAMBIÉN, porque el panel sólo ayuda a quien lo abre — y el 507
// le ocurre a los visitantes mientras el dueño no mira. Len habla con él.
describe("avisoDeCuotaParaElModelo", () => {
  it("🔴 avisa cuando queda poco, y dice qué pasa al llenarse", () => {
    const aviso = avisoDeCuotaParaElModelo(estadoDeCuota(BYTES_POR_PLAN.free * 0.9, "free"))!;
    expect(aviso).toContain("90%");
    expect(aviso).toMatch(/visitantes/i);
  });

  it("🔴 lleno dice lo que ESTÁ pasando, en presente", () => {
    const aviso = avisoDeCuotaParaElModelo(estadoDeCuota(BYTES_POR_PLAN.free, "free"))!;
    expect(aviso).toMatch(/ya no pueden guardar/i);
  });

  // CONTRA-PRUEBA: en el 95% de los turnos no hay nada que decir, y decirlo
  // igual sería ruido en el contexto del modelo — que es caro y se lee entero.
  it("🔴 CONTRA-PRUEBA: con sitio de sobra no dice nada", () => {
    expect(avisoDeCuotaParaElModelo(estadoDeCuota(1024, "free"))).toBeNull();
  });
});
