# infra/scripts/deploy.ps1 -- one-command Windows deploy to Hetzner.
#
# Replaces the manual scp + ssh-extract + ssh-swap dance:
#   1. npm run build
#   2. npm run billing:migrate (idempotent DB migration, before the swap)
#   3. compose standalone (cp static + public into .next/standalone)
#   4. tar to openlen-deploy.tar.gz
#   5. scp the tarball to /root/ on the box
#   6. extract to /opt/openlen-app-staging
#   7. systemd stop -> atomic mv swap -> start
#   8. cleanup local + remote tarball
#   9. smoke test
#
# Usage (from repo root):
#   npm run deploy:prod
#
# Override defaults via env vars:
#   $env:OPENLEN_HOST = "openlen"          # ssh alias from ~/.ssh/config
#   $env:OPENLEN_REMOTE_PATH = "/opt/openlen-app"
#   $env:OPENLEN_SKIP_BUILD = "1"          # reuse existing .next/standalone
#   $env:OPENLEN_SKIP_MIGRATE = "1"        # skip billing:migrate (already applied)
#   $env:OPENLEN_SKIP_CRATES_REBUILD = "1" # skip the Rust crate rebuild step.
#                                          # RISKY — the atomic swap wipes
#                                          # /opt/openlen-app/node_modules/
#                                          # @openlen/*, so the rebuild is what
#                                          # puts linux-x64-gnu .node binaries
#                                          # back. Without it prod crashes with
#                                          # MODULE_NOT_FOUND at runtime.
#                                          # Only set when you're sure (rare).

$ErrorActionPreference = "Stop"

$host_ = if ($env:OPENLEN_HOST) { $env:OPENLEN_HOST } else { "openlen" }
$remoteDir = if ($env:OPENLEN_REMOTE_PATH) { $env:OPENLEN_REMOTE_PATH } else { "/opt/openlen-app" }
$tarballName = "openlen-deploy.tar.gz"
$stagingDir = "$remoteDir-staging"
$backupDir = "$remoteDir.old"

function Step($n, $msg) {
  Write-Host ""
  Write-Host "[$n/7] $msg" -ForegroundColor Cyan
}

# Los here-strings heredan los saltos de linea del ARCHIVO. Si deploy.ps1 queda
# en CRLF (un editor de Windows, una herramienta que escribe CRLF), cada linea
# que viaja por ssh llega a bash con un CR pegado: `set -e` muere con
# "set: -: invalid option" -- o sea que la guarda de errores se apaga en
# silencio -- y las rutas se convierten en 'nombre' + CR. .gitattributes fuerza
# eol=lf, asi que el repo esta bien; esto protege la COPIA DE TRABAJO. Paso por
# aqui todo script remoto. (Reproducido el 2026-07-30: un deploy abortado en el
# paso 6 con exactamente esos sintomas.)
function Sh($cmd) { $cmd -replace "`r`n", "`n" }

# --- 1. Build ----------------------------------------------------------
if ($env:OPENLEN_SKIP_BUILD -ne "1") {
  Step 1 "Building Next.js standalone..."
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  npm run build | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE)" }
  $sw.Stop()
  Write-Host ("    done in {0}s" -f [math]::Round($sw.Elapsed.TotalSeconds, 1))
} else {
  Step 1 "Skipping build (OPENLEN_SKIP_BUILD=1) -- reusing .next/standalone"
}

# --- 2. (Las migraciones se movieron al paso 6.2) ---------------------
# Las migraciones YA NO corren aquí. Corrían con `npm run <x>:migrate`, que lee
# .env.local — o sea la base de DESARROLLO desde que dev y prod se separaron
# (2026-07-20). Cada paso de migración del deploy llevaba meses siendo un no-op
# contra producción; solo no se notó porque esas columnas ya existían allá. La
# primera columna realmente nueva (publishedHomeHash, 2026-07-30) tiró prod: el
# código desplegado seleccionaba una columna que la migración había añadido
# "con éxito" a la base equivocada.
#
# Ahora corren EN EL BOX (paso 6.2), contra DATABASE_URL_DIRECT, que apunta al
# rol dueño de las tablas. Siguen ejecutándose ANTES del swap atómico, que es
# la invariante que importa: el código nuevo no debe arrancar contra un esquema
# viejo. OPENLEN_SKIP_MIGRATE=1 sigue saltándoselas.

