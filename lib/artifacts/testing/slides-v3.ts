import type { SealedArtifactInput } from "../types";

/** A saved image the deck shows; any PNG/JPEG bytes. */
export const DECK_PHOTO = "0b9f5c1e-8d1a-4b6f-9a51-1f2b3c4d5e6f@1/0";

const cover = `<section id="cover" data-transition="fade" style="background:linear-gradient(135deg,#0f2a3d,#1d4e5f);color:#fbfbf8;padding:128px;display:flex;align-items:center;gap:96px">
<div style="flex:1;display:flex;flex-direction:column;gap:32px">
<p style="font-size:24px;font-weight:600;letter-spacing:3px;text-transform:uppercase;color:#f5b041">Turnia · reservas para barberías</p>
<h1 style="font-size:104px;line-height:1.05;letter-spacing:-2px">Tu agenda llena,<br>sin llamadas.</h1>
<p style="font-size:36px;line-height:1.35;color:#c9d6dd;width:860px">Tus clientes reservan en 30 segundos desde el celular y tú confirmas por <b>WhatsApp</b>.</p>
</div>
<img src="asset:${DECK_PHOTO}" alt="La agenda de Turnia en un celular" style="width:520px;height:640px;object-fit:cover;border-radius:32px;box-shadow:0 24px 64px rgba(0,0,0,.35)">
<p style="position:absolute;left:128px;bottom:64px;font-size:24px;color:#8fa6b2">Presentación para dueños de barberías · 2026</p>
<aside>Abre con el dolor: cada cita perdida es dinero que no vuelve.</aside>
</section>`;

const card = (n: string, label: string, accent: string) => `<div style="flex:1;position:relative;background:#ffffff;border:1px solid #e3e6e4;border-radius:16px;padding:48px 48px 48px 64px;display:flex;flex-direction:column;gap:12px;box-shadow:0 4px 24px rgba(15,42,61,.06)">
<div style="position:absolute;left:0;top:32px;width:6px;height:96px;background:${accent};border-radius:3px"></div>
<p style="font-size:120px;font-weight:600;line-height:1;color:#0f2a3d">${n}</p>
<p style="font-size:30px;color:#4a5568">${label}</p>
</div>`;
const problem = `<section id="problema" style="background:#fbfbf8;color:#1a1a1a;padding:128px;display:flex;flex-direction:column;justify-content:space-between">
<h2 style="font-size:72px;font-weight:600;line-height:1.1">Lo que cuesta una cita perdida</h2>
<div style="display:flex;gap:32px">
${card("1 de 5", "citas se pierde por no confirmar", "#f59e0b")}
${card("$250", "gasta un cliente cada mes", "#2b7a78")}
${card("−30 %", "citas perdidas el primer mes", "#0f2a3d")}
</div>
<p style="font-size:28px;color:#6a7179;border-top:2px solid #e3e6e4;padding-top:24px">Fuente: <i>datos de la app</i> · <a href="https://openlen.app">openlen.app</a></p>
</section>`;

const bars = [["Lun", 9], ["Mar", 12], ["Mié", 10], ["Jue", 14], ["Vie", 18], ["Sáb", 22]] as const;
const chart = `<svg aria-label="Citas por día de la semana" width="760" height="440" viewBox="0 0 760 440">${bars.map(([, v], i) => `<rect x="${20 + i * 124}" y="${420 - v * 18}" width="80" height="${v * 18}" rx="8" fill="${i === 5 ? "#f59e0b" : "#2b7a78"}"/>`).join("")}<line x1="0" y1="420" x2="760" y2="420" stroke="#c9d6dd" stroke-width="2"/></svg>`;
const data = `<section id="datos" data-transition="push" style="background:#ffffff;color:#1a1a1a;padding:128px;display:grid;grid-template-columns:1fr 1fr;gap:64px">
<div style="display:flex;flex-direction:column;gap:32px">
<h2 style="font-size:64px;line-height:1.1">El sábado se llena solo</h2>
${chart}
<div style="display:flex;gap:44px;padding-left:20px">${bars.map(([d]) => `<p style="width:80px;font-size:24px;text-align:center;color:#6a7179">${d}</p>`).join("")}</div>
</div>
<div style="display:flex;flex-direction:column;gap:40px">
<ul style="font-size:32px;line-height:1.4;display:flex;flex-direction:column;gap:16px"><li>Recordatorio automático un día antes</li><li>Confirmación con un toque</li><li>Lista de espera para huecos libres</li></ul>
<table style="font-size:28px;color:#1a1a1a"><tr style="background:#f4f4f2"><th style="width:60%">Servicio</th><th style="text-align:right">Precio</th></tr><tr><td>Corte clásico</td><td style="text-align:right">$180</td></tr><tr><td>Corte + barba</td><td style="text-align:right">$260</td></tr></table>
<p style="font-size:44px;font-weight:600;color:#0f2a3d;background:#fdf2dc;padding:24px 40px;border-radius:999px;align-self:flex-start">$299 al mes, todo incluido</p>
</div>
<aside>Cierra con el precio: menos de dos cortes al mes.</aside>
</section>`;

export function slidesV3Fixture(photo: Uint8Array, mime: "image/png" | "image/jpeg" = "image/png"): SealedArtifactInput {
  return {
    artifact: { kind: "slides" },
    revision: { files: { "deck.json": JSON.stringify({ version: 3, title: "Turnia — presentación", order: ["cover", "problema", "datos"], sections: { s1: { description: "Por qué y cuánto", start: "cover" } } }), "slides/cover.html": cover, "slides/problema.html": problem, "slides/datos.html": data } },
    assets: [{ id: DECK_PHOTO, mime, bytes: photo }],
    datasets: [],
  } as unknown as SealedArtifactInput;
}
