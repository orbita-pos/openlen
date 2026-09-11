#!/usr/bin/env bash
# Publica sites/len en /var/www/len-site. SÓLO con un «despliega» de Jesús.
# Uso: bash scripts/deploy.sh [--dry-run]
#
# El build corre primero y con él las tres puertas (contenido, build, enlaces):
# si algo falla, no hay tar que subir. En la caja se extrae a una release nueva
# y el enlace `current` cambia de golpe con `mv -Tf`, que es atómico — nadie ve
# un directorio a medias. Rollback: apuntar `current` a la release anterior.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${OPENLEN_HOST:-openlen}"
DRY="${1:-}"
run() { if [ "$DRY" = "--dry-run" ]; then printf '[dry] %q ' "$@"; echo; else "$@"; fi; }

npm run build

REL="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
TGZ="$(mktemp -d)/len-$REL.tgz"
tar -C out -czf "$TGZ" .

# Lista de URLs a purgar, en lotes de 30 (tope por petición de purge_cache).
PURGE="$(mktemp)"
node -e '
  const fs=require("fs"),path=require("path");
  const walk=d=>fs.readdirSync(d).flatMap(n=>{const p=path.join(d,n);return fs.statSync(p).isDirectory()?walk(p):[p]});
  const url=p=>{const rel=path.relative("out",path.dirname(p)).split(path.sep).join("/");return "https://len.openlen.com/"+(rel?rel+"/":"");};
  const urls=[...new Set(["https://len.openlen.com/", "https://len.openlen.com/sitemap.xml", "https://len.openlen.com/robots.txt", "https://len.openlen.com/404.html", ...walk("out").filter(p=>p.endsWith("index.html")).map(url)])];
  for(let i=0;i<urls.length;i+=30) console.log(JSON.stringify({files:urls.slice(i,i+30)}));' > "$PURGE"

run scp "$TGZ" "$HOST:/tmp/len-$REL.tgz"
run scp "$PURGE" "$HOST:/tmp/len-purge.jsonl"
run ssh "$HOST" "set -e
  mkdir -p /var/www/len-site/releases/$REL
  tar -xzf /tmp/len-$REL.tgz -C /var/www/len-site/releases/$REL
  find /var/www/len-site/releases/$REL -type d -exec chmod 755 {} +
  find /var/www/len-site/releases/$REL -type f -exec chmod 644 {} +
  cd /var/www/len-site && ln -sfn releases/$REL current.tmp && mv -Tf current.tmp current
  ls -1dt releases/* | tail -n +6 | xargs -r rm -rf
  rm -f /tmp/len-$REL.tgz
  Z=\$(grep -m1 '^CLOUDFLARE_ZONE_ID=' /etc/openlen/openlen.env | cut -d= -f2-)
  T=\$(grep -m1 '^CLOUDFLARE_API_TOKEN=' /etc/openlen/openlen.env | cut -d= -f2-)
  while read -r body; do
    curl -sS -X POST \"https://api.cloudflare.com/client/v4/zones/\$Z/purge_cache\" -H \"Authorization: Bearer \$T\" -H 'Content-Type: application/json' --data \"\$body\" | grep -o '\"success\":[a-z]*'
  done < /tmp/len-purge.jsonl
  rm -f /tmp/len-purge.jsonl
  # 🔴 ENTRECOMILLADO, y no es estilo: sin comillas bash lee el \`>\` como una
  # REDIRECCIÓN y escribe «current -» dentro de lo que devuelva \`readlink\` —
  # que es un directorio, así que falla con «Is a directory» y, con \`set -e\`,
  # el script sale 1. Medido en la primera publicación real (2026-09-11): todo
  # —extraer, permisos, el cambio atómico de \`current\` y la purga— había
  # salido bien, y aun así el despliegue se reportaba como fallido y nunca
  # llegaba a imprimir el ✔ de abajo.
  echo \"current -> \$(readlink current)\""
echo "✔ publicado $REL"
# /etc/openlen/openlen.env NO se puede hacer `source`: la línea
# EMAIL_FROM=OpenLen <…> rompe bash. Por eso el grep | cut de arriba.
