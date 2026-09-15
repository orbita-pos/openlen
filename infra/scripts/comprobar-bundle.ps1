# LAS DOS GUARDAS QUE FALTARON EL 2026-08-01.
#
# EL INCIDENTE. Un `npm run build` murio a medias (el dev server sostenia locks
# sobre .next), el `rm -rf .next` siguiente no lo borro todo, y el segundo build
# se fusiono con los restos. Salio un .next Frankenstein cuyo webpack-runtime
# pedia chunks que no existian. `next build` con `output: standalone` **no falla
# cuando el file-tracing se rompe**: imprime `Failed to copy traced files ...
# EPERM: symlink`, sale exit 0, y empaqueta lo que pudo copiar. Se subio, y
# produccion devolvio 500 en TODAS las rutas durante ~5 minutos, `/api/health`
# incluido.
#
# POR QUE ESTO NO ESTABA. El unico smoke de `deploy.ps1` vive en el paso 7,
# DESPUES del swap atomico: un bundle roto tiraba produccion y nos enterabamos
# entonces. Hay rollback (openlen-app.old, segundos), pero llega tarde — y
# "tarde" aqui son las paginas de los clientes caidas.
#
# VIVE EN SU PROPIO FICHERO A PROPOSITO. Una guarda que solo se puede ejercitar
# desplegando no se ejercita nunca; asi se corre sola:
#
#     powershell -ExecutionPolicy Bypass -File infra/scripts/comprobar-bundle.ps1
#
# Salida 0 = el bundle se puede subir. Cualquier otra = NO se sube.

param(
  [string]$Raiz = ".",
  # El puerto del arranque de prueba. 3111 y no 3000: el dev del desarrollador
  # puede estar en 3000 y chocar con el, y un choque de puerto se leeria como
  # "el bundle no arranca".
  [int]$Puerto = 3111
)

$ErrorActionPreference = "Stop"
Set-Location $Raiz

$servidor = ".next/server"
$copia = ".next/standalone/.next/server"
if (-not (Test-Path $servidor)) { throw "No hay .next/server — no se ha construido nada que comprobar." }
if (-not (Test-Path $copia))    { throw "No hay .next/standalone/.next/server — la composicion del standalone no llego a correr." }

# ───────────────────────────────────────────────────────────────────────
# GUARDA A · EL STANDALONE ESTA COMPLETO
#
# Todo fichero de .next/server tiene que estar en el standalone. Lo que falta
# SIEMPRE, en cada build, y no es senal de nada:
#   · los sourcemaps (.map), que el tracer no copia,
#   · los .nft.json, que son del propio tracer,
#   · interception-route-rewrite-manifest.js, que Next omite siempre y
#     `deploy.ps1` copia a mano antes de llegar aqui.
# Cualquier OTRO fichero ausente —un vendor-chunk, un chunk de app— es el
# bundle Frankenstein, y es exactamente lo que no se puede subir.
# ───────────────────────────────────────────────────────────────────────
Write-Host "[A] Comprobando que el standalone esta COMPLETO..." -ForegroundColor Cyan

$benignos = '\.map$|\.nft\.json$|[\\/]interception-route-rewrite-manifest\.js$'
$rutaServidor = (Resolve-Path $servidor).Path
$rutaCopia    = (Resolve-Path $copia).Path

$enCopia = [System.Collections.Generic.HashSet[string]]::new()
foreach ($f in Get-ChildItem $rutaCopia -Recurse -File) {
  [void]$enCopia.Add($f.FullName.Substring($rutaCopia.Length + 1))
}

$total = 0
$faltan = New-Object System.Collections.ArrayList
foreach ($f in Get-ChildItem $rutaServidor -Recurse -File) {
  $total++
  $rel = $f.FullName.Substring($rutaServidor.Length + 1)
  if ($enCopia.Contains($rel)) { continue }
  if ($rel -match $benignos) { continue }
  [void]$faltan.Add($rel)
}

if ($faltan.Count -gt 0) {
  Write-Host "    FALTAN $($faltan.Count) ficheros en el standalone:" -ForegroundColor Red
  $faltan | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" -ForegroundColor Red }
  if ($faltan.Count -gt 20) { Write-Host "      ... y $($faltan.Count - 20) mas" -ForegroundColor Red }
  throw "BUNDLE INCOMPLETO: el file-tracing se rompio. NO se despliega. Mata todo node (Get-Process node | Stop-Process -Force), borra .next, COMPRUEBA que se borro, y vuelve a construir."
}
Write-Host ("    completo: {0} ficheros en .next/server, 0 ausencias anomalas" -f $total) -ForegroundColor Green

# ───────────────────────────────────────────────────────────────────────
# GUARDA B · EL BUNDLE ARRANCA DE VERDAD
#
# La guarda A compara inventarios; esta ejecuta. Es la que habria evitado la
# caida: un `require` que no resuelve no se ve contando ficheros.
#
# LO QUE **NO** SE MIRA es el codigo HTTP. En local no hay base de datos, asi
# que `/es` y `/api/health` dan 500 y eso es NORMAL — mirarlo haria fallar todo
# despliegue legitimo. Lo que se mira es si falta codigo de APLICACION.
# ───────────────────────────────────────────────────────────────────────
Write-Host "[B] Arrancando el standalone en local (puerto $Puerto)..." -ForegroundColor Cyan

