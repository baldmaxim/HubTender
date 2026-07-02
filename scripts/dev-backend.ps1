$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

function Import-DotEnv {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path $Path)) {
    Write-Warning "[dev-backend] Env file not found: $Path"
    return
  }

  Get-Content $Path | ForEach-Object {
    if ($_ -match '^\s*([^#][A-Za-z0-9_]+)=(.*)$') {
      $name = $matches[1].Trim()
      $value = $matches[2].Trim()

      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
          ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      }

      Set-Item -Path "env:$name" -Value $value
    }
  }
}

Import-DotEnv (Join-Path $RepoRoot '.env')
Import-DotEnv (Join-Path $RepoRoot '.env.prod')

$required = @('DATABASE_URL', 'APP_JWT_ISSUER')
foreach ($name in $required) {
  if (-not (Get-Item -Path "env:$name" -ErrorAction SilentlyContinue)) {
    throw "[dev-backend] Required env var is missing: $name"
  }
}

if (-not $env:APP_JWT_PRIVATE_KEY_PATH -and -not $env:APP_JWT_PRIVATE_KEY_B64) {
  throw '[dev-backend] Required env var is missing: APP_JWT_PRIVATE_KEY_PATH or APP_JWT_PRIVATE_KEY_B64'
}

$certDir = Join-Path $RepoRoot '.certs'
$caPath = Join-Path $certDir 'yandex-ca.pem'
if (-not (Test-Path $caPath)) {
  New-Item -ItemType Directory -Force $certDir | Out-Null
  Write-Host '[dev-backend] Downloading public Yandex CA certificate...'
  & curl.exe -fsSL 'https://storage.yandexcloud.net/cloud-certs/CA.pem' -o $caPath
  if ($LASTEXITCODE -ne 0) {
    throw '[dev-backend] Failed to download Yandex CA certificate.'
  }
}

$caUrlValue = [System.Uri]::EscapeDataString((Resolve-Path $caPath).Path.Replace('\', '/'))
if ($env:DATABASE_URL -match 'sslrootcert=') {
  $env:DATABASE_URL = [regex]::Replace($env:DATABASE_URL, 'sslrootcert=[^&]+', "sslrootcert=$caUrlValue")
} else {
  $separator = if ($env:DATABASE_URL.Contains('?')) { '&' } else { '?' }
  $env:DATABASE_URL = "$($env:DATABASE_URL)$separator" + "sslrootcert=$caUrlValue"
}

# Local browser portal defaults. Override with DEV_CORS_ORIGINS / DEV_APP_BASE_URL if needed.
$env:CORS_ORIGINS = if ($env:DEV_CORS_ORIGINS) { $env:DEV_CORS_ORIGINS } else { 'http://localhost:5185,http://127.0.0.1:5185' }
$env:APP_BASE_URL = if ($env:DEV_APP_BASE_URL) { $env:DEV_APP_BASE_URL } else { 'http://localhost:5185' }
$env:APP_ENV = 'development'
$env:SENTRY_DSN = ''
$env:SENTRY_ENVIRONMENT = 'development'
$env:BIND_HOST = '127.0.0.1'
$env:PORT = if ($env:DEV_BACKEND_PORT) { $env:DEV_BACKEND_PORT } else { '3005' }

Write-Host "[dev-backend] Starting Go BFF on http://$($env:BIND_HOST):$($env:PORT)"
Write-Host "[dev-backend] Press Ctrl+C to stop."

Push-Location (Join-Path $RepoRoot 'backend')
try {
  & go.exe run ./cmd/server
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
