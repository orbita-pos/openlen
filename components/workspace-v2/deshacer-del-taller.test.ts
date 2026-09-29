import { describe, expect, it } from "vitest";

import { planDeDeshacerDelTaller } from "./deshacer-del-taller";

describe("Deshacer en el taller restaura la copia del servidor, nunca manda el documento", () => {
  it("un lote que aún no salió se tira: el servidor no lo ha visto", () => {
    expect(planDeDeshacerDelTaller({ page: null, lote: 4 }, 4, new Map())).toEqual({ kind: "descartar" });
  });

  it("uno que salió restaura la copia de antes que devolvió el servidor, en su página", () => {
    const copias = new Map([[3, "v-antes"]]);
    expect(planDeDeshacerDelTaller({ page: "menu", lote: 3 }, 4, copias)).toEqual({
      kind: "restaurar",
      versionId: "v-antes",
      page: "menu",
    });
  });

  it("sin copia no hay Deshacer — ni el de mandar la página, que es el que borraba los onclick", () => {
    expect(planDeDeshacerDelTaller({ page: null, lote: 3 }, 4, new Map([[3, null]]))).toEqual({ kind: "sin-copia" });
    expect(planDeDeshacerDelTaller({ page: null, lote: 3 }, 4, new Map())).toEqual({ kind: "sin-copia" });
  });
});
