// lib/agent/terminal/terminal.test.ts — la terminal de Len de verdad: el hilo y just-bash.
// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AVISO_DE_REINICIO, TerminalDeLen } from "./terminal";
import { DE_SOLO_LECTURA } from "./ficheros";

const SITIO = {
  "/index.html": "<h1>Marejada</h1>\n<p>Calle Pelícanos 12</p>\n",
  "/surf/index.html": "<h1>Surf</h1>\n<footer>Marejada</footer>\n",
  "/AGENTS.md": "manual\n",
};

let abiertas: TerminalDeLen[] = [];
function terminal(o: Partial<ConstructorParameters<typeof TerminalDeLen>[0]> = {}) {
  let cargas = 0;
  const t = new TerminalDeLen({
    cargarFicheros: async () => {
      cargas++;
      return { ...SITIO };
    },
    ...o,
  });
  abiertas.push(t);
  return { t, cargas: () => cargas };
}
afterEach(async () => {
  await Promise.all(abiertas.map((t) => t.cerrar()));
  abiertas = [];
});

describe("TerminalDeLen", () => {
  it("grep y sed -i sobre los ficheros del proyecto: lo cambiado vuelve en `ficheros`", async () => {
    const { t } = terminal();
    const g = await t.ejecutar("grep -rn Marejada /");
    expect(g.exitCode).toBe(0);
    expect(g.stdout).toContain("/index.html:1:<h1>Marejada</h1>");
    expect(g.stdout).toContain("/surf/index.html:2:<footer>Marejada</footer>");
    const s = await t.ejecutar("sed -i 's/Marejada/Casa Oleaje/g' /index.html /surf/index.html");
    expect(s.exitCode).toBe(0);
    expect(s.ficheros?.["/index.html"]).toBe("<h1>Casa Oleaje</h1>\n<p>Calle Pelícanos 12</p>\n");
    expect(s.ficheros?.["/surf/index.html"]).toContain("<footer>Casa Oleaje</footer>");
    expect(s.ficheros?.["/AGENTS.md"]).toBe("manual\n");
    // /tmp y lo del sistema no vienen: no son del proyecto.
    expect(Object.keys(s.ficheros ?? {}).some((r) => r.startsWith("/tmp") || r.startsWith("/bin"))).toBe(false);
  }, 20_000);

  it("el directorio y las variables sobreviven entre comandos, como en la terminal de DeepSeek", async () => {
    const { t } = terminal();
    await t.ejecutar('cd /surf && NOMBRE="Casa Oleaje" && export CIUDAD=Sayulita');
    const r = await t.ejecutar('pwd; echo "$NOMBRE en $CIUDAD"');
    expect(r.stdout).toBe("/surf\nCasa Oleaje en Sayulita\n");
  }, 20_000);

  it("sin red: curl no existe", async () => {
    const { t } = terminal();
    const r = await t.ejecutar("curl https://example.com");
    expect(r.exitCode).toBe(127);
    expect(r.stderr).toContain("command not found");
  }, 20_000);

  it("un bucle infinito se corta solo, y la terminal sigue viva", async () => {
    const { t } = terminal();
    const t0 = Date.now();
    const r = await t.ejecutar("while true; do :; done");
    expect(r.exitCode).not.toBe(0);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect((await t.ejecutar("echo sigue")).stdout).toBe("sigue\n");
  }, 20_000);

  it("lo que no vuelve se corta DESDE FUERA: código 124, aviso de reinicio y terminal nueva con los ficheros de ahora", async () => {
    const { t, cargas } = terminal({ limiteMs: 10_000, margenMs: -9_700 });
    const r = await t.ejecutar("sleep 5");
    expect(r.exitCode).toBe(124);
    expect(r.reiniciada).toBe(AVISO_DE_REINICIO);
    expect(r.ficheros).toBeNull();
    const despues = await t.ejecutar("cat /AGENTS.md");
    expect(despues.stdout).toBe("manual\n");
    expect(cargas()).toBe(2);
  }, 30_000);

  it("`poner` deja la terminal como quedó de verdad tras las guardas", async () => {
    const { t } = terminal();
    await t.ejecutar("echo roto > /AGENTS.md; echo x > /notas.txt");
    await t.poner({ "/AGENTS.md": "manual\n", "/notas.txt": null });
    const r = await t.ejecutar("cat /AGENTS.md; ls /notas.txt");
    expect(r.stdout).toBe("manual\n");
    expect(r.exitCode).not.toBe(0);
  }, 20_000);

  describe("F5 · los ficheros de sólo lectura", () => {
    const FORMULARIOS = '{"_origen":"visitante","id":"f1","de":"Ana","datos":{"mensaje":"¿Abren el sábado?"}}\n';
    function conPerezosos() {
      const leidos: string[] = [];
      const { t } = terminal({
        perezosos: {
          rutas: async () => ["/bandeja/formularios.jsonl", "/resultados/visitas.json"],
          leer: async (ruta) => {
            leidos.push(ruta);
            if (ruta === "/bandeja/formularios.jsonl") return FORMULARIOS;
            throw new Error("la base no contesta");
          },
        },
      });
      return { t, leidos };
    }

    it("existen desde el principio, pero sólo se calculan cuando un comando los lee", async () => {
      const { t, leidos } = conPerezosos();
      const ls = await t.ejecutar("ls /bandeja /resultados");
      expect(ls.stdout).toContain("formularios.jsonl");
      expect(ls.stdout).toContain("visitas.json");
      expect(leidos).toEqual([]);
      const jq = await t.ejecutar("jq -r '.de' /bandeja/formularios.jsonl");
      expect(jq.stdout).toBe("Ana\n");
      expect(jq.cargados).toEqual(["/bandeja/formularios.jsonl"]);
      // Cargado una vez, se queda: el comando siguiente no lo pide otra vez.
      const otra = await t.ejecutar("wc -l < /bandeja/formularios.jsonl");
      expect(otra.stdout.trim()).toBe("1");
      expect(otra.cargados).toBeUndefined();
      expect(leidos).toEqual(["/bandeja/formularios.jsonl"]);
      // No son del proyecto: no vuelven en `ficheros` (y no se guardarían).
      expect(Object.keys(otra.ficheros ?? {}).some((r) => DE_SOLO_LECTURA.test(r))).toBe(false);
    }, 20_000);

    it("si su cálculo falla, el comando falla y lo dice; la terminal sigue", async () => {
      const { t } = conPerezosos();
      const r = await t.ejecutar("cat /resultados/visitas.json");
      expect(r.exitCode).not.toBe(0);
      expect(r.fallidos).toEqual([{ ruta: "/resultados/visitas.json", error: "la base no contesta" }]);
      expect((await t.ejecutar("echo sigue")).stdout).toBe("sigue\n");
    }, 20_000);

    it("nadie los escribe: >, >>, sed -i, rm, mv, cp encima, mkdir dentro y un enlace simbólico — todo EROFS, y siguen iguales", async () => {
      const { t } = conPerezosos();
      const intentos = [
        "echo x > /bandeja/formularios.jsonl",
        "echo x >> /bandeja/formularios.jsonl",
        "sed -i 's/Ana/Eva/' /bandeja/formularios.jsonl",
        "rm /bandeja/formularios.jsonl",
        "mv /bandeja/formularios.jsonl /robado.jsonl",
        "echo y > /tmp/y; cp /tmp/y /bandeja/formularios.jsonl",
        "mkdir /bandeja/nueva",
        "echo z > /bandeja/nuevo.txt",
        "ln -s /bandeja/formularios.jsonl /atajo && echo w > /atajo",
        "ln -s /bandeja /carpeta && echo w > /carpeta/otro.txt",
      ];
      for (const c of intentos) {
        const r = await t.ejecutar(c);
        expect(r.exitCode, c).not.toBe(0);
      }
      const despues = await t.ejecutar("cat /bandeja/formularios.jsonl; ls /bandeja");
      expect(despues.stdout).toBe(FORMULARIOS + "formularios.jsonl\n");
      expect(Object.hasOwn((await t.ejecutar("true")).ficheros ?? {}, "/robado.jsonl")).toBe(false);
    }, 60_000);

    it("sed -i y tee sobre uno de sólo lectura dicen «Read-only file system», no «No such file»", async () => {
      const { t } = conPerezosos();
      const sed = await t.ejecutar("sed -i 's/Ana/Eva/' /bandeja/formularios.jsonl");
      expect(sed.exitCode).not.toBe(0);
      expect(sed.stderr).toBe("sed: /bandeja/formularios.jsonl: Read-only file system\n");
      // Relativa, después de un `cd` en el mismo comando.
      const tee = await t.ejecutar("cd /bandeja && echo x | tee formularios.jsonl");
      expect(tee.stderr).toBe("tee: formularios.jsonl: Read-only file system\n");
      // Lo que de verdad no existe sigue diciendo lo suyo.
      const nada = await t.ejecutar("sed -i 's/a/b/' /bandeja/no-existe.jsonl");
      expect(nada.stderr).toContain("No such file or directory");
    }, 20_000);

    it("el hilo y ficheros.ts usan la MISMA regla de sólo lectura", () => {
      const hilo = readFileSync(path.join(__dirname, "trabajador.mjs"), "utf8");
      expect(hilo).toContain(`const SOLO_LECTURA = ${DE_SOLO_LECTURA.toString()};`);
    });
  });
});
