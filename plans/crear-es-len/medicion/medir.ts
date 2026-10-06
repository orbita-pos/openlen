// plans/crear-es-len/medicion/medir.ts — TAREA 11: Crear contra Len, lado a lado.
//
// Los seis briefs del README, una vez por camino, contra el servidor de
// Len-Bench (que es local, graba los turnos de Len y tiene apagado todo lo que
// tocaría producción: lib/len-bench/entorno.ts).
//
//   1) En una terminal:   npm run bench:len:servidor
//   2) En otra, el estimado ($0, no llama a nadie):
//        npx tsx --tsconfig tsconfig.eval.json --env-file=.env.local \
//          --require ./scripts/test-node-server-only-shim.cjs plans/crear-es-len/medicion/medir.ts
//   3) Y para correrlo de verdad (GASTA), con el techo aprobado:
//        … plans/crear-es-len/medicion/medir.ts --yes --budget-usd=2
//
//   Opciones: --solo=comida,minimo  · --base=http://localhost:3007
//
// Qué mide de cada creación: el tiempo hasta el PRIMER TROZO PINTADO (el primer
// `html_chunk` de Crear, el primer `page_preview` de Len), el tiempo total, el
// coste (lo que bajó el saldo de la identidad de eval: los créditos son el
// coste del proveedor, 1 crédito = 0,01 $, así que es la MISMA vara para los
// dos caminos), los pasos de Len y si miró la página. Y hace las capturas de
// escritorio y móvil de cada página guardada.
//
// Escribe en esta carpeta: resultados.json, resultados.md y capturas/.
//
// ⚠️ Es de usar y tirar: se va con Crear en la Tarea 12.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { usdDeCenticreditos } from "@/lib/credits";
import { PAGE_COHORT, type PageEvalCase } from "@/lib/evals/page-cohort";
import { historialParaElAgente } from "@/lib/chat/historial-del-agente";
import { arrancarCorredor } from "@/lib/len-bench/arranque";
import { BASE_LEN_BENCH } from "@/lib/len-bench/entorno";
import { bajarComoUnVisitante } from "@/lib/len-bench/capturas";
import { cerrarPestana, lanzarNavegador } from "@/lib/len-bench/navegador";
import { herramientasDeLen } from "@/lib/len-bench/sesion";
import { crearLectorSse } from "@/lib/len-bench/sse";
import type { ProjectData } from "@/lib/projects/types";

const BRIEFS = ["comida", "referencia-calida", "saas", "sorteo", "multipagina", "minimo"] as const;
const DIR = path.join("plans", "crear-es-len", "medicion");
const DIR_CAPTURAS = path.join(DIR, "capturas");
/** El techo aprobado por Jesús el 06/10 (README §2). */
const TOPE_POR_DEFECTO_USD = 2;
/** Un turno que se pasa de esto se para (como el ■) y se apunta como fallido. */
const PLAZO_MS = 15 * 60_000;
const ZONA = "America/Mexico_City";

type Camino = "crear" | "len";

/** El pesimista del README, por creación: con él se decide si la SIGUIENTE cabe. */
function estimadoPesimista(camino: Camino, caso: PageEvalCase): number {
  const multi = caso.id === "multipagina";
  if (camino === "crear") return multi ? 0.06 : 0.015;
  return multi ? 0.15 : 0.08;
}

interface Medida {
  readonly brief: string;
  readonly camino: Camino;
  readonly projectId: string | null;
  /** ms desde que se envió hasta el primer trozo de página que el lienzo pinta. */
  readonly primerTrozoMs: number | null;
  readonly totalMs: number;
  readonly usd: number;
  readonly centicreditos: number;
  /** Len: llamadas a herramientas del turno (`done.toolCalls`). */
  readonly pasos: number | null;
  /** Len: las herramientas que usó, en orden y sin repetir. */
  readonly herramientas: readonly string[];
  /** Len: ¿miró la página? (`view_page` o `use_page`). */
  readonly miro: boolean | null;
  /** Len: ¿se paró a preguntar al dueño en vez de construir? */
  readonly pregunto: boolean | null;
  /** Len: lo que la ruta dijo haber cobrado (`done.centicredits`), para cotejarlo con el saldo. */
  readonly cobradoSegunLen: number | null;
  /** Crear: avisos `medida` y subpáginas escritas. */
  readonly medidas: number | null;
  readonly subpaginas: number | null;
  readonly paginas: readonly string[];
  readonly error: string | null;
}

