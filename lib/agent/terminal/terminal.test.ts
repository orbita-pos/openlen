// lib/agent/terminal/terminal.test.ts — la terminal de Len de verdad: el hilo y just-bash.
// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AVISO_DE_REINICIO, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, TerminalDeLen } from "./terminal";
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
  it("`arrancada` es falso antes del primer comando y verdadero después (la compactación sólo deja su fichero en una terminal viva)", async () => {
    const { t } = terminal();
    expect(t.arrancada).toBe(false);
    await t.ejecutar("echo hola");
    expect(t.arrancada).toBe(true);
  });

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

  // plans/len-md: el prompt dice ~/.len/LEN.md. El HOME por defecto de
  // just-bash es «/», y `cat ~/.len/LEN.md` buscaba //.len/LEN.md (visto en el
  // ensayo de caja del 08/10).
  it("~ es /home/user: `cat ~/.len/LEN.md` abre la memoria de la persona", async () => {
    const { t } = terminal({ cargarFicheros: async () => ({ ...SITIO, "/home/user/.len/LEN.md": "- Tutéame\n" }) });
    const r = await t.ejecutar("echo $HOME; cat ~/.len/LEN.md");
    expect(r.stdout).toBe("/home/user\n- Tutéame\n");
    // Y no se arrastra como variable del modelo de un comando a otro.
    expect((await t.ejecutar("cd ~ && pwd")).stdout).toBe("/home/user\n");
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

  it("🔴 el tiempo de Claude Code: 120 s por defecto, timeout hasta 600 s, y al pasarse lo de su binario (143, el aviso DELANTE de lo que alcanzó a escribir)", async () => {
    expect([DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS]).toEqual([120_000, 600_000]);
    const { t } = terminal({});
    // uRe de Claude Code 2.1.293: `s.stdout = r ? `${w} ${r}` : w` con w = «Command timed out after ${Zt(ms)}», y el código 143 (wot).
    // Lo que el guion escribió antes no llega: `just-bash` 3.6.0 lo tira al abortar (medido: «bash: execution aborted», stdout vacío).
    const r = await t.ejecutar("echo antes; sleep 3; echo tarde", { timeoutMs: 1000 });
    expect([r.stdout, r.stderr, r.exitCode]).toEqual(["Command timed out after 1s", "", 143]);
    expect((await t.ejecutar("echo sigue")).stdout).toBe("sigue\n");
  }, 30_000);

  it("lo que no vuelve se corta DESDE FUERA: código 143, el aviso, el de reinicio y terminal nueva con los ficheros de ahora", async () => {
    const { t, cargas } = terminal({ limiteMs: 10_000, margenMs: -9_700 });
    const r = await t.ejecutar("sleep 5");
    expect([r.stdout, r.stderr, r.exitCode]).toEqual(["Command timed out after 10s", "", 143]);
    expect(r.reiniciada).toBe(AVISO_DE_REINICIO);
    expect(r.ficheros).toBeNull();
    const despues = await t.ejecutar("cat /AGENTS.md");
    expect(despues.stdout).toBe("manual\n");
    expect(cargas()).toBe(2);
  }, 30_000);

  // python3 desde el 2026-10-03, como la terminal de DeepSeek (un Linux con
  // Python): CPython en WASM, librería estándar, sin pip y sin red.
  describe("python3", () => {
    it("edita la página y lo cambiado vuelve en `ficheros`, como un sed -i", async () => {
      const { t } = terminal();
      const r = await t.ejecutar(
        `python3 - <<'PY'\nimport re\np = "/index.html"\ns = open(p).read()\nopen(p, "w").write(re.sub(r"Pelícanos (\\d+)", r"Pelícanos 14", s))\nPY`,
      );
      expect(r.exitCode, r.stderr).toBe(0);
      expect(r.ficheros?.["/index.html"]).toBe("<h1>Marejada</h1>\n<p>Calle Pelícanos 14</p>\n");
      expect((await t.ejecutar("grep -c 'Pelícanos 14' /index.html")).stdout).toBe("1\n");
    }, 30_000);

    it("trae la librería estándar, pero ni pip ni red", async () => {
      const { t } = terminal();
      const stdlib = await t.ejecutar("python3 -c 'import re, json, html.parser, csv, difflib; print(\"ok\")'");
      expect(stdlib.stdout).toBe("ok\n");
      const pip = await t.ejecutar("python3 -m pip --version");
      expect(pip.exitCode).not.toBe(0);
      expect(pip.stderr).toContain("No module named pip");
      const red = await t.ejecutar(
        "python3 -c 'import urllib.request; urllib.request.urlopen(\"https://example.com\", timeout=3)'",
      );
      expect(red.exitCode).not.toBe(0);
    }, 30_000);

    it("un bucle infinito en Python se corta, y la terminal sigue viva", async () => {
      const { t } = terminal({ limiteMs: 3_000 });
      const t0 = Date.now();
      const r = await t.ejecutar("python3 -c 'while True: pass'");
      expect(r.exitCode).not.toBe(0);
      expect(Date.now() - t0).toBeLessThan(15_000);
      expect((await t.ejecutar("echo sigue")).stdout).toBe("sigue\n");
    }, 30_000);

    it("su memoria tiene techo: pedir 700 MB da MemoryError y la terminal sigue viva", async () => {
      const { t } = terminal();
      const r = await t.ejecutar("python3 -c 'x = bytearray(700 * 1024 * 1024)'");
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("MemoryError");
      expect((await t.ejecutar("python3 -c 'print(1 + 2)'")).stdout).toBe("3\n");
    }, 30_000);
  });

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
          rutas: async () => ["/.openlen/bandeja/formularios.jsonl", "/.openlen/resultados/visitas.json"],
          leer: async (ruta) => {
            leidos.push(ruta);
            if (ruta === "/.openlen/bandeja/formularios.jsonl") return FORMULARIOS;
            throw new Error("la base no contesta");
          },
        },
      });
      return { t, leidos };
    }

    it("existen desde el principio, pero sólo se calculan cuando un comando los lee", async () => {
      const { t, leidos } = conPerezosos();
      const ls = await t.ejecutar("ls /.openlen/bandeja /.openlen/resultados");
      expect(ls.stdout).toContain("formularios.jsonl");
      expect(ls.stdout).toContain("visitas.json");
      expect(leidos).toEqual([]);
      const jq = await t.ejecutar("jq -r '.de' /.openlen/bandeja/formularios.jsonl");
      expect(jq.stdout).toBe("Ana\n");
      expect(jq.cargados).toEqual(["/.openlen/bandeja/formularios.jsonl"]);
      // Cargado una vez, se queda: el comando siguiente no lo pide otra vez.
      const otra = await t.ejecutar("wc -l < /.openlen/bandeja/formularios.jsonl");
      expect(otra.stdout.trim()).toBe("1");
      expect(otra.cargados).toBeUndefined();
      expect(leidos).toEqual(["/.openlen/bandeja/formularios.jsonl"]);
      // No son del proyecto: no vuelven en `ficheros` (y no se guardarían).
      expect(Object.keys(otra.ficheros ?? {}).some((r) => DE_SOLO_LECTURA.test(r))).toBe(false);
    }, 20_000);

    // Pregunta 3 de INFORME-NOCHE, resuelta como DeepSeek: lo que no es el sitio
    // vive en una carpeta oculta, como su `.git`. Medido el 02/10: en la raíz,
    // `grep -rn X /` calculaba la bandeja, el catálogo y las visitas, y mezclaba
    // lo que escribió un visitante con las páginas.
    it("una búsqueda del sitio no los toca: grep -r / ni los calcula ni los enseña; find y ls -a sí los ven", async () => {
      const { t, leidos } = conPerezosos();
      const grep = await t.ejecutar("grep -rn Ana /");
      expect(grep.stdout).not.toContain(".openlen");
      expect(leidos).toEqual([]);
      expect((await t.ejecutar("find / -name '*.jsonl'")).stdout).toContain("/.openlen/bandeja/formularios.jsonl");
      expect((await t.ejecutar("ls -a /")).stdout).toContain(".openlen");
      expect(leidos).toEqual([]);
    }, 20_000);

    it("refrescarPerezosos: tras cambiar el sitio se lee lo de ahora (rutas nuevas, quitadas y recalculadas), y siguen sin escribirse", async () => {
      let version = 1;
      const leidos: string[] = [];
      const { t } = terminal({
        perezosos: {
          rutas: async () => [
            "/.openlen/versiones/indice.jsonl",
            ...(version === 2 ? ["/.openlen/versiones/v2/index.html"] : []),
          ],
          leer: async (ruta) => {
            leidos.push(ruta);
            return ruta.endsWith("indice.jsonl") ? `v${version}\n` : "<h1>v2</h1>\n";
          },
        },
      });
      await t.refrescarPerezosos(); // sin arrancar: no hace nada
      expect((await t.ejecutar("cat /.openlen/versiones/indice.jsonl")).stdout).toBe("v1\n");
      version = 2;
      await t.refrescarPerezosos();
      expect((await t.ejecutar("cat /.openlen/versiones/indice.jsonl")).stdout).toBe("v2\n");
      expect((await t.ejecutar("cat /.openlen/versiones/v2/index.html")).stdout).toBe("<h1>v2</h1>\n");
      version = 3;
      await t.refrescarPerezosos();
      expect((await t.ejecutar("ls /.openlen/versiones")).stdout).toBe("indice.jsonl\n");
      expect((await t.ejecutar("echo x > /.openlen/versiones/indice.jsonl")).exitCode).not.toBe(0);
      expect((await t.ejecutar("cat /.openlen/versiones/indice.jsonl")).stdout).toBe("v3\n");
    }, 20_000);

    it("si su cálculo falla, el comando falla y lo dice; la terminal sigue", async () => {
      const { t } = conPerezosos();
      const r = await t.ejecutar("cat /.openlen/resultados/visitas.json");
      expect(r.exitCode).not.toBe(0);
      expect(r.fallidos).toEqual([{ ruta: "/.openlen/resultados/visitas.json", error: "la base no contesta" }]);
      expect((await t.ejecutar("echo sigue")).stdout).toBe("sigue\n");
    }, 20_000);

    it("nadie los escribe: >, >>, sed -i, rm, mv, cp encima, mkdir dentro y un enlace simbólico — todo EROFS, y siguen iguales", async () => {
      const { t } = conPerezosos();
      const intentos = [
        "echo x > /.openlen/bandeja/formularios.jsonl",
        "echo x >> /.openlen/bandeja/formularios.jsonl",
        "sed -i 's/Ana/Eva/' /.openlen/bandeja/formularios.jsonl",
        "rm /.openlen/bandeja/formularios.jsonl",
        "mv /.openlen/bandeja/formularios.jsonl /robado.jsonl",
        "echo y > /tmp/y; cp /tmp/y /.openlen/bandeja/formularios.jsonl",
        "mkdir /.openlen/bandeja/nueva",
        "echo z > /.openlen/bandeja/nuevo.txt",
        "ln -s /.openlen/bandeja/formularios.jsonl /atajo && echo w > /atajo",
        "ln -s /.openlen/bandeja /carpeta && echo w > /carpeta/otro.txt",
      ];
      for (const c of intentos) {
        const r = await t.ejecutar(c);
        expect(r.exitCode, c).not.toBe(0);
      }
      const despues = await t.ejecutar("cat /.openlen/bandeja/formularios.jsonl; ls /.openlen/bandeja");
      expect(despues.stdout).toBe(FORMULARIOS + "formularios.jsonl\n");
      expect(Object.hasOwn((await t.ejecutar("true")).ficheros ?? {}, "/robado.jsonl")).toBe(false);
    }, 60_000);

    it("python3 tampoco los escribe: ni cambiarlos, ni borrarlos, ni crear uno dentro", async () => {
      const { t } = conPerezosos();
      const intentos = [
        "python3 -c 'open(\"/.openlen/bandeja/formularios.jsonl\", \"w\").write(\"x\")'",
        "python3 -c 'with open(\"/.openlen/bandeja/formularios.jsonl\", \"a\") as f: f.write(\"x\")'",
        "python3 -c 'import os; os.remove(\"/.openlen/bandeja/formularios.jsonl\")'",
        "python3 -c 'with open(\"/.openlen/bandeja/nuevo.txt\", \"w\") as f: f.write(\"x\")'",
      ];
      for (const c of intentos) {
        const r = await t.ejecutar(c);
        expect(r.exitCode, c).not.toBe(0);
      }
      // Sin cerrar el fichero, el error salta al salir y CPython lo ignora: el
      // código es 0, pero lo que importa es que el fichero no cambia.
      await t.ejecutar("python3 -c 'open(\"/.openlen/bandeja/formularios.jsonl\", \"a\").write(\"x\")'");
      const despues = await t.ejecutar("cat /.openlen/bandeja/formularios.jsonl; ls /.openlen/bandeja");
      expect(despues.stdout).toBe(FORMULARIOS + "formularios.jsonl\n");
    }, 60_000);

    it("python3 sobre uno de sólo lectura dice «Read-only file system», no «I/O error»", async () => {
      const { t } = conPerezosos();
      const r = await t.ejecutar(
        "python3 -c 'with open(\"/.openlen/bandeja/formularios.jsonl\", \"a\") as f: f.write(\"x\")'",
      );
      expect(r.stderr).toContain("OSError: [Errno 30] Read-only file system: '/.openlen/bandeja/formularios.jsonl'");
      expect(r.stderr).not.toContain("I/O error");
    }, 30_000);

    it("sed -i y tee sobre uno de sólo lectura dicen «Read-only file system», no «No such file»", async () => {
      const { t } = conPerezosos();
      const sed = await t.ejecutar("sed -i 's/Ana/Eva/' /.openlen/bandeja/formularios.jsonl");
      expect(sed.exitCode).not.toBe(0);
      expect(sed.stderr).toBe("sed: /.openlen/bandeja/formularios.jsonl: Read-only file system\n");
      // Relativa, después de un `cd` en el mismo comando.
      const tee = await t.ejecutar("cd /.openlen/bandeja && echo x | tee formularios.jsonl");
      expect(tee.stderr).toBe("tee: formularios.jsonl: Read-only file system\n");
      // Lo que de verdad no existe sigue diciendo lo suyo.
      const nada = await t.ejecutar("sed -i 's/a/b/' /.openlen/bandeja/no-existe.jsonl");
      expect(nada.stderr).toContain("No such file or directory");
    }, 20_000);

    it("el hilo y ficheros.ts usan la MISMA regla de sólo lectura", () => {
      const hilo = readFileSync(path.join(__dirname, "trabajador.mjs"), "utf8");
      expect(hilo).toContain(`const SOLO_LECTURA = ${DE_SOLO_LECTURA.toString()};`);
    });
  });

  // plans/pages-backend/design.md: `supabase …` lo corre el hilo de la app (con
  // la base); el hilo de la terminal le pasa los argumentos y los ficheros de
  // `/supabase/` como están en la terminal, y escribe los que la CLI crea.
  describe("supabase, la CLI del backend del proyecto", () => {
    function conSupabase(responder?: (args: readonly string[], ficheros: Readonly<Record<string, string>>) => Promise<{ stdout: string; stderr: string; exitCode: number; escribir?: Record<string, string> }>) {
      const llamadas: { args: readonly string[]; ficheros: Readonly<Record<string, string>> }[] = [];
      const { t } = terminal({
        supabase: async (args, ficheros) => {
          llamadas.push({ args, ficheros });
          return responder ? responder(args, ficheros) : { stdout: "ok\n", stderr: "", exitCode: 0 };
        },
      });
      return { t, llamadas };
    }

    it("🔴 migration new: el fichero que crea la CLI aparece en la terminal y vuelve en `ficheros`", async () => {
      const { t, llamadas } = conSupabase(async () => ({
        stdout: "Created new migration at supabase/migrations/20261004120000_notes.sql\n",
        stderr: "",
        exitCode: 0,
        escribir: { "/supabase/migrations/20261004120000_notes.sql": "" },
      }));
      const r = await t.ejecutar("supabase migration new notes");
      expect(r.exitCode, r.stderr).toBe(0);
      expect(r.stdout).toBe("Created new migration at supabase/migrations/20261004120000_notes.sql\n");
      expect(llamadas[0]!.args).toEqual(["migration", "new", "notes"]);
      expect(r.ficheros?.["/supabase/migrations/20261004120000_notes.sql"]).toBe("");
      expect((await t.ejecutar("ls /supabase/migrations")).stdout).toBe("20261004120000_notes.sql\n");
    }, 20_000);

    it("🔴 db push recibe lo escrito en el MISMO comando, sólo lo de /supabase/, y su código de salida manda", async () => {
      const { t, llamadas } = conSupabase(async () => ({ stdout: "Connecting to remote database...\n", stderr: "ERROR: boom\n", exitCode: 1 }));
      const r = await t.ejecutar(
        "mkdir -p /supabase/migrations && echo 'create table a (id int);' > /supabase/migrations/20261004120000_a.sql && supabase db push --dry-run; echo rc=$?",
      );
      expect(llamadas[0]!.args).toEqual(["db", "push", "--dry-run"]);
      expect(llamadas[0]!.ficheros).toEqual({ "/supabase/migrations/20261004120000_a.sql": "create table a (id int);\n" });
      expect(r.stdout).toBe("Connecting to remote database...\nrc=1\n");
      expect(r.stderr).toBe("ERROR: boom\n");
    }, 20_000);

    it("si el hilo de la app falla, el comando falla y lo dice; la terminal sigue", async () => {
      const { t } = conSupabase(async () => {
        throw new Error("la base no contesta");
      });
      const r = await t.ejecutar("supabase status");
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toBe("supabase: la base no contesta\n");
      expect((await t.ejecutar("echo sigue")).stdout).toBe("sigue\n");
    }, 20_000);

    it("BRAZO DE CONTROL: sin backend no hay comando (no se finge)", async () => {
      const { t } = terminal();
      const r = await t.ejecutar("supabase status");
      expect(r.exitCode).toBe(127);
    }, 20_000);
  });

  // Plan 03 de las apps: `tsc`, `eslint`, `npx` y `npm` en una app los contesta
  // el comprobador de verdad (en el hilo de la app); `npm install`, el catálogo.
  describe("tsc, eslint, npx y npm en una app (plan 03, tarea 5)", () => {
    function conApp() {
      const llamadas: { program: string; args: readonly string[]; ficheros: Readonly<Record<string, string>> }[] = [];
      const { t } = terminal({
        appTools: {
          catalogSpecifiers: ["react", "zod", "@radix-ui/react-dialog"],
          typesPackages: ["@types/react"],
          run: async (program, args, ficheros) => {
            llamadas.push({ program, args, ficheros });
            return program === "tsc"
              ? { stdout: "src/App.tsx(5,17): error TS2322: Type 'number' is not assignable to type 'string'.\n", stderr: "", exitCode: 2 }
              : { stdout: "", stderr: "", exitCode: 0 };
          },
        },
      });
      return { t, llamadas };
    }

    it("🔴 npx tsc --noEmit corre el comprobador con los ficheros como están AHORA, y su código de salida manda", async () => {
      const { t, llamadas } = conApp();
      const r = await t.ejecutar("mkdir -p /src && echo 'export const n: string = 3;' > /src/App.tsx && npx tsc --noEmit; echo rc=$?");
      expect(llamadas[0]!.program).toBe("tsc");
      expect(llamadas[0]!.args).toEqual(["--noEmit"]);
      expect(llamadas[0]!.ficheros["/src/App.tsx"]).toBe("export const n: string = 3;\n");
      expect(r.stdout).toBe("src/App.tsx(5,17): error TS2322: Type 'number' is not assignable to type 'string'.\nrc=2\n");
    }, 20_000);

    it("npm run lint y npx eslint . son ESLint; npm run typecheck y tsc son TypeScript", async () => {
      const { t, llamadas } = conApp();
      await t.ejecutar("npm run lint; npx eslint .; npm run typecheck; tsc");
      expect(llamadas.map((l) => l.program)).toEqual(["eslint", "eslint", "tsc", "tsc"]);
      expect(llamadas[0]!.args).toEqual(["."]);
    }, 20_000);

    it("🔴 npm install: lo del catálogo ya está; lo demás no se puede (Review Focus 5)", async () => {
      const { t } = conApp();
      const si = await t.ejecutar("npm install zod @radix-ui/react-dialog@1.1.0; echo rc=$?");
      expect(si.stdout).toMatch(/zod.*already available/);
      expect(si.stdout).toMatch(/@radix-ui\/react-dialog: already available/);
      expect(si.stdout).toMatch(/rc=0\n$/);
      const no = await t.ejecutar("npm i axios; echo rc=$?");
      expect(no.stdout + no.stderr).toMatch(/axios.*isn't available/);
      expect(no.stdout).toMatch(/rc=1\n$/);
    }, 20_000);

    it("🔴 npm install -D @types/react: ya está (los tipos vienen con el catálogo); @types/node, no", async () => {
      const { t } = conApp();
      const si = await t.ejecutar("npm install -D @types/react; echo rc=$?");
      expect(si.stdout).toMatch(/@types\/react: already available \(its types come with the catalog\)\nrc=0\n$/);
      const no = await t.ejecutar("npm i --save-dev @types/node; echo rc=$?");
      expect(no.stderr).toMatch(/@types\/node: isn't available here/);
      expect(no.stdout).toMatch(/rc=1\n$/);
    }, 20_000);

    it("🔴 los comandos de pruebas de Claude Code corren vitest; npm run build, el paquete; un npx de otra cosa no existe", async () => {
      const { t, llamadas } = conApp();
      const comandos = ["npm test", "npm run test", "npm run test:unit", "pnpm test", "yarn test", "bun test", "npx vitest run src/a", "vitest", "npm test -- -t suma"];
      for (const c of comandos) expect((await t.ejecutar(`${c}; echo rc=$?`)).stdout, c).toMatch(/rc=0\n$/);
      expect(llamadas.map((l) => l.program)).toEqual(comandos.map(() => "test"));
      expect(llamadas.map((l) => l.args)).toEqual([[], [], [], [], [], [], ["run", "src/a"], [], ["-t", "suma"]]);
      const jest = await t.ejecutar("jest; echo rc=$?");
      expect(jest.stderr).toBe("jest isn't available here: tests run with vitest, which has the same API (vi.fn instead of jest.fn). Run npm test.\n");
      expect(jest.stdout).toMatch(/rc=1\n$/);
      expect((await t.ejecutar("pnpm add zod; echo rc=$?")).stderr).toBe("pnpm add: not available here — there is no package manager; the app's packages are its catalog.\n");
      expect((await t.ejecutar("npx prettier .; echo rc=$?")).stdout).toMatch(/rc=1\n$/);
      expect((await t.ejecutar("npm run x")).stderr).toMatch(/The scripts are: lint, typecheck, build, test\.\n$/);
      const { t: t2, llamadas: l2 } = conApp();
      await t2.ejecutar("npm run build");
      expect(l2.map((l) => l.program)).toEqual(["build"]);
    }, 30_000);

    it("🔴 npm test que se queda sin tiempo corta el COMANDO entero, como Claude Code mata a vitest: lo que imprimió, el aviso delante y 143; lo de detrás no corre", async () => {
      const { t } = terminal({
        appTools: {
          catalogSpecifiers: ["react"],
          run: async () => ({ stdout: "\n RUN  v4.1.11 /\n\n ✓ src/a.test.js (1 test) 2ms\n", stderr: "", exitCode: 143, timedOut: true }),
        },
      });
      const r = await t.ejecutar("npm test; echo despues", { timeoutMs: 5_000 });
      expect(r.stdout).toBe("Command timed out after 5s \n RUN  v4.1.11 /\n\n ✓ src/a.test.js (1 test) 2ms\n");
      expect(r.exitCode).toBe(143);
    }, 20_000);

    it("🔴 `timeout N npm test` corta sólo npm test, como en bash: el guion sigue, $? es 124, lo de antes se queda, y las pruebas paran", async () => {
      // Turnos reales del 09/10: `timeout 2 npm test` abortaba el guion ENTERO
      // («bash: execution aborted», sin nada de lo impreso): just-bash da 25 ms
      // a un comando abortado para acabar, y npm test seguía esperando.
      let señal: AbortSignal | undefined;
      const { t } = terminal({
        appTools: {
          catalogSpecifiers: ["react"],
          run: (_program, _args, _ficheros, _timeLeftMs, signal) => {
            señal = signal;
            return new Promise((resolve) => setTimeout(() => resolve({ stdout: "tarde\n", stderr: "", exitCode: 0 }), 8_000));
          },
        },
      });
      const t0 = Date.now();
      const r = await t.ejecutar('echo antes; timeout 1 npm test; echo "rc=$?"; echo despues');
      expect(r.stdout).toBe("antes\nrc=124\ndespues\n");
      expect(r.exitCode).toBe(0);
      expect(Date.now() - t0).toBeLessThan(5_000);
      // Lo que arrancó el comando acaba con él: al hilo de la app le llega la orden de parar.
      await new Promise((ok) => setTimeout(ok, 100));
      expect(señal?.aborted).toBe(true);
    }, 20_000);

    it("npm install -D vitest y lo del kit: ya están; jsdom no hace falta", async () => {
      const { t } = conApp();
      const r = await t.ejecutar("npm install -D vitest @testing-library/react jsdom; echo rc=$?");
      expect(r.stdout).toBe(
        "vitest: already available (tests run with OpenLen's test kit)\n@testing-library/react: already available (test kit)\njsdom: not needed: tests run in a real browser (Chromium), like Vitest's browser mode\nrc=0\n",
      );
    }, 20_000);

    it("en una página (sin appTools) no hay tsc ni npm", async () => {
      const { t } = terminal({});
      expect((await t.ejecutar("tsc; echo rc=$?")).stdout).toMatch(/rc=127\n$/);
    }, 20_000);
  });
});
