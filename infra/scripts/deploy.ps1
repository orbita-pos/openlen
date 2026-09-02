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
#   $env:OPENLEN_AI_CREATION_TARGET_MODE = "enabled" # or "disabled"; required
#   $env:OPENLEN_AI_CREATION_TARGET_ROLLOUT_PERCENT = "10" # 1..99 enabled; 0 disabled
#   $env:OPENLEN_FABLE_PARITY_APPROVED_REVISION = "<git sha>" # exact release revision
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
# --- El ceremonial de Fable es de ENCENDER FABLE, no de desplegar ----
#
# Estas puertas —modo de rollout declarado, revision aprobada a mano,
# scorecard de paridad con sus 19 variables, topes de gasto en micro-MXN—
# se pusieron para que la ruta creativa de Fable no pudiera activarse sin
# revision ni sin tope. Eso sigue siendo correcto.
#
# Lo que estaba mal era CUANDO se exigian: en TODO despliegue. Un release
# que no toca Fable —el JavaScript del modelo, el editor, un arreglo de
# tres bugs— tenia que montar el ritual entero para poder salir. El efecto
# medido (2026-08-23): no se podia desplegar nada.
#
# Ahora la regla es la que siempre debio ser: sin $env:OPENLEN_AI_CREATION_TARGET_MODE
# el despliegue NO TOCA los interruptores de Fable en el box —los deja como
# esten— y no pide nada. Poner la variable es pedir cambiarlos, y ahi el
# ritual vuelve ENTERO. Las puertas no se quitaron; se ataron a la decision
# que protegen.
$targetMode = $env:OPENLEN_AI_CREATION_TARGET_MODE
$targetRolloutPercent = $env:OPENLEN_AI_CREATION_TARGET_ROLLOUT_PERCENT
$tocaFable = $targetMode -ne $null -and $targetMode -ne ""
if ($tocaFable) {
  if ($targetMode -ne "enabled" -and $targetMode -ne "disabled") {
    throw "OPENLEN_AI_CREATION_TARGET_MODE must be enabled or disabled (unset it to leave the box untouched)"
  }
  if ($targetMode -eq "enabled" -and ($targetRolloutPercent -notmatch '^(?:[1-9]|[1-9][0-9])$')) {
    throw "Enabled AI creation requires OPENLEN_AI_CREATION_TARGET_ROLLOUT_PERCENT from 1 through 99"
  }
  if ($targetMode -eq "disabled" -and $targetRolloutPercent -ne "0") {
    throw "Disabled AI creation requires OPENLEN_AI_CREATION_TARGET_ROLLOUT_PERCENT=0"
  }
  $releaseRevision = (& git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $releaseRevision -notmatch '^[a-f0-9]{40}([a-f0-9]{24})?$') {
    throw "Unable to resolve the current release revision"
  }
  if ($env:OPENLEN_FABLE_PARITY_APPROVED_REVISION -ne $releaseRevision) {
    throw "OPENLEN_FABLE_PARITY_APPROVED_REVISION must equal the current release revision"
  }
}

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

# --- 0. Espacio en disco ------------------------------------------------
# Un deploy escribe lo MISMO TRES VECES: el build llena .next, el paso 3 copia
# .next/static + public dentro de .next/standalone, y el paso 4 empaqueta todo
# en un tarball. Sin sitio para las tres, Windows no falla limpio: el I/O se
# degrada hasta PARECER un cuelgue.
#
# Pasó de verdad (2026-08-19): un deploy corrió HORAS en el paso 1 sin mandar
# nada, con 3,3 GB libres y un `.next` de 4 GB atrapado de builds anteriores.
# Un simple `du` sobre esa carpeta tardaba más de cinco minutos.
#
# Esta comprobación cuesta milisegundos y convierte esas horas en un mensaje.
#
# DOS NIVELES, y los números salen de lo medido aquel día, no del susto:
#   < 5 GB  aborta — con 3,3 GB el deploy se arrastró horas
#   < 9 GB  avisa  — cabe, pero sin holgura si `.next` vuelve a crecer a 4 GB
# Abortar por encima de eso sería bloquear deploys que sí caben, y un guard que
# estorba se acaba desactivando — que es peor que no tenerlo.
$libreGB = [math]::Round((Get-PSDrive C).Free / 1GB, 1)
$minimoGB = 5
$comodoGB = 9
if ($libreGB -lt $minimoGB) {
  Write-Host ""
  Write-Host "  ESPACIO INSUFICIENTE: $libreGB GB libres en C:, hacen falta $minimoGB." -ForegroundColor Red
  Write-Host "  Un deploy escribe .next, luego lo copia, luego lo empaqueta." -ForegroundColor Yellow
  Write-Host "  Con menos espacio no falla: se arrastra durante horas." -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  Lo que mas suele ocupar (y es regenerable):" -ForegroundColor Yellow
  Write-Host "    Remove-Item -Recurse -Force .next     # suele rondar los 4 GB"
  Write-Host ""
  throw "Espacio en disco insuficiente ($libreGB GB < $minimoGB GB)"
}
if ($libreGB -lt $comodoGB) {
  Write-Host "  espacio en C:: $libreGB GB libres - justo, pero cabe." -ForegroundColor Yellow
  Write-Host "  Si el deploy se arrastra, borra .next (suele rondar los 4 GB)." -ForegroundColor DarkGray
} else {
  Write-Host "  espacio en C:: $libreGB GB libres" -ForegroundColor DarkGray
}

