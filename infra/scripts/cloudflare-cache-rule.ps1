#Requires -Version 5.1
<#
.SYNOPSIS
  Create/update the Cloudflare Cache Rule that lets published OpenLen landing
  pages (*.openlen.com, excluding www) be cached at the edge.

.DESCRIPTION
  Cloudflare does NOT cache HTML by default — even when the origin sends
  s-maxage — so published pages return `cf-cache-status: DYNAMIC` and every
  visit round-trips to the single Hetzner origin. This rule marks those hosts
  "eligible for cache" and honors the origin Cache-Control set by the Caddyfile
  (s-maxage=3600 for the document, immutable 30d for assets), so pages serve
  HIT from the nearest Cloudflare PoP.

  Because the mode is `respect_origin`, the rule needs no per-path exclusions:
  assets keep their 30-day immutable TTL, the HTML document gets 1h edge TTL,
  and the /c/ analytics beacons + /api/f/ form POSTs proxied to Node stay
  uncached (Node sends no-cache; POSTs are never cached).

  Idempotent — keyed by rule description; re-running updates in place.
  Non-destructive — preserves any other cache rules already in the zone, and
  ABORTS (writes nothing) if the existing ruleset can't be read, so a
  transient API error can never wipe your current rules.

  Token scope required: Zone:Read + Zone:Cache Rules:Edit on openlen.com.
  (The certbot DNS-01 token does NOT carry Cache Rules. Create one token with
  Zone:Read + Cache Rules:Edit + Cache Purge:Edit and reuse it for both this
  script and the app's CLOUDFLARE_API_TOKEN purge-on-publish.)

.EXAMPLE
  $env:CLOUDFLARE_ZONE_ID  = '<zone id>'
  $env:CLOUDFLARE_API_TOKEN = '<token>'
  pwsh infra/scripts/cloudflare-cache-rule.ps1

.EXAMPLE
  pwsh infra/scripts/cloudflare-cache-rule.ps1 -ZoneId <id> -Token <token> -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$ZoneId     = $env:CLOUDFLARE_ZONE_ID,
  [string]$Token      = $env:CLOUDFLARE_API_TOKEN,
  [string]$HostSuffix = '.openlen.com'
)

$ErrorActionPreference = 'Stop'
if (-not $ZoneId) { throw 'Set CLOUDFLARE_ZONE_ID (env var or -ZoneId).' }
if (-not $Token)  { throw 'Set CLOUDFLARE_API_TOKEN (env var or -Token).' }

$desc    = 'openlen: cache published landing pages (respect origin TTL)'
$expr    = 'ends_with(http.host, "{0}") and http.host ne "www{0}"' -f $HostSuffix
$headers = @{ Authorization = "Bearer $Token" }
$entry   = "https://api.cloudflare.com/client/v4/zones/$ZoneId/rulesets/phases/http_request_cache_settings/entrypoint"

$ourRule = [ordered]@{
  description       = $desc
  expression        = $expr
  action            = 'set_cache_settings'
  enabled           = $true
  action_parameters = [ordered]@{
    cache       = $true
    edge_ttl    = @{ mode = 'respect_origin' }
    browser_ttl = @{ mode = 'respect_origin' }
    serve_stale = @{ disable_stale_while_updating = $false }
  }
}

function Get-StatusCode($err) { try { [int]$err.Exception.Response.StatusCode } catch { 0 } }

$existing = @()
try {
  $cur = Invoke-RestMethod -Method GET -Uri $entry -Headers $headers
  if ($cur.result.rules) { $existing = @($cur.result.rules) }
  Write-Host "Found existing cache-phase ruleset with $($existing.Count) rule(s)."
} catch {
  $code = Get-StatusCode $_
  if ($code -eq 404) {
    Write-Host 'No cache-phase ruleset yet — will create one.'
  } else {
    throw "GET ruleset failed (HTTP $code). Aborting so existing rules aren't clobbered. $($_.Exception.Message)"
  }
}

# Rebuild the rule list: replace ours by description, preserve the rest
# (stripping server-managed fields id/version/ref/last_updated).
$rules    = @()
$replaced = $false
foreach ($r in $existing) {
  if ($r.description -eq $desc) {
    $rules += $ourRule
    $replaced = $true
  } else {
    $rules += [ordered]@{
      description       = $r.description
      expression        = $r.expression
      action            = $r.action
      enabled           = $r.enabled
      action_parameters = $r.action_parameters
    }
  }
}
if (-not $replaced) { $rules += $ourRule }

$body = @{ rules = $rules } | ConvertTo-Json -Depth 20
if ($PSCmdlet.ShouldProcess("zone $ZoneId", "PUT cache ruleset ($($rules.Count) rule(s))")) {
  $res = Invoke-RestMethod -Method PUT -Uri $entry -Headers $headers -ContentType 'application/json' -Body $body
  Write-Host ("OK — {0} rule(s) now live in the cache phase." -f $res.result.rules.Count)
  Write-Host ''
  Write-Host 'Verify against a REAL published subdomain:'
  Write-Host '  curl -sI https://<sub>.openlen.com/ | findstr /i cf-cache-status'
  Write-Host '  (first hit = MISS, then HIT — was DYNAMIC before this rule)'
}
