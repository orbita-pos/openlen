# infra/scripts/apply-404.ps1 -- ship the branded dead-link 404 to the box.
#
#   1. emit lib/publish/not-found-page.ts -> 404.html (single source of truth)
#   2. scp it to /var/www/openlen/_system/404.html
#   3. scp infra/caddy/Caddyfile -> /etc/caddy/Caddyfile
#   4. caddy validate, then systemctl reload caddy (reload = zero downtime;
#      on validation failure nothing is reloaded)
#
# Usage (from repo root):
#   powershell -File infra/scripts/apply-404.ps1
#
# Override the ssh alias via $env:OPENLEN_HOST (default "openlen").

$ErrorActionPreference = "Stop"

$host_ = if ($env:OPENLEN_HOST) { $env:OPENLEN_HOST } else { "openlen" }
$tmp = Join-Path ([IO.Path]::GetTempPath()) "openlen-404.html"

# Never hang silently: connect within 15s, detect a dead/stalled connection
# within ~30s, and refuse interactive prompts (BatchMode) — a missing host
# key or passphrase becomes a visible error instead of an eternal wait.
# (A run once sat for hours on Windows OpenSSH waiting on exactly that.)
$sshOpts = @(
  "-o", "BatchMode=yes",
  "-o", "ConnectTimeout=15",
  "-o", "ServerAliveInterval=10",
  "-o", "ServerAliveCountMax=3"
)

Write-Host "[1/4] Emitting 404.html from lib/publish/not-found-page.ts" -ForegroundColor Cyan
# Node escribe el archivo el mismo. El HTML NO puede volver como texto a
# PowerShell: la salida de un comando nativo se decodifica con
# [Console]::OutputEncoding (CP850 en un Windows en espanol), que convertia
# "pagina" en "p<basura>gina" -- y asi estuvo semanas en produccion.
$env:OPENLEN_404_OUT = $tmp
npx tsx -e "Promise.all([import('./lib/publish/not-found-page.ts'), import('node:fs')]).then(([m, fs]) => fs.writeFileSync(process.env.OPENLEN_404_OUT, m.NOT_FOUND_HTML))"
if ($LASTEXITCODE -ne 0) { throw "emit failed (tsx exit $LASTEXITCODE)" }

# Candado de encoding: U+251C es la firma del mojibake CP850, U+00E1 es la "a"
# acentuada que el documento debe tener. Sin esto el fallo es invisible.
$bytes = [IO.File]::ReadAllBytes($tmp)
if ($bytes.Length -lt 2000) { throw "emit produced $($bytes.Length) bytes -- expected the full document" }
$text = [Text.Encoding]::UTF8.GetString($bytes)
if ($text.IndexOf([char]0x251C) -ge 0 -or $text.IndexOf([char]0x00E1) -lt 0) {
  throw "404.html salio con los acentos corruptos -- se aborta antes de subirlo"
}

Write-Host "[2/4] Uploading 404.html -> /var/www/openlen/_system/" -ForegroundColor Cyan
ssh @sshOpts $host_ "mkdir -p /var/www/openlen/_system"
scp @sshOpts $tmp "${host_}:/var/www/openlen/_system/404.html"
$localHash = (Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower()
$remoteHash = "$(ssh @sshOpts $host_ "sha256sum /var/www/openlen/_system/404.html | cut -d' ' -f1")".Trim()
if ($localHash -ne $remoteHash) { throw "el archivo en el box no coincide ($localHash != $remoteHash)" }

Write-Host "[3/4] Uploading Caddyfile -> /etc/caddy/Caddyfile" -ForegroundColor Cyan
scp @sshOpts infra/caddy/Caddyfile "${host_}:/etc/caddy/Caddyfile"

Write-Host "[4/4] Validating + reloading Caddy" -ForegroundColor Cyan
ssh @sshOpts $host_ "caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy"

Remove-Item $tmp -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "OK 404 live. Smoke:" -ForegroundColor Green
Write-Host "  curl -sI https://sub-inexistente-x9.openlen.com/ | head -3   # expect 404 + text/html"
Write-Host "  curl -s  https://sub-inexistente-x9.openlen.com/ | grep -c 'no existe' # expect 2 (title + body), acentos intactos"
