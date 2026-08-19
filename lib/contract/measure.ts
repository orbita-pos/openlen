import { lintContract } from "./lint";

export interface ContractMeasurement {
  /** Colores escritos a mano fuera de `:root` — la violación que importa. */
  readonly colors: number;
  readonly radius: number;
  readonly tokens: number;
  readonly hairline: number;
  /** `publishToDir` rechaza el documento entero si esto aparece. */
  readonly slotPath: boolean;
}

const EMPTY: ContractMeasurement = { colors: 0, radius: 0, tokens: 0, hairline: 0, slotPath: false };

/** Mide la página contra el Contrato de Diseño sin poder bloquearla: el
 *  contrato lleva desde siempre exigiéndose a plantillas y secciones y nunca a
 *  lo que escribe el modelo, así que primero hay que ver el número. */
export function measureContract(html: string): ContractMeasurement {
  let violations;
  try {
    violations = lintContract(html, { kind: "document" }).violations;
  } catch {
    return EMPTY;
  }
  const count = (rule: string) => violations.filter((v) => v.rule === rule).length;
  return {
    colors: count("color-from-token"),
    radius: count("radius-from-token"),
    tokens: count("non-canonical-token"),
    hairline: count("hairline-alpha"),
    slotPath: violations.some((v) => v.rule === "no-slot-path"),
  };
}

/** Código de razón compacto, o null cuando la página está limpia. */
export function contractReasonCode(m: ContractMeasurement): string | null {
  const parts = [
    m.slotPath ? "slot_path" : "",
    m.colors ? `colors=${m.colors}` : "",
    m.radius ? `radius=${m.radius}` : "",
    m.tokens ? `tokens=${m.tokens}` : "",
    m.hairline ? `hairline=${m.hairline}` : "",
  ].filter(Boolean);
  return parts.length ? `contract:${parts.join(",")}` : null;
}