# --- 3. Compose standalone with static + public -----------------------
Step 3 "Composing standalone (copying .next/static + public/)..."
New-Item -ItemType Directory -Force -Path ".next/standalone/.next/static" | Out-Null
Copy-Item -Recurse -Force ".next/static/*" ".next/standalone/.next/static/"
if (Test-Path "public") {
  New-Item -ItemType Directory -Force -Path ".next/standalone/public" | Out-Null
  Copy-Item -Recurse -Force "public/*" ".next/standalone/public/"
}

# Next's Windows file tracer cannot always recreate npm workspace junctions in
# the standalone tree (EPERM without symlink privileges). Materialize the small
# JS package wrappers explicitly; step 6.5 builds and adds the Linux .node
# binaries before the atomic swap.
$nativeCrates = @("html-engine", "ai-gateway", "images", "rate-limit")
foreach ($crate in $nativeCrates) {
  $sourceDir = "crates/$crate"
  $targetDir = ".next/standalone/node_modules/@openlen/$crate"
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  Copy-Item -Force "$sourceDir/index.js", "$sourceDir/index.d.ts", "$sourceDir/package.json" $targetDir
  if (-not (Test-Path "$targetDir/index.js")) { throw "Missing native crate wrapper: $crate" }
}

# Bundle the cron entrypoints into self-contained ESM (deps inlined) so the
# systemd timers run them with plain `node` — the standalone prunes
# node_modules and never ships scripts/ or lib/ source. esbuild emits into
# .next/standalone/cron/ -> /opt/openlen-app/cron/ on the box; env comes from
# the units' systemd EnvironmentFile at runtime.
Step 3 "Bundling cron entrypoints (esbuild) for systemd timers..."
npm run cron:bundle
if ($LASTEXITCODE -ne 0) { throw "cron:bundle failed (exit $LASTEXITCODE)" }

Step 3 "Bundling DB migrations (esbuild) to run on the box..."
npm run migrations:bundle
if ($LASTEXITCODE -ne 0) { throw "migrations:bundle failed (exit $LASTEXITCODE)" }

$size = (Get-ChildItem -Recurse ".next/standalone" | Measure-Object -Property Length -Sum).Sum
Write-Host ("    standalone: {0} MB" -f [math]::Round($size/1MB, 1))

# Note: we used to install sharp's linux binaries client-side here, but
# Windows npm refuses to materialize platform-mismatched optionals into
# node_modules (it short-circuits the install). The fix lives on the box
# now — see step 6 below.

# --- 4. Tar locally ----------------------------------------------------
Step 4 "Creating tarball ($tarballName)..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()
& tar -czf $tarballName -C .next/standalone .
if ($LASTEXITCODE -ne 0) { throw "tar failed (exit $LASTEXITCODE)" }
$tarSize = (Get-Item $tarballName).Length
$sw.Stop()
Write-Host ("    {0} MB, {1}s" -f [math]::Round($tarSize/1MB, 1), [math]::Round($sw.Elapsed.TotalSeconds, 1))

# --- 5. SCP to box -----------------------------------------------------
Step 5 "Uploading to ${host_}:/root/..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()
& scp -q $tarballName "${host_}:/root/"
if ($LASTEXITCODE -ne 0) { throw "scp failed (exit $LASTEXITCODE)" }
$sw.Stop()
Write-Host ("    {0}s" -f [math]::Round($sw.Elapsed.TotalSeconds, 1))

