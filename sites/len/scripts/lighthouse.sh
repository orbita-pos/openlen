#!/usr/bin/env bash
# Lighthouse contra out/ servido en local. Usa el lighthouse de la raíz del repo y Edge
# (Chrome de Puppeteer no está instalado en esta máquina — memoria home-redesign-dawn).
#
# Dos cosas que costaron una vuelta cada una:
#
# · El serve se ata a 127.0.0.1 a propósito: con "-l 4321" a secas escucha sólo
#   en ::1 y cualquier cliente que resuelva localhost a IPv4 se come un
#   ECONNREFUSED.
# · En Windows, lighthouse TERMINA LA AUDITORÍA y luego revienta con EPERM al
#   borrar su perfil temporal de Chrome. El informe ya está escrito. Así que el
#   veredicto se lee del INFORME, no del código de salida — y si el informe no
#   existe o no trae las cuatro categorías, eso sí es un fallo.
set -uo pipefail
cd "$(dirname "$0")/.."
PORT=4321
HOST=127.0.0.1
CHROME_PATH="${CHROME_PATH:-/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe}"
export CHROME_PATH

rm -rf .lh && mkdir -p .lh
npx -y serve@14.2.4 out -l "tcp://$HOST:$PORT" >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
sleep 3

LH=../../node_modules/.bin/lighthouse
fallo=0
n=0
for url in "http://$HOST:$PORT/en/" "http://$HOST:$PORT/es/research/when-the-agent-said-done/"; do
  for preset in desktop mobile; do
    extra=(); [ "$preset" = desktop ] && extra=(--preset=desktop)
    n=$((n + 1))
    informe=".lh/$n.json"
    "$LH" "$url" --quiet --chrome-flags="--headless=new" \
      --only-categories=performance,accessibility,best-practices,seo \
      --output=json --output-path="$informe" "${extra[@]}" >/dev/null 2>&1 || true
    node -e '
      const fs = require("fs");
      const [informe, preset, url] = process.argv.slice(1);
      if (!fs.existsSync(informe)) { console.log(`✘ ${preset} ${url} — lighthouse no dejó informe`); process.exit(1); }
      const r = JSON.parse(fs.readFileSync(informe, "utf8"));
      const cats = ["performance", "accessibility", "best-practices", "seo"];
      const falta = cats.filter((c) => !r.categories?.[c]);
      if (falta.length) { console.log(`✘ ${preset} ${url} — el informe no trae ${falta.join(", ")}`); process.exit(1); }
      const s = Object.fromEntries(cats.map((c) => [c, Math.round(r.categories[c].score * 100)]));
      const bajos = Object.entries(s).filter(([, v]) => v < 95);
      console.log(`${bajos.length ? "✘" : "✔"} ${preset.padEnd(7)} ${url}  ${JSON.stringify(s)}`);
      if (bajos.length) {
        const malas = Object.values(r.audits)
          .filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode !== "informative")
          .map((a) => a.id);
        console.log(`        por debajo de 1: ${malas.join(", ") || "ninguna"}`);
      }
      process.exit(bajos.length ? 1 : 0);' "$informe" "$preset" "$url" || fallo=1
  done
done
exit $fallo
