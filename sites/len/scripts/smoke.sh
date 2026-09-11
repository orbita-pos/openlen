#!/usr/bin/env bash
# Lo que ve un usuario de verdad: sin --resolve, por Cloudflare, como el navegador.
# En Windows: CURL=/c/Windows/system32/curl.exe npm run smoke
# (el -w del curl de mingw sale con 43).
set -uo pipefail
CURL="${CURL:-curl}"
B="https://len.openlen.com"
fallo=0
ok() { if [ "$1" = "$2" ]; then echo "✔ $3 ($1)"; else echo "✘ $3: esperaba $2, llegó $1"; fallo=1; fi; }
code() { "$CURL" -sS -o /dev/null -w '%{http_code}' "$@"; }

ok "$(code -H 'Accept-Language: es-MX,es;q=0.9' "$B/")" 302 "/ con español"
loc="$("$CURL" -sSI -H 'Accept-Language: es-MX,es;q=0.9' "$B/" | tr -d '\r' | grep -i '^location:' | awk '{print $2}')"
ok "$loc" "/es/" "/ → /es/"
loc="$("$CURL" -sSI -H 'Accept-Language: en-US,en;q=0.9,es;q=0.8' "$B/" | tr -d '\r' | grep -i '^location:' | awk '{print $2}')"
ok "$loc" "/en/" "/ → /en/"
cc="$("$CURL" -sSI "$B/" | tr -d '\r' | grep -i '^cache-control:' | awk '{print $2}')"
ok "$cc" "no-store" "la raíz no se cachea"
for p in /en/ /es/ /en/research/ /es/principles/ /es/research/when-the-agent-said-done/ /sitemap.xml /robots.txt; do ok "$(code "$B$p")" 200 "$p"; done
ok "$(code "$B/no-existe/")" 404 "404 de verdad"
"$CURL" -sS -o /dev/null "$B/en/"
hit="$("$CURL" -sSI "$B/en/" | tr -d '\r' | grep -i '^cf-cache-status:' | awk '{print $2}')"
ok "$hit" "HIT" "/en/ desde la caché de borde"
exit $fallo