# --- 6. Extract on box + install sharp linux binaries -----------------
# After untarring the Windows-built standalone, we still need sharp's
# linux-x64 native binaries (they were never in the tarball because
# Windows npm refuses to install platform-mismatched optionals). Doing
# this on the box itself sidesteps the cross-platform npm quirk.
# PUPPETEER_SKIP_DOWNLOAD=1 prevents puppeteer's postinstall from trying
# to re-download chrome-headless-shell (its cache may be corrupted from
# prior interrupted installs).
Step 6 "Extracting to $stagingDir + installing sharp linux binaries..."
$extractCmd = @"
set -e
rm -rf $stagingDir
mkdir -p $stagingDir
tar -xzf /root/$tarballName -C $stagingDir
rm /root/$tarballName
cd $stagingDir
PUPPETEER_SKIP_DOWNLOAD=1 npm install --no-save --include=optional --os=linux --cpu=x64 "@img/sharp-linux-x64" "@img/sharp-libvips-linux-x64" --silent 2>&1 | tail -3
chown -R openlen-deploy:www-data $stagingDir
"@
& ssh $host_ (Sh $extractCmd)
if ($LASTEXITCODE -ne 0) { throw "Remote extract failed (exit $LASTEXITCODE)" }

# --- 6.2. Apply DB migrations ON THE BOX ------------------------------
# Contra la base de PRODUCCIÓN, no la de dev, y con el rol que puede alterar
# el esquema. Dos cosas que el paso local nunca tuvo:
#   - DATABASE_URL_DIRECT apunta a openlen_migrate, DUEÑO de las tablas.
#     openlen_app (el DATABASE_URL de la app) no lo es y un ALTER le rebota
#     con "must be owner of table" — a propósito: la app no cambia esquema.
#   - corre desde dentro del box, donde 127.0.0.1:5432 sí existe.
# Va DESPUÉS del extract (necesita los .mjs recién subidos) y ANTES del swap,
# que es la invariante: el código nuevo nunca arranca contra un esquema viejo.
# Si algo falla, el deploy aborta aquí y /opt/openlen-app sigue intacto.
if ($env:OPENLEN_SKIP_MIGRATE -ne "1") {
  Step 6 "Applying DB migrations on the box (production database)..."
  # El runner viaja en el tarball (scripts/build-migrations.mjs lo escribe con
  # saltos LF). Pasarlo como string a `& ssh` NO funciona: PowerShell le come
  # las comillas y le mete CRLF, y bash aborta con "set: -: invalid option" —
  # probado. Asi el deploy solo manda un comando corto y sin escapado.
  & ssh $host_ "bash $stagingDir/migrations/run.sh"
  if ($LASTEXITCODE -ne 0) { throw "Remote DB migrations failed (exit $LASTEXITCODE)" }
} else {
  Step 6 "Skipping DB migrations (OPENLEN_SKIP_MIGRATE=1)"
}

