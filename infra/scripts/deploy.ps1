# infra/scripts/deploy.ps1 -- one-command Windows deploy to Hetzner.
#
# Replaces the manual scp + ssh-extract + ssh-swap dance:
#   1. npm run build
#   2. compose standalone (cp static + public into .next/standalone)
#   3. tar to openlen-deploy.tar.gz
#   4. scp the tarball to /root/ on the box
#   5. extract to /opt/openlen-app-staging
#   6. systemd stop -> atomic mv swap -> start
#   7. cleanup local + remote tarball
#   8. smoke test
#
# Usage (from repo root):
#   npm run deploy:prod
#
# Override defaults via env vars:
#   $env:OPENLEN_HOST = "openlen"          # ssh alias from ~/.ssh/config
#   $env:OPENLEN_REMOTE_PATH = "/opt/openlen-app"
#   $env:OPENLEN_SKIP_BUILD = "1"          # reuse existing .next/standalone
#   $env:OPENLEN_REBUILD_CRATES = "1"      # rebuild Rust .node binaries on box
#                                          # (required when crates/ changed)

$ErrorActionPreference = "Stop"

$host_ = if ($env:OPENLEN_HOST) { $env:OPENLEN_HOST } else { "openlen" }
$remoteDir = if ($env:OPENLEN_REMOTE_PATH) { $env:OPENLEN_REMOTE_PATH } else { "/opt/openlen-app" }
$tarballName = "openlen-deploy.tar.gz"
$stagingDir = "$remoteDir-staging"
$backupDir = "$remoteDir.old"

function Step($n, $msg) {
  Write-Host ""
  Write-Host "[$n/6] $msg" -ForegroundColor Cyan
}

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

# --- 2. Compose standalone with static + public -----------------------
Step 2 "Composing standalone (copying .next/static + public/)..."
New-Item -ItemType Directory -Force -Path ".next/standalone/.next/static" | Out-Null
Copy-Item -Recurse -Force ".next/static/*" ".next/standalone/.next/static/"
if (Test-Path "public") {
  New-Item -ItemType Directory -Force -Path ".next/standalone/public" | Out-Null
  Copy-Item -Recurse -Force "public/*" ".next/standalone/public/"
}
$size = (Get-ChildItem -Recurse ".next/standalone" | Measure-Object -Property Length -Sum).Sum
Write-Host ("    standalone: {0} MB" -f [math]::Round($size/1MB, 1))

# Note: we used to install sharp's linux binaries client-side here, but
# Windows npm refuses to materialize platform-mismatched optionals into
# node_modules (it short-circuits the install). The fix lives on the box
# now — see step 5 below.

# --- 3. Tar locally ----------------------------------------------------
Step 3 "Creating tarball ($tarballName)..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()
& tar -czf $tarballName -C .next/standalone .
if ($LASTEXITCODE -ne 0) { throw "tar failed (exit $LASTEXITCODE)" }
$tarSize = (Get-Item $tarballName).Length
$sw.Stop()
Write-Host ("    {0} MB, {1}s" -f [math]::Round($tarSize/1MB, 1), [math]::Round($sw.Elapsed.TotalSeconds, 1))

# --- 4. SCP to box -----------------------------------------------------
Step 4 "Uploading to ${host_}:/root/..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()
& scp -q $tarballName "${host_}:/root/"
if ($LASTEXITCODE -ne 0) { throw "scp failed (exit $LASTEXITCODE)" }
$sw.Stop()
Write-Host ("    {0}s" -f [math]::Round($sw.Elapsed.TotalSeconds, 1))

# --- 5. Extract on box + install sharp linux binaries -----------------
# After untarring the Windows-built standalone, we still need sharp's
# linux-x64 native binaries (they were never in the tarball because
# Windows npm refuses to install platform-mismatched optionals). Doing
# this on the box itself sidesteps the cross-platform npm quirk.
# PUPPETEER_SKIP_DOWNLOAD=1 prevents puppeteer's postinstall from trying
# to re-download chrome-headless-shell (its cache may be corrupted from
# prior interrupted installs).
Step 5 "Extracting to $stagingDir + installing sharp linux binaries..."
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
& ssh $host_ $extractCmd
if ($LASTEXITCODE -ne 0) { throw "Remote extract failed (exit $LASTEXITCODE)" }

# --- 5.5. Rebuild Rust crates on box (optional) ----------------------
# When OPENLEN_REBUILD_CRATES=1, rsync the Rust workspace to the box and
# rebuild the linux-x64-gnu .node binaries into the STAGING dir, so they
# enter the atomic swap in step 6. Without this, the win32 .node binaries
# from the local build would land on Linux and crash on first require().
# JS-only deploys (95% of them) leave this off and pay no cost.
if ($env:OPENLEN_REBUILD_CRATES -eq "1") {
  Step "5.5" "Rebuilding Rust crates on box (this takes ~5 min)..."
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  # Ship the Rust workspace + build script to the box. PowerShell on
  # Windows doesn't ship rsync, so we tar + scp + remote-extract — same
  # pattern as the standalone deploy in steps 3-5.
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
  # staging here is safe — rebuild then continue to the swap in step 6.
  $cratesCmd = @"
set -e
mkdir -p /root/openlen-workspace
tar -xzf /root/$cratesTarball -C /root/openlen-workspace
rm /root/$cratesTarball
chmod +x /root/build-crates-on-box.sh
bash /root/build-crates-on-box.sh $stagingDir
"@
  & ssh $host_ $cratesCmd
  if ($LASTEXITCODE -ne 0) { throw "Crate rebuild failed (exit $LASTEXITCODE)" }
  Remove-Item -Force $cratesTarball
  $sw.Stop()
  Write-Host ("    done in {0}s" -f [math]::Round($sw.Elapsed.TotalSeconds, 1))
} else {
  # Heuristic: warn if Rust source changed in the last commit but the flag
  # is off — catches "I edited crates/ and forgot the flag" without forcing
  # the 5-min cost on every deploy.
  $cratesChanged = $null
  try { $cratesChanged = & git diff --stat HEAD~1 HEAD -- crates/ 2>$null } catch {}
  if ($cratesChanged) {
    Write-Host ""
    Write-Host "  WARN: crates/ has changes vs HEAD~1 but OPENLEN_REBUILD_CRATES is not set." -ForegroundColor Yellow
    Write-Host "        If the Rust binaries need rebuilding, set `$env:OPENLEN_REBUILD_CRATES=`"1`" and re-run." -ForegroundColor Yellow
  }
}

# --- 6. Atomic swap + restart + smoke test ---------------------------
Step 6 "Atomic swap + restart..."
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
& ssh $host_ $swapCmd
if ($LASTEXITCODE -ne 0) { throw "Swap or restart failed (exit $LASTEXITCODE)" }

# --- Cleanup local tarball --------------------------------------------
Remove-Item -Force $tarballName

Write-Host ""
Write-Host "OK Deploy complete." -ForegroundColor Green
Write-Host "  Rollback if needed:" -ForegroundColor DarkGray
Write-Host '    ssh openlen "systemctl stop openlen-app; rm -rf /opt/openlen-app; mv /opt/openlen-app.old /opt/openlen-app; systemctl start openlen-app"' -ForegroundColor DarkGray
