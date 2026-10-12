// @vitest-environment node
//
// `supabase secrets …` en la terminal de Len (spec local 2026-10-11, Parte 4):
// los textos de la CLI de Supabase (apps/cli/src/commands/secrets, HEAD del
// 12/10/2026), siempre contra el BORRADOR (Len nunca escribe en producción).
import { describe, expect, it } from "vitest";

import { renderGlamourTable, runCli, type CliBackend, type SecretsCli } from "./cli-core";

const nada = () => {
  throw new Error("no en esta prueba");
};
const DEBUG = "Try rerunning the command with --debug to troubleshoot the error.\n";

function backend(sx: Partial<SecretsCli> | null) {
  const guardados: Record<string, string>[] = [];
  const quitados: string[][] = [];
  const b: CliBackend = {
    status: nada,
    remoteMigrations: nada,
    liveMigrations: nada,
    applyMigration: nada,
    reset: nada,
    query: nada,
    secrets:
      sx === null
        ? null
        : {
            list: async () => [{ name: "STRIPE_SECRET_KEY", digest: "a".repeat(64) }],
            set: async (e) => (guardados.push({ ...e }), { ok: true as const }),
            unset: async (n) => void quitados.push([...n]),
            ...sx,
          },
  };
  return { b, guardados, quitados };
}

describe("renderGlamourTable (la de supabase/cli)", () => {
  it("línea en blanco, línea decorativa, cabecera, guiones, filas y otra en blanco", () => {
    expect(renderGlamourTable(["NAME", "DIGEST"], [["A", "d1"]])).toBe("\n  \n   NAME | DIGEST \n  ------|--------\n   A    | d1     \n\n");
    expect(renderGlamourTable(["NAME", "DIGEST"], [])).toBe("\n  \n   NAME | DIGEST \n  ------|--------\n\n");
  });
});

describe("supabase secrets set", () => {
  it("NAME=VALUE al borrador, con el texto de la CLI (el valor puede llevar `=`)", async () => {
    const { b, guardados } = backend({});
    expect(await runCli(["secrets", "set", "STRIPE_SECRET_KEY=sk_test_1", "TOKEN=a=b"], {}, b)).toEqual({ stdout: "Finished supabase secrets set.\n", stderr: "", exitCode: 0 });
    expect(guardados).toEqual([{ STRIPE_SECRET_KEY: "sk_test_1", TOKEN: "a=b" }]);
  });

  it("--env-file lee el fichero DEL PROYECTO, y lo de la orden gana", async () => {
    const { b, guardados } = backend({});
    const r = await runCli(["secrets", "set", "--env-file", "supabase/functions/.env", "B=orden"], { "/supabase/functions/.env": "A=fichero\nB=fichero\n" }, b);
    expect(r.exitCode).toBe(0);
    expect(guardados).toEqual([{ A: "fichero", B: "orden" }]);
    expect((await runCli(["secrets", "set", "--env-file=.env"], {}, b)).stderr).toBe(`failed to open env file: open .env: no such file or directory\n${DEBUG}`);
  });

  it("SUPABASE_ (y AWS_, LAMBDA_) se saltan con el aviso de la CLI; sin nada que guardar, su error", async () => {
    const { b, guardados } = backend({});
    expect(await runCli(["secrets", "set", "SUPABASE_URL=x", "AWS_REGION=y", "K=v"], {}, b)).toEqual({
      stdout: "Finished supabase secrets set.\n",
      stderr: "Env name cannot start with SUPABASE_, skipping: SUPABASE_URL\nEnv name cannot start with AWS_, skipping: AWS_REGION\n",
      exitCode: 0,
    });
    expect(guardados).toEqual([{ K: "v" }]);
    expect(await runCli(["secrets", "set", "SUPABASE_URL=x"], {}, b)).toEqual({
      stdout: "",
      stderr: `Env name cannot start with SUPABASE_, skipping: SUPABASE_URL\nNo arguments found. Use --env-file to read from a .env file.\n${DEBUG}`,
      exitCode: 1,
    });
  });

  it("un par sin `=`, con el texto de la CLI", async () => {
    const { b } = backend({});
    expect(await runCli(["secrets", "set", "NOTAPAIR"], {}, b)).toEqual({ stdout: "", stderr: `Invalid secret pair: NOTAPAIR. Must be NAME=VALUE.\n${DEBUG}`, exitCode: 1 });
  });

  it("lo que el núcleo rechaza (un nombre, los 4 KB) sale tal cual, código 1", async () => {
    const { b } = backend({ set: async () => ({ ok: false, message: "Edge Function secrets don't fit: …\n" }) });
    expect(await runCli(["secrets", "set", "K=v"], {}, b)).toEqual({ stdout: "", stderr: "Edge Function secrets don't fit: …\n", exitCode: 1 });
  });
});

describe("supabase secrets list", () => {
  it("NAME | DIGEST del borrador (la huella, nunca el valor)", async () => {
    const { b } = backend({});
    const r = await runCli(["secrets", "list"], {}, b);
    expect(r).toEqual({ stdout: renderGlamourTable(["NAME", "DIGEST"], [["STRIPE_SECRET_KEY", "a".repeat(64)]]), stderr: "", exitCode: 0 });
  });
});

describe("supabase secrets unset", () => {
  it("con nombres: la pregunta de la CLI (sin terminal, «sí» por defecto) y los quita", async () => {
    const { b, quitados } = backend({});
    expect(await runCli(["secrets", "unset", "K", "OTRA"], {}, b)).toEqual({
      stdout: "Finished supabase secrets unset.\n",
      stderr: "Do you want to unset these function secrets?\n • K\n • OTRA\n\n [Y/n] \n",
      exitCode: 0,
    });
    expect(quitados).toEqual([["K", "OTRA"]]);
  });

  it("sin nombres: todos los del borrador; sin ninguno, nada que hacer", async () => {
    const { b, quitados } = backend({});
    expect((await runCli(["secrets", "unset"], {}, b)).exitCode).toBe(0);
    expect(quitados).toEqual([["STRIPE_SECRET_KEY"]]);
    const vacio = backend({ list: async () => [] });
    expect(await runCli(["secrets", "unset"], {}, vacio.b)).toEqual({ stdout: "", stderr: "You have not set any function secrets, nothing to do.\n", exitCode: 0 });
  });
});

it("sin motor lo dice (no lo finge); un subcomando que no existe, también", async () => {
  expect((await runCli(["secrets", "list"], {}, backend(null).b)).stderr).toBe("Error: Edge Functions are not available on this server.\n");
  expect((await runCli(["secrets", "rotate"], {}, backend({}).b)).stderr).toBe(`Error: unknown command "secrets rotate" for "supabase"\nRun 'supabase --help' for usage.\n`);
});