# --- 6.5. Rebuild Rust crates on box (default ON) --------------------
# The atomic swap in step 7 wipes /opt/openlen-app/node_modules/@openlen/*
# every time, replacing it with the contents of the local Windows-built
# tarball (which only has win32-x64-msvc .node binaries). Without
# rebuilding the linux-x64-gnu .node files into the staging dir BEFORE the
# swap, the app on the box crashes at runtime with MODULE_NOT_FOUND on
# require('@openlen/rate-limit-linux-x64-gnu') (and all 4 crates).
#
# So this step must run on EVERY deploy by default. The opt-out exists
# for the very rare case where you know the .node files are otherwise
# preserved — but in practice it should almost never be set.
# Cargo cache stays hot between deploys → 30-40s when nothing changed in
# crates/, ~5 min on the first deploy of the day.
if ($env:OPENLEN_SKIP_CRATES_REBUILD -ne "1") {
  Step "6.5" "Rebuilding Rust crates on box (this takes ~5 min)..."
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  # Ship the Rust workspace + build script to the box. PowerShell on
  # Windows doesn't ship rsync, so we tar + scp + remote-extract — same
  # pattern as the standalone deploy in steps 4-6.
  # Force cwd to repo root (the script lives at infra/scripts/, ../.. = root).
  $repoRoot = (Resolve-Path "$PSScriptRoot/../..").Path
  Set-Location $repoRoot
  $cratesTarball = "openlen-crates.tar.gz"
  if (Test-Path $cratesTarball) { Remove-Item -Force $cratesTarball }
  # Wrap tar to opt out of strict ErrorActionPreference — tar.exe writes
  # verbose listings + benign warnings to stderr, which $ErrorAction="Stop"
  # treats as a script-fatal error even when the exit code is 0. Standard
  # PowerShell pattern for native commands.
  $prevPref = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $tarOutput = & tar -czf $cratesTarball Cargo.toml Cargo.lock crates 2>&1
    $tarExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevPref
  }
  if ($tarExit -ne 0) {
    Write-Host "tar output (last 20 lines):"
    $tarOutput | Select-Object -Last 20 | ForEach-Object { Write-Host "  $_" }
    throw "Crates tar failed (exit $tarExit)"
  }
  Write-Host ("    bundled $((Get-Item $cratesTarball).Length / 1MB) MB")
  & scp -q $cratesTarball "${host_}:/root/"
  if ($LASTEXITCODE -ne 0) { throw "Crates scp failed (exit $LASTEXITCODE)" }
  & scp -q "infra/scripts/build-crates-on-box.sh" "${host_}:/root/"
  if ($LASTEXITCODE -ne 0) { throw "Build script scp failed (exit $LASTEXITCODE)" }
  # Extract the workspace + run the build script against the staging dir.
  # The script restarts only when targeting the live dir, so passing
  # staging here is safe — rebuild then continue to the swap in step 7.
  $cratesCmd = @"
set -e
mkdir -p /root/openlen-workspace
tar -xzf /root/$cratesTarball -C /root/openlen-workspace
rm /root/$cratesTarball
chmod +x /root/build-crates-on-box.sh
bash /root/build-crates-on-box.sh $stagingDir
"@
  & ssh $host_ (Sh $cratesCmd)
  if ($LASTEXITCODE -ne 0) { throw "Crate rebuild failed (exit $LASTEXITCODE)" }
  Remove-Item -Force $cratesTarball
  $sw.Stop()
  Write-Host ("    done in {0}s" -f [math]::Round($sw.Elapsed.TotalSeconds, 1))
} else {
  # Opt-out path. Loudly warn — this almost certainly breaks prod.
  Step "6.5" "Skipping Rust crate rebuild (OPENLEN_SKIP_CRATES_REBUILD=1)"
  Write-Host "  WARNING: the atomic swap wipes /opt/openlen-app/node_modules/@openlen/*/." -ForegroundColor Yellow
  Write-Host "  Without the rebuild step, the box will have Windows .node binaries → MODULE_NOT_FOUND on require." -ForegroundColor Yellow
  Write-Host "  This flag should almost never be set. If you set it by mistake, abort with Ctrl+C now." -ForegroundColor Yellow
  Start-Sleep -Seconds 3
}

# --- 7. Atomic swap + restart + smoke test ---------------------------
Step 7 "Atomic swap + restart..."
$swapCmd = @"
systemctl stop openlen-app
rm -rf $backupDir
mv $remoteDir $backupDir
mv $stagingDir $remoteDir
systemctl start openlen-app
sleep 2
systemctl is-active openlen-app
curl -sI -o /dev/null -w '  smoke: HTTP %{http_code} (%{time_total}s)' http://127.0.0.1:3000/
"@
& ssh $host_ (Sh $swapCmd)
if ($LASTEXITCODE -ne 0) { throw "Swap or restart failed (exit $LASTEXITCODE)" }

# --- Cleanup local tarball --------------------------------------------
Remove-Item -Force $tarballName

Write-Host ""
Write-Host "OK Deploy complete." -ForegroundColor Green
Write-Host "  Rollback if needed:" -ForegroundColor DarkGray
Write-Host '    ssh openlen "systemctl stop openlen-app; rm -rf /opt/openlen-app; mv /opt/openlen-app.old /opt/openlen-app; systemctl start openlen-app"' -ForegroundColor DarkGray