# Hybrid-only creation is a release invariant, including when a prebuilt
# standalone bundle is reused. Keep these checks outside the skip-build branch.
npm.cmd run generation:fable-parity:gate
if ($LASTEXITCODE -ne 0) { throw "Deterministic Fable parity gate failed" }
npm.cmd run generation:visual-engine-assets:gate
if ($LASTEXITCODE -ne 0) { throw "Visual Engine assets gate failed" }
npm.cmd run generation:page-engine:gate
if ($LASTEXITCODE -ne 0) { throw "Page engine gate failed" }
npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { throw "Typecheck failed" }

# El dominio que PINTA la interfaz se hornea en el bundle, y el bundle se
# compila aqui. Sin esta variable el build sale diciendo openlen.com aunque el
# box publique en otro dominio: no falla, miente. Paso el 2026-08-23.
npm.cmd run publish-host:gate
if ($LASTEXITCODE -ne 0) { throw "Falta NEXT_PUBLIC_PUBLISH_BASE_HOST en .env.local" }

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

# LAS FUENTES DE LAS PLANTILLAS VIAJAN A LA CAJA (2026-09-02).
#
# La galeria sirve desde R2, pero el HTML editable vive en templates/starter/.
# Cuando esas dos cosas se separan —paso el 01/09: se limpiaron los `on*` de 19
# plantillas y los ficheros se quedaron SOLO en el disco de Jesus— la unica
# forma de reconciliarlas es republicar CONTRA PRODUCCION, y eso no se puede
# hacer desde su portatil: su DATABASE_URL es un Postgres local de Windows y no
# tiene claves de R2, asi que `templates:republish-one` escribiria en su maquina
# e imprimiria «ok».
#
# Con las fuentes aqui, /api/internal/republish-templates las compara con la
# galeria EN PROCESO y republica lo que haya derivado. Es tambien lo que hace
# que R2 se pueda re-derivar de un artefacto de despliegue.
#
# Sin los `.preview.html`: son la vista previa, no el cuerpo publicable.
if (Test-Path "templates/starter") {
  New-Item -ItemType Directory -Force -Path ".next/standalone/templates-starter" | Out-Null
  $fuentes = Get-ChildItem "templates/starter" -Filter "*.html" |
    Where-Object { $_.Name -notlike "*.preview.html" }
  $fuentes | Copy-Item -Destination ".next/standalone/templates-starter/" -Force
  $mb = [math]::Round((($fuentes | Measure-Object -Property Length -Sum).Sum)/1MB, 1)
  Write-Host ("    fuentes de plantillas: {0} ficheros, {1} MB" -f $fuentes.Count, $mb)
}

# El file-tracing de Next SIEMPRE omite este manifest, en cada build; no es
# senal de un bundle corrupto, falta siempre. Se copiaba a mano desde el
# 2026-08-02 y por tanto se podia olvidar — que es exactamente la clase de paso
# manual que ya tumbo prod una vez.
$interceptionManifest = ".next/server/interception-route-rewrite-manifest.js"
if (Test-Path $interceptionManifest) {
  Copy-Item -Force $interceptionManifest ".next/standalone/.next/server/"
} else {
  Write-Host "    (sin interception-route-rewrite-manifest.js que copiar)"
}

# Next's Windows file tracer cannot always recreate npm workspace junctions in
# the standalone tree (EPERM without symlink privileges). Materialize the small
# JS package wrappers explicitly; step 6.5 builds and adds the Linux .node
# binaries before the atomic swap.
$nativeCrates = @("html-engine", "images", "rate-limit")
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

# Never relabel reused output. A normal build receives its attestation only
# after Next and all local standalone composition steps succeeded; skip-build
# can only verify the pre-existing revision/build/artifact identity.
# La atestacion y el scorecard SOLO cuando el release toca los interruptores
# de Fable — ver la nota del principio. Un despliegue ordinario no los pide.
if ($tocaFable) {
  if ($env:OPENLEN_SKIP_BUILD -eq "1") {
    npm.cmd run generation:fable-parity:build-attestation -- --verify
    if ($LASTEXITCODE -ne 0) { throw "Existing standalone build attestation is absent, stale, or substituted" }
  } else {
    npm.cmd run generation:fable-parity:build-attestation -- --write
    if ($LASTEXITCODE -ne 0) { throw "Standalone build attestation write failed" }
  }
  npm.cmd run generation:fable-parity:scorecard -- --deploy-gate
  if ($LASTEXITCODE -ne 0) { throw "Fable parity activation scorecard gate failed" }
}

