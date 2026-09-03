import { beforeEach, describe, expect, it } from "vitest";

import {
  _vaciarTodo,
  abrirTurno,
  cerrarTurno,
  dirigir,
  leerDireccion,
  MAX_DIRECCION,
} from "./direcciones";

beforeEach(() => _vaciarTodo());

describe("corregirle el rumbo al Agente a media faena", () => {
  it("lo que se deja, se lee", () => {
    abrirTurno("t1", "u1");
    expect(dirigir("t1", "u1", "no toques el hero")).toBe("ok");
    expect(leerDireccion("t1")).toBe("no toques el hero");
  });

  it("SE CONSUME: no se relee en la vuelta siguiente", () => {
    // Si se quedara, el modelo leeria la misma correccion en cada vuelta como
    // si fuera nueva, y actuaria cinco veces sobre ella.
    abrirTurno("t1", "u1");
    dirigir("t1", "u1", "para de buscar fotos");
    expect(leerDireccion("t1")).toBe("para de buscar fotos");
    expect(leerDireccion("t1")).toBeNull();
  });

  it("dos correcciones antes de la siguiente vuelta se leen las DOS, en orden", () => {
    // Perder la primera seria peor que juntarlas: el usuario escribio las dos.
    abrirTurno("t1", "u1");
    dirigir("t1", "u1", "primera");
    dirigir("t1", "u1", "segunda");
    expect(leerDireccion("t1")).toBe("primera\nsegunda");
  });

  it("🔴 un turno AJENO no se puede dirigir", () => {
    // El id del turno viaja al cliente por el SSE. Sin esta comprobacion,
    // quien adivine uno escribe en la pagina de otro.
    abrirTurno("t1", "u1");
    expect(dirigir("t1", "otro", "borra todo")).toBe("ajeno");
    expect(leerDireccion("t1")).toBeNull();
  });

  it("un turno que no existe no acepta nada", () => {
    expect(dirigir("fantasma", "u1", "hola")).toBe("no_existe");
  });

  it("un texto vacio no cuenta como correccion", () => {
    abrirTurno("t1", "u1");
    expect(dirigir("t1", "u1", "   \n  ")).toBe("vacio");
    expect(leerDireccion("t1")).toBeNull();
  });

  it("se recorta: una correccion es una frase, no un documento", () => {
    abrirTurno("t1", "u1");
    dirigir("t1", "u1", "x".repeat(MAX_DIRECCION + 500));
    expect(leerDireccion("t1")!.length).toBe(MAX_DIRECCION);
  });

  it("al cerrar el turno, lo que quedara pendiente se va con el", () => {
    abrirTurno("t1", "u1");
    dirigir("t1", "u1", "tarde");
    cerrarTurno("t1");
    expect(leerDireccion("t1")).toBeNull();
    // Y ya no se puede dirigir: el turno acabo.
    expect(dirigir("t1", "u1", "mas tarde")).toBe("no_existe");
  });

  it("un turno caducado no acepta correcciones", () => {
    // Un turno que muere sin cerrar dejaria su fila para siempre.
    abrirTurno("viejo", "u1", 1_000_000);
    abrirTurno("nuevo", "u1", 1_000_000 + 11 * 60 * 1000);
    expect(dirigir("viejo", "u1", "hola")).toBe("no_existe");
    expect(dirigir("nuevo", "u1", "hola")).toBe("ok");
  });

  it("BRAZO DE CONTROL: dos turnos a la vez no se pisan", () => {
    abrirTurno("a", "u1");
    abrirTurno("b", "u2");
    dirigir("a", "u1", "para a");
    dirigir("b", "u2", "para b");
    expect(leerDireccion("a")).toBe("para a");
    expect(leerDireccion("b")).toBe("para b");
  });
});
