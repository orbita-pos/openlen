import { beforeEach, describe, expect, it } from "vitest";

import {
  admiteEsfuerzo,
  marcarSinEsfuerzo,
  olvidarModelosSinEsfuerzo,
  rechazoDeEsfuerzo,
} from "./esfuerzo-no-admitido";

/**
 * LOS CUERPOS SON REALES, no inventados. Sondeados contra Fireworks el
 * 2026-09-13 con `deepseek-v4p1-flash` y `max_tokens: 1`. Escribir un detector
 * contra un mensaje imaginado es escribir un detector que no detecta.
 */
const CAMPO_DESCONOCIDO =
  '{"error":{"object":"error","type":"invalid_request_error","code":"invalid_request_error","message":"Extra inputs are not permitted, field: \'reasoning_effort\', value: 100"}}';
const VALOR_NO_VALIDO =
  '{"error":{"object":"error","type":"invalid_request_error","code":"invalid_request_error","message":"3 request validation errors: Input should be \'low\', \'medium\', \'high\', \'xhigh\', \'max\', \'none\' or \'adaptive\', field: \'reasoning_effort\'"}}';
const VALOR_NEGATIVO =
  '{"error":{"object":"error","type":"invalid_request_error","code":"invalid_request_error","message":"integer reasoning_effort must be positive"}}';

beforeEach(() => olvidarModelosSinEsfuerzo());

describe("de qué clase es el rechazo", () => {
  it("un campo que el modelo no admite es CAPACIDAD suya", () => {
    expect(rechazoDeEsfuerzo(CAMPO_DESCONOCIDO)).toBe("capacidad");
  });

  it("«not support» también — es la otra forma que lleva Claude Code en su lista", () => {
    expect(rechazoDeEsfuerzo('{"message":"this model does not support reasoning_effort"}')).toBe(
      "capacidad",
    );
  });

  it("un valor fuera de la lista o negativo es DEFECTO NUESTRO", () => {
    expect(rechazoDeEsfuerzo(VALOR_NO_VALIDO)).toBe("valor");
    expect(rechazoDeEsfuerzo(VALOR_NEGATIVO)).toBe("valor");
  });

  // 🔴 EL BRAZO DE CONTROL, y sin él el detector sería peligroso: «Extra inputs
  // are not permitted» a secas lo produce CUALQUIER parámetro mal puesto.
  // Tratarlo como cosa del esfuerzo haría un segundo intento idéntico y
  // enterraría el error de verdad detrás de él.
  it("un campo desconocido que NO es el nuestro no se toca", () => {
    const otro =
      '{"error":{"message":"Extra inputs are not permitted, field: \'esfuerzo_de_pensar\', value: 100"}}';
    expect(rechazoDeEsfuerzo(otro)).toBeNull();
  });

  it("un error corriente tampoco", () => {
    expect(rechazoDeEsfuerzo('{"error":{"message":"Model not found"}}')).toBeNull();
    expect(rechazoDeEsfuerzo("")).toBeNull();
  });
});

describe("el registro de modelos sin esfuerzo", () => {
  it("por omisión todos admiten", () => {
    expect(admiteEsfuerzo("cualquiera")).toBe(true);
  });

  it("marcado deja de admitir, y sólo ése", () => {
    marcarSinEsfuerzo("modelo-a");
    expect(admiteEsfuerzo("modelo-a")).toBe(false);
    expect(admiteEsfuerzo("modelo-b")).toBe(true);
  });

  it("marcar dos veces no rompe nada", () => {
    marcarSinEsfuerzo("modelo-a");
    marcarSinEsfuerzo("modelo-a");
    expect(admiteEsfuerzo("modelo-a")).toBe(false);
  });
});