$size = (Get-ChildItem -Recurse ".next/standalone" | Measure-Object -Property Length -Sum).Sum
Write-Host ("    standalone: {0} MB" -f [math]::Round($size/1MB, 1))

# Note: we used to install sharp's linux binaries client-side here, but
# Windows npm refuses to materialize platform-mismatched optionals into
# node_modules (it short-circuits the install). The fix lives on the box
# now — see step 6 below.

# --- 4. Tar locally ----------------------------------------------------
Step 4 "Creating tarball ($tarballName)..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()
# bsdtar, resuelto por ruta y no por PATH: `--options` es sintaxis suya y NO
# la entiende el tar de GNU. Lanzar este script desde un shell con MSYS en el
# PATH (Git Bash) hacia que ganara /usr/bin/tar y el empaquetado muriera con
# "unrecognized option '--options'".
$bsdTar = Join-Path $env:SystemRoot (Join-Path "System32" "tar.exe")
if (-not (Test-Path $bsdTar)) { throw "bsdtar no encontrado en $bsdTar" }
& $bsdTar --options "gzip:compression-level=1" -czf $tarballName -C .next/standalone .
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
    # --exclude node_modules y target: sin esto el tarball se lleva los
    # node_modules de WINDOWS que hay en crates/*/ — con `napi.cmd`, `napi.ps1`
    # y un `napi` sin bit de ejecucion. En el box se extraen, `npm install` ve
    # que "ya esta instalado" y no reinstala, y `napi build` muere con
    # `sh: 1: napi: Permission denied` (exit 127).
    #
    # Pasó de verdad (2026-08-20) y tumbó el paso 6.5 tras subir 12 MB. Excluir
    # tambien `target` (artefactos de cargo, cientos de MB de x86_64-pc-windows
    # que el box no puede usar) hace el tarball mas pequeno de paso.
    $tarOutput = & tar -czf $cratesTarball --exclude=node_modules --exclude=target Cargo.toml Cargo.lock crates 2>&1
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
  # SIN COMILLAS INVERTIDAS EN ESTE BLOQUE. Es un here-string de PowerShell con
  # comillas DOBLES, donde la comilla invertida es el caracter de ESCAPE: los
  # comentarios de abajo llevaban `napi.cmd` y `npm install` entrecomillados asi,
  # y PowerShell leia esa secuencia como un SALTO DE LINEA que ademas se comia la
  # n. El comentario se partia en dos y la mitad quedaba como comando: el box
  # respondia "bash: line 5: api.cmd: command not found" (exit 127) y el deploy
  # moria SIEMPRE en el paso 6.5, justo antes del swap.
  #
  # Medido el 2026-08-23: llevaba desde el 2026-08-20 bloqueando todos los
  # deploys — la misma fecha del /opt/openlen-app-staging huerfano que quedo en
  # el box. Se introdujo al escribir el comentario de abajo, que explicaba OTRO
  # fallo del mismo paso. Un comentario tumbo el deploy.
  $cratesCmd = @"