function arg(n: string): string | undefined {
  const a = process.argv.find((x) => x === n || x.startsWith(`${n}=`));
  return a?.includes("=") ? a.slice(a.indexOf("=") + 1) : a ? "" : undefined;
}

interface EventoConHora {
  readonly nombre: string;
  readonly datos: unknown;
  readonly ms: number;
}

/** El stream SSE, con la hora de llegada de cada evento (ms desde `t0`). */
async function leerSse(r: Response, t0: number): Promise<EventoConHora[]> {
  if (!r.body) return [];
  const lector = crearLectorSse();
  const eventos: EventoConHora[] = [];
  const dec = new TextDecoder();
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const ms = performance.now() - t0;
    for (const e of lector.empujar(dec.decode(value, { stream: true }))) eventos.push({ ...e, ms });
  }
  const ms = performance.now() - t0;
  for (const e of lector.empujar(dec.decode() + "\n\n")) eventos.push({ ...e, ms });
  return eventos;
}

const datos = (e: EventoConHora | undefined) => (e?.datos ?? {}) as Record<string, unknown>;

async function saldo(userId: string): Promise<number> {
  const [fila] = await db.select({ credits: schema.users.credits }).from(schema.users).where(eq(schema.users.id, userId));
  return Number(fila?.credits ?? 0);
}

/** La imagen del caso, como la sube quien la adjunta. */
function imagenDelCaso(caso: PageEvalCase): { buf: Buffer; mime: string; nombre: string } | null {
  const ruta = (caso as { imagen?: string }).imagen;
  if (!ruta) return null;
  const ext = path.extname(ruta).toLowerCase();
  const mime = ext === ".webp" ? "image/webp" : ext === ".png" ? "image/png" : ext === ".avif" ? "image/avif" : "image/jpeg";
  return { buf: fs.readFileSync(ruta), mime, nombre: path.basename(ruta) };
}

