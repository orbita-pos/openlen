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

Write-Host "[1/4] Emitting 404.html from lib/publish/not-found-page.ts" -ForegroundColor Cyan
$html = npx tsx -e "import('./lib/publish/not-found-page.ts').then(m => process.stdout.write(m.NOT_FOUND_HTML))"
if (-not $html) { throw "emit produced no output" }
[IO.File]::WriteAllText($tmp, ($html -join "`n"), [Text.UTF8Encoding]::new($false))

Write-Host "[2/4] Uploading 404.html -> /var/www/openlen/_system/" -ForegroundColor Cyan
ssh $host_ "mkdir -p /var/www/openlen/_system"
scp $tmp "${host_}:/var/www/openlen/_system/404.html"

Write-Host "[3/4] Uploading Caddyfile -> /etc/caddy/Caddyfile" -ForegroundColor Cyan
scp infra/caddy/Caddyfile "${host_}:/etc/caddy/Caddyfile"

Write-Host "[4/4] Validating + reloading Caddy" -ForegroundColor Cyan
ssh $host_ "caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy"

Remove-Item $tmp -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "OK 404 live. Smoke:" -ForegroundColor Green
Write-Host "  curl -sI https://sub-inexistente-x9.openlen.com/ | head -3   # expect 404 + text/html"