$logOut = Join-Path $env:TEMP "openlen-bundle-$PID.out.log"
$logErr = Join-Path $env:TEMP "openlen-bundle-$PID.err.log"
Remove-Item -Force -ErrorAction SilentlyContinue $logOut, $logErr

$puertoPrevio = $env:PORT
$hostPrevio   = $env:HOSTNAME
$env:PORT     = "$Puerto"
$env:HOSTNAME = "127.0.0.1"
$proceso = $null
try {
  $proceso = Start-Process -FilePath "node" -ArgumentList "server.js" `
    -WorkingDirectory (Resolve-Path ".next/standalone").Path `
    -RedirectStandardOutput $logOut -RedirectStandardError $logErr `
    -PassThru -NoNewWindow

  # Hasta 30 s. Un standalone sano arranca en ~3.
  $listo = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    if ($proceso.HasExited) { break }
    if ((Test-Path $logOut) -and (Select-String -Path $logOut -Pattern "Ready in" -Quiet)) { $listo = $true; break }
  }
  if (-not $listo) {
    Write-Host "    --- salida del arranque ---" -ForegroundColor Red
    foreach ($f in @($logOut, $logErr)) {
      if (Test-Path $f) { Get-Content $f -Tail 30 | ForEach-Object { Write-Host "      $_" -ForegroundColor Red } }
    }
    throw "EL BUNDLE NO ARRANCA. NO se despliega."
  }

  # VARIAS rutas, y elegidas para que EJECUTEN.
  #
  # MEDIDO el 2026-09-14: con una sola peticion a `/es/new` esta guarda salia
  # VERDE con un modulo borrado a mano. `/es/new` lo contesta el middleware con
  # un 307 y el codigo de la pagina no llega a cargarse nunca — o sea que la
  # guarda miraba un log donde no podia haber pasado nada. Una comprobacion que
  # no puede fallar no comprueba.
  #
  # `/api/health` y `/es` SI entran en codigo de servidor (en local acaban en
  # 500 porque no hay base de datos, y eso es lo esperado: ver arriba, aqui no
  # se mira el codigo HTTP).
  foreach ($ruta in @("/api/health", "/es", "/es/new")) {
    try {
      Invoke-WebRequest -Uri "http://127.0.0.1:$Puerto$ruta" -TimeoutSec 25 -UseBasicParsing | Out-Null
    } catch {
      # 307, 500 y demas caen aqui en PowerShell 5.1. No es un fallo de la guarda.
    }
  }
  Start-Sleep -Milliseconds 800

  # `Select-String` devuelve NADA (no una lista vacia) cuando no casa, y
  # `.Matches` sobre null revienta. Un fichero sin errores es el caso BUENO:
  # que la guarda se caiga justo ahi seria el peor sitio posible para un fallo.
  $ausentes = @()
  foreach ($f in @($logOut, $logErr)) {
    if (-not (Test-Path $f)) { continue }
    $casan = Select-String -Path $f -Pattern "Cannot find module '([^']+)'" -AllMatches
    if (-not $casan) { continue }
    $ausentes += @($casan.Matches | ForEach-Object { $_.Groups[1].Value })
  }

  # LOS BINARIOS NATIVOS DE **WINDOWS** FALTAN A PROPOSITO, y eso no es un
  # defecto: el standalone se construye aqui y se ejecuta en Linux, asi que el
  # paso 6.5 de `deploy.ps1` reconstruye los crates para linux-x64-gnu EN LA
  # CAJA. Medido el 2026-09-14 sobre un bundle sano: ocho lineas, todas de
  # `@openlen/rate-limit-win32-x64-msvc` y `@openlen/html-engine-win32-x64-msvc`.
  #
  # Se filtra por `-win32-` y no por el nombre del crate: si manana faltara el
  # binario de LINUX de uno de ellos, eso SI es un fallo y tiene que sonar.
  $rotos = @($ausentes | Where-Object { $_ -notmatch '^@openlen/.+-win32-' } | Sort-Object -Unique)
  if ($rotos.Count -gt 0) {
    Write-Host "    Modulos de APLICACION que no resuelven:" -ForegroundColor Red
    $rotos | ForEach-Object { Write-Host "      $_" -ForegroundColor Red }
    throw "BUNDLE ROTO: faltan modulos que no son binarios nativos de Windows. NO se despliega — esto da 500 en produccion."
  }

  $nativos = @($ausentes | Sort-Object -Unique).Count
  Write-Host ("    arranca limpio: 0 modulos de aplicacion ausentes ({0} binarios win32, esperados)" -f $nativos) -ForegroundColor Green
} finally {
  if ($proceso -and -not $proceso.HasExited) { Stop-Process -Id $proceso.Id -Force -ErrorAction SilentlyContinue }
  $env:PORT     = $puertoPrevio
  $env:HOSTNAME = $hostPrevio
  Remove-Item -Force -ErrorAction SilentlyContinue $logOut, $logErr
}

Write-Host "Bundle verificado: completo y arranca." -ForegroundColor Green