async function correrCrear(base: string, cookie: string, caso: PageEvalCase): Promise<Omit<Medida, "usd" | "centicreditos" | "paginas">> {
  const img = imagenDelCaso(caso);
  // El cuerpo que manda el héroe de Crear: el brief y, si hay, las referencias
  // como `data:` (app/api/generate/route.ts, `referenceImages`).
  const cuerpo = {
    brief: caso.brief,
    ...(img ? { referenceImages: [{ mimeType: img.mime, dataBase64: img.buf.toString("base64") }] } : {}),
  };
  const t0 = performance.now();
  const r = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(PLAZO_MS),
  });
  if (!r.ok) throw new Error(`/api/generate respondió ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const ev = await leerSse(r, t0);
  const totalMs = performance.now() - t0;
  const guardado = ev.find((e) => e.nombre === "project_saved");
  const error = ev.find((e) => e.nombre === "error");
  return {
    brief: caso.id,
    camino: "crear",
    projectId: typeof datos(guardado).projectId === "string" ? (datos(guardado).projectId as string) : null,
    primerTrozoMs: ev.find((e) => e.nombre === "html_chunk")?.ms ?? null,
    totalMs,
    pasos: null,
    herramientas: [],
    miro: null,
    pregunto: null,
    cobradoSegunLen: null,
    medidas: ev.filter((e) => e.nombre === "medida").length,
    subpaginas: ev.filter((e) => e.nombre === "pagina-escribiendo").length,
    error: error ? String(datos(error).message ?? "error") : guardado ? null : "el stream acabó sin project_saved",
  };
}

async function correrLen(base: string, cookie: string, caso: PageEvalCase): Promise<Omit<Medida, "usd" | "centicreditos" | "paginas">> {
  // El camino de /new: el proyecto en blanco, las fotos subidas por
  // /api/upload (lib/workspace-v2/upload-photos.ts) y el primer mensaje a Len.
  const pr = await fetch(`${base}/api/projects`, { method: "POST", headers: { cookie } });
  const { id: projectId } = (await pr.json()) as { id?: string };
  if (!pr.ok || !projectId) throw new Error(`/api/projects respondió ${pr.status}`);

  const img = imagenDelCaso(caso);
  const fotos: { url: string }[] = [];
  if (img) {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(img.buf)], img.nombre, { type: img.mime }));
    form.append("generationId", projectId);
    const up = await fetch(`${base}/api/upload`, { method: "POST", headers: { cookie }, body: form });
    const j = (await up.json().catch(() => null)) as { url?: unknown } | null;
    if (!up.ok || typeof j?.url !== "string") throw new Error(`/api/upload respondió ${up.status}`);
    fotos.push({ url: j.url });
  }

  const { history, historyTotal, dichoAntes } = historialParaElAgente([], null);
  const cuerpo = {
    projectId,
    prompt: caso.brief,
    turnId: randomUUID(),
    history,
    historyTotal,
    dichoAntes,
    // Lo que manda el panel de un usuario nuevo (lib/len-bench/sesion.ts).
    esfuerzo: "auto",
    zonaHoraria: ZONA,
    ...(fotos.length ? { attachedImages: fotos, attachedImage: fotos[0] } : {}),
  };

  const abort = new AbortController();
  let turnoId: string | null = null;
  // Al pasarse del plazo se le pide PARAR, como el ■: abortar sólo la lectura
  // dejaría a Len trabajando —y gastando— detrás.
  const reloj = setTimeout(async () => {
    if (turnoId) {
      await fetch(`${base}/api/agent/cancelar`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ turnoId }),
      }).catch(() => {});
    }
    abort.abort();
  }, PLAZO_MS);
  const t0 = performance.now();
  try {
    const r = await fetch(`${base}/api/agent`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(cuerpo),
      signal: abort.signal,
    });
    if (!r.ok) throw new Error(`/api/agent respondió ${r.status}: ${(await r.text()).slice(0, 300)}`);
    // Para poder pedirle parar hay que conocer el turno mientras se lee.
    const ev: EventoConHora[] = [];
    if (r.body) {
      const lector = crearLectorSse();
      const dec = new TextDecoder();
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const ms = performance.now() - t0;
        for (const e of lector.empujar(dec.decode(value, { stream: true }))) {
          const id = (e.datos as { turnoId?: unknown } | null)?.turnoId;
          if (e.nombre === "turno" && typeof id === "string") turnoId = id;
          ev.push({ ...e, ms });
        }
      }
      const ms = performance.now() - t0;
      for (const e of lector.empujar(dec.decode() + "\n\n")) ev.push({ ...e, ms });
    }
    const totalMs = performance.now() - t0;
    const fin = ev.find((e) => e.nombre === "done");
    const error = ev.find((e) => e.nombre === "error");
    const herramientas = herramientasDeLen(ev);
    return {
      brief: caso.id,
      camino: "len",
      projectId,
      primerTrozoMs: ev.find((e) => e.nombre === "page_preview")?.ms ?? null,
      totalMs,
      pasos: typeof datos(fin).toolCalls === "number" ? (datos(fin).toolCalls as number) : null,
      herramientas,
      miro: herramientas.includes("view_page") || herramientas.includes("use_page"),
      pregunto: herramientas.includes("ask_user_question"),
      cobradoSegunLen: typeof datos(fin).centicredits === "number" ? (datos(fin).centicredits as number) : null,
      medidas: null,
      subpaginas: null,
      error: error ? String(datos(error).message ?? "error") : fin ? null : "el stream acabó sin done",
    };
  } finally {
    clearTimeout(reloj);
  }
}

async function paginasGuardadas(projectId: string): Promise<{ slug: string; html: string }[]> {
  const [fila] = await db.select({ data: schema.projects.data }).from(schema.projects).where(eq(schema.projects.id, projectId));
  const data = (fila?.data ?? {}) as ProjectData;
  const out: { slug: string; html: string }[] = [];
  if (data.html) out.push({ slug: "index", html: data.html });
  for (const [slug, p] of Object.entries(data.pages ?? {})) if (p?.html) out.push({ slug, html: p.html });
  return out;
}

const VISTAS = [
  { nombre: "escritorio", width: 1440, height: 900, isMobile: false },
  { nombre: "movil", width: 390, height: 844, isMobile: true },
] as const;

/** El documento GUARDADO, tal cual, en las dos vistas y entero. Se abre desde
 *  un fichero (no con `setContent`) para poder esperar a `networkidle0` —el
 *  Tailwind del CDN, las fuentes, las fotos—, y se baja como un visitante para
 *  que lo que aparece al hacer scroll aparezca (lib/len-bench/capturas.ts). */
async function capturar(navegador: Awaited<ReturnType<typeof lanzarNavegador>>, m: Medida, paginas: { slug: string; html: string }[]): Promise<void> {
  fs.mkdirSync(DIR_CAPTURAS, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "medir-"));
  try {
    for (const p of paginas) {
      const fichero = path.join(tmp, `${p.slug}.html`);
      fs.writeFileSync(fichero, p.html);
      for (const v of VISTAS) {
        const page = await navegador.newPage();
        try {
          await page.setViewport({ width: v.width, height: v.height, isMobile: v.isMobile, hasTouch: v.isMobile });
          await page.goto(pathToFileURL(fichero).href, { waitUntil: "networkidle0", timeout: 45_000 }).catch(() => undefined);
          await bajarComoUnVisitante(page);
          const destino = path.join(DIR_CAPTURAS, nombreDeCapturaLocal(m, p.slug, v.nombre));
          fs.writeFileSync(destino, await page.screenshot({ type: "webp", quality: 70, fullPage: true }));
        } finally {
          await cerrarPestana(page);
        }
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function nombreDeCapturaLocal(m: Pick<Medida, "brief" | "camino">, slug: string, vista: string): string {
  return `${m.brief}-${m.camino}-${slug}-${vista}.webp`;
}

const s = (ms: number | null) => (ms === null ? "—" : `${(ms / 1000).toFixed(1)} s`);

function informe(medidas: readonly Medida[], tope: number): string {
  const l: string[] = [
    "# Tarea 11 — resultados",
    "",
    `Generado por \`medir.ts\` el ${new Date().toISOString()}. Una corrida por brief y camino (n=1). Techo: ${tope.toFixed(2)} $.`,
    "",
    "## Las páginas (antes que los números)",
    "",
  ];
  for (const brief of BRIEFS) {
    const c = medidas.find((m) => m.brief === brief && m.camino === "crear");
    const n = medidas.find((m) => m.brief === brief && m.camino === "len");
    if (!c && !n) continue;
    l.push(`### ${brief}`, "", "| | Crear | Len |", "|---|---|---|");
    const slugs = [...new Set([...(c?.paginas ?? []), ...(n?.paginas ?? [])])];
    for (const slug of slugs) {
      for (const v of VISTAS) {
        const celda = (m: Medida | undefined) =>
          m?.paginas.includes(slug) ? `![](capturas/${nombreDeCapturaLocal(m, slug, v.nombre)})` : "—";
        l.push(`| ${slug} · ${v.nombre} | ${celda(c)} | ${celda(n)} |`);
      }
    }
    l.push("");
  }
  l.push(
    "## Los números",
    "",
    "| Brief | Camino | Primer trozo | Total | Coste | Pasos | Miró | Herramientas | Notas |",
    "|---|---|---|---|---|---|---|---|---|",
  );
  for (const m of medidas) {
    const notas = [
      m.error ? `❌ ${m.error}` : "",
      m.pregunto ? "preguntó al dueño" : "",
      m.camino === "crear" && m.subpaginas ? `${m.subpaginas} subpágina(s)` : "",
      m.camino === "crear" && m.medidas ? `${m.medidas} aviso(s) medida` : "",
      m.paginas.length > 1 ? `${m.paginas.length} páginas` : "",
      m.cobradoSegunLen !== null && Math.abs(m.cobradoSegunLen - m.centicreditos) > 1
        ? `la ruta dijo ${usdDeCenticreditos(m.cobradoSegunLen).toFixed(4)} $`
        : "",
    ].filter(Boolean).join("; ");
    l.push(
      `| ${m.brief} | ${m.camino} | ${s(m.primerTrozoMs)} | ${s(m.totalMs)} | ${m.usd.toFixed(4)} $ | ${m.pasos ?? "—"} | ${m.miro === null ? "—" : m.miro ? "sí" : "no"} | ${m.herramientas.join(", ") || "—"} | ${notas || "—"} |`,
    );
  }
  const total = medidas.reduce((a, m) => a + m.usd, 0);
  l.push("", `Gasto total: **${total.toFixed(4)} $**.`, "");
  return l.join("\n");
}