set -e
# BORRAR antes de extraer, no extraer encima. Un mkdir -p + tar -xzf deja
# intacto lo que ya hubiera: si un intento anterior subio node_modules de
# WINDOWS (con napi.cmd y un napi sin bit de ejecucion), el tarball nuevo
# —ya limpio— no los borra, npm install los ve y dice "ya esta instalado", y
# napi build sigue muriendo con Permission denied.
#
# Pasó de verdad (2026-08-20): se arreglo el tarball y el paso 6.5 volvio a
# fallar IGUAL, porque el residuo estaba en el box, no en el envio.
rm -rf /root/openlen-workspace
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
# El bloque que reescribe los interruptores de Fable en /etc/openlen/openlen.env
# SOLO se arma cuando el release los cambia. Sin la variable, el fichero del box
# no se toca: lo que haya puesto ahi —a mano o en otro despliegue— sobrevive,
# que es lo que un despliegue ordinario debe hacer con la configuracion ajena.
$fableEnvBlock = if ($tocaFable) { @'
test -f /etc/openlen/openlen.env
tmp_env=$(mktemp /etc/openlen/openlen.env.openlen-ai.XXXXXX)
trap 'rm -f "$tmp_env"' EXIT
awk 'BEGIN{seen_mode=0;seen_percent=0} /^OPENLEN_AI_CREATION=/{if(!seen_mode){print "OPENLEN_AI_CREATION=__TARGET_MODE__";seen_mode=1};next} /^OPENLEN_AI_CREATION_ROLLOUT_PERCENT=/{if(!seen_percent){print "OPENLEN_AI_CREATION_ROLLOUT_PERCENT=__TARGET_ROLLOUT_PERCENT__";seen_percent=1};next} {print} END{if(!seen_mode)print "OPENLEN_AI_CREATION=__TARGET_MODE__";if(!seen_percent)print "OPENLEN_AI_CREATION_ROLLOUT_PERCENT=__TARGET_ROLLOUT_PERCENT__"}' /etc/openlen/openlen.env > "$tmp_env"
chown --reference=/etc/openlen/openlen.env "$tmp_env"
chmod --reference=/etc/openlen/openlen.env "$tmp_env"
mv -f "$tmp_env" /etc/openlen/openlen.env
trap - EXIT
test "$(sed -n 's/^OPENLEN_AI_CREATION=//p' /etc/openlen/openlen.env | tail -n 1)" = "__TARGET_MODE__"
test "$(sed -n 's/^OPENLEN_AI_CREATION_ROLLOUT_PERCENT=//p' /etc/openlen/openlen.env | tail -n 1)" = "__TARGET_ROLLOUT_PERCENT__"
'@ } else { "" }

# Misma comprobacion, en el proceso ya arrancado: que lo que pediste es lo que
# de verdad ve la app. Tambien solo cuando el release lo pidio.
$fableProcCheck = if ($tocaFable) { @'
tr '\000' '\n' < "/proc/$pid/environ" | grep -Fx 'OPENLEN_AI_CREATION=__TARGET_MODE__' > /dev/null
tr '\000' '\n' < "/proc/$pid/environ" | grep -Fx 'OPENLEN_AI_CREATION_ROLLOUT_PERCENT=__TARGET_ROLLOUT_PERCENT__' > /dev/null
'@ } else { "" }

$swapCmd = @"
set -eu
systemctl stop openlen-app
$fableEnvBlock
rm -rf __BACKUP_DIR__
mv __REMOTE_DIR__ __BACKUP_DIR__
mv __STAGING_DIR__ __REMOTE_DIR__
systemctl start openlen-app
sleep 2
systemctl is-active --quiet openlen-app
pid=`$(systemctl show -p MainPID --value openlen-app)
test "`$pid" -gt 0
$fableProcCheck
curl -sI -o /dev/null -w '  smoke: HTTP %{http_code} (%{time_total}s)' http://127.0.0.1:3000/
"@
$swapCmd = $swapCmd.Replace("__TARGET_MODE__", $targetMode).Replace("__TARGET_ROLLOUT_PERCENT__", $targetRolloutPercent).Replace("__BACKUP_DIR__", $backupDir).Replace("__REMOTE_DIR__", $remoteDir).Replace("__STAGING_DIR__", $stagingDir)

# El swap viaja como ARCHIVO, no como texto por ssh. Mandado en linea, el
# escapado de PowerShell deshacia las comillas del script: el `awk` que escribe
# la bandera no llegaba a correr y el `test` que la verifica moria con
# "unary operator expected" -- DESPUES de haber parado el servicio y ANTES de
# mover los directorios. Resultado el 2026-08-17: produccion detenida con el
# release viejo intacto, arreglada arrancando el servicio a mano.
#
# Es exactamente la solucion que el paso 6.2 ya usaba para las migraciones, por
# la misma razon. LF explicito: un CR pegado apaga `set -e` en silencio.
$swapScript = Join-Path ([System.IO.Path]::GetTempPath()) "openlen-swap.sh"
[System.IO.File]::WriteAllText($swapScript, ($swapCmd -replace "`r`n", "`n"), (New-Object System.Text.UTF8Encoding($false)))
& scp -q $swapScript "${host_}:/root/openlen-swap.sh"
if ($LASTEXITCODE -ne 0) { throw "Swap script upload failed (exit $LASTEXITCODE)" }
Remove-Item -Force $swapScript -ErrorAction SilentlyContinue
& ssh $host_ "bash /root/openlen-swap.sh"
if ($LASTEXITCODE -ne 0) { throw "Swap or restart failed (exit $LASTEXITCODE)" }

# --- Cleanup local tarball --------------------------------------------
Remove-Item -Force $tarballName

Write-Host ""
Write-Host "OK Deploy complete." -ForegroundColor Green
Write-Host "  Rollback if needed:" -ForegroundColor DarkGray
Write-Host '    ssh openlen "systemctl stop openlen-app; rm -rf /opt/openlen-app; mv /opt/openlen-app.old /opt/openlen-app; systemctl start openlen-app"' -ForegroundColor DarkGray
