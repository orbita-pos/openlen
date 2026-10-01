import { describe, expect, it } from "vitest";
import type { ResumenDeVisitas } from "@/lib/resultados/visitas";
import { datosDeVisitas } from "./tarjeta-de-visitas";

const cuenta = (vistas: number, personas = vistas) => ({ vistas, personas, clics: 0 });
const base: ResumenDeVisitas = {
  zona: "America/Mexico_City",
  hoy: cuenta(18),
  ayer: cuenta(40),
  ultimos7: cuenta(312, 241),
  ultimos30: cuenta(900),
  rango: {
    desde: "2026-09-24",
    hasta: "2026-09-30",
    total: cuenta(312, 241),
    porDia: [{ dia: "2026-09-30", vistas: 18 }],
    paginas: [],
    deDonde: [{ origen: "instagram.com", vistas: 187 }, { origen: "directo", vistas: 125 }],
    dispositivos: [],
  },
  recortadoDesde: null,
};

describe("datosDeVisitas", () => {
  it("los números son los de Len, sin tocar", () => {
    const d = datosDeVisitas(base);
    expect(d).toMatchObject({ vistas: 312, personas: 241, hoy: 18, porDia: [{ dia: "2026-09-30", vistas: 18 }] });
  });

  it("el origen principal, en «de cada diez» redondeado", () => {
    expect(datosDeVisitas(base).origen).toEqual({ origen: "instagram.com", deCadaDiez: 6 });
  });

  it("sin visitas no hay origen (ni división por cero)", () => {
    const vacio = { ...base, ultimos7: cuenta(0), rango: { ...base.rango, total: cuenta(0), deDonde: [] } };
    expect(datosDeVisitas(vacio).origen).toBeNull();
  });
});