async function main(): Promise<number> {
  const base = arg("--base") ?? BASE_LEN_BENCH;
  const tope = arg("--budget-usd") !== undefined ? Number(arg("--budget-usd")) : TOPE_POR_DEFECTO_USD;
  const solo = arg("--solo")?.split(",").filter(Boolean);
  const ids = BRIEFS.filter((b) => !solo || solo.includes(b));
  const casos = ids.map((id) => {
    const c = PAGE_COHORT.find((x) => x.id === id);
    if (!c) throw new Error(`el brief «${id}» no está en lib/evals/page-cohort.ts`);
    return c;
  });
  const estimado = casos.reduce((a, c) => a + estimadoPesimista("crear", c) + estimadoPesimista("len", c), 0);
  console.log(`Tarea 11 · ${casos.length} brief(s) × 2 caminos contra ${base}`);
  console.log(`Estimado PESIMISTA: ~${estimado.toFixed(2)} $ · Techo: ${tope.toFixed(2)} $`);
  if (estimado > tope) throw new Error(`RECHAZADO: el estimado pesimista pasa del techo. Sube --budget-usd o usa --solo.`);
  if (arg("--yes") === undefined) {
    console.log("Esto GASTA dinero real del proveedor. Vuelve a correr con --yes.");
    return 0;
  }

  const { owner, cookie } = await arrancarCorredor(base);
  // EL MISMO ESCRITOR PARA LOS DOS: Crear respeta lo que el dueño fijó en su
  // selector (`users.crearWriter`), y otra corrida pudo dejarlo en otro modelo.
  // Se pone en el de por defecto y se devuelve al acabar.
  //
  // Y EL SALDO QUIETO: el coste se lee como lo que BAJA el saldo, y la
  // renovación de 30 días (`lib/credits.ts`) lo REESCRIBE al plan la primera vez
  // que se mira si `creditsRefreshedAt` está vacío o vencido. Medido en el humo
  // del 06/10: 49,80 $ de «gasto» sin una sola llamada al modelo. Se marca como
  // recién renovado y también se devuelve al acabar.
  const [antes] = await db
    .select({ w: schema.users.crearWriter, renovado: schema.users.creditsRefreshedAt })
    .from(schema.users)
    .where(eq(schema.users.id, owner.id));
  await db.update(schema.users).set({ crearWriter: null, creditsRefreshedAt: new Date() }).where(eq(schema.users.id, owner.id));

  // CALENTAR las dos rutas: `next dev` compila la primera vez que se llama a
  // una ruta, y ese tiempo no es de ningún camino. Un cuerpo inválido compila
  // la ruta y se rechaza antes de llamar al modelo: no cuesta nada.
  for (const ruta of ["/api/generate", "/api/agent"]) {
    await fetch(`${base}${ruta}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: "{}" }).catch(() => {});
  }

  const navegador = await lanzarNavegador();
  const medidas: Medida[] = [];
  let gastado = 0;
  try {
    for (const [i, caso] of casos.entries()) {
      // El orden se ALTERNA por brief: así ningún camino va siempre segundo.
      const orden: Camino[] = i % 2 === 0 ? ["crear", "len"] : ["len", "crear"];
      for (const camino of orden) {
        if (gastado + estimadoPesimista(camino, caso) > tope) {
          console.log(`⛔ Parado antes de ${caso.id}/${camino}: ${gastado.toFixed(4)} $ gastados y la siguiente podría pasar del techo.`);
          return 2;
        }
        console.log(`→ ${caso.id} · ${camino}…`);
        const saldoAntes = await saldo(owner.id);
        let m: Omit<Medida, "usd" | "centicreditos" | "paginas">;
        try {
          m = camino === "crear" ? await correrCrear(base, cookie, caso) : await correrLen(base, cookie, caso);
        } catch (err) {
          m = {
            brief: caso.id, camino, projectId: null, primerTrozoMs: null, totalMs: 0, pasos: null, herramientas: [],
            miro: null, pregunto: null, cobradoSegunLen: null, medidas: null, subpaginas: null,
            error: err instanceof Error ? err.message : String(err),
          };
        }
        const centicreditos = Math.max(0, saldoAntes - (await saldo(owner.id)));
        const usd = usdDeCenticreditos(centicreditos);
        gastado += usd;
        // Una creación de más de 1 $ no es una creación: el saldo se movió por
        // otra cosa (una renovación, otra sesión usando la identidad). Se para:
        // los números ya no se pueden creer, y el techo tampoco.
        if (usd > 1) {
          console.log(`⛔ ${caso.id}/${camino}: el saldo bajó ${usd.toFixed(2)} $ — eso no es una creación. Parado.`);
          medidas.push({ ...m, usd, centicreditos, paginas: [], error: `el saldo se movió ${usd.toFixed(2)} $ por otra cosa` });
          return 1;
        }
        const paginas = m.projectId ? await paginasGuardadas(m.projectId) : [];
        const medida: Medida = { ...m, usd, centicreditos, paginas: paginas.map((p) => p.slug) };
        medidas.push(medida);
        if (paginas.length) await capturar(navegador, medida, paginas);
        console.log(
          `   primer trozo ${s(medida.primerTrozoMs)} · total ${s(medida.totalMs)} · ${usd.toFixed(4)} $` +
            `${medida.pasos !== null ? ` · ${medida.pasos} pasos` : ""}${medida.miro ? " · miró" : ""}${medida.error ? ` · ❌ ${medida.error}` : ""}`,
        );
        fs.writeFileSync(path.join(DIR, "resultados.json"), JSON.stringify(medidas, null, 2) + "\n");
      }
    }
  } finally {
    await navegador.close().catch(() => {});
    await db
      .update(schema.users)
      .set({ crearWriter: antes?.w ?? null, creditsRefreshedAt: antes?.renovado ?? null })
      .where(eq(schema.users.id, owner.id));
    fs.writeFileSync(path.join(DIR, "resultados.md"), informe(medidas, tope));
    console.log(`Gasto total: ${gastado.toFixed(4)} $ → ${path.join(DIR, "resultados.md")}`);
  }
  return medidas.some((m) => m.error) ? 1 : 0;
}

main().then(
  (c) => process.exit(c),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
