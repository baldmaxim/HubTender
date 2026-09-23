param(
  [Parameter(Mandatory=$true)][string]$BaseUrl,
  [string]$AccessToken = ''
)
$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')

function Assert-Status([string]$Url, [int]$Expected) {
  try {
    $r = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 20 -ErrorAction Stop
    $status = [int]$r.StatusCode
  } catch {
    if (-not $_.Exception.Response) { throw }
    $status = [int]$_.Exception.Response.StatusCode
  }
  if ($status -ne $Expected) { throw "Expected HTTP $Expected from $Url, got $status" }
}

Assert-Status "$base/.well-known/oauth-protected-resource" 200
Assert-Status "$base/.well-known/oauth-authorization-server" 200
Assert-Status "$base/.well-known/jwks.json" 200

try {
  Invoke-WebRequest -Uri "$base/mcp" -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 20 -ErrorAction Stop | Out-Null
  throw 'Unauthenticated /mcp unexpectedly succeeded.'
} catch {
  if (-not $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 401) { throw }
  $challenge = [string]$_.Exception.Response.Headers.WwwAuthenticate
  if ($challenge -notmatch 'resource_metadata') { throw '401 is missing OAuth resource_metadata challenge.' }
}

if (-not $AccessToken) {
  Write-Host 'PASS: public discovery and unauthenticated MCP challenge. Supply -AccessToken for protocol checks.'
  exit 0
}

$meta = @{
  'io.modelcontextprotocol/protocolVersion' = '2026-07-28'
  'io.modelcontextprotocol/clientCapabilities' = @{}
  'io.modelcontextprotocol/clientInfo' = @{ name='hubtender-handoff-smoke'; version='1.0.0' }
}
$headers = @{
  Authorization = "Bearer $AccessToken"
  'MCP-Protocol-Version' = '2026-07-28'
  Accept = 'application/json, text/event-stream'
}
function Invoke-Mcp([string]$Method, [hashtable]$Params) {
  $headers['MCP-Method'] = $Method
  $body = @{ jsonrpc='2.0'; id=1; method=$Method; params=$Params } | ConvertTo-Json -Depth 10
  Invoke-RestMethod -Uri "$base/mcp" -Method Post -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 30
}
$discover = Invoke-Mcp 'server/discover' @{ _meta=$meta }
if (-not $discover.result) { throw 'server/discover returned no result.' }
$tools = Invoke-Mcp 'tools/list' @{ _meta=$meta }
$count = @($tools.result.tools).Count
if ($count -ne 18) { throw "Expected 18 MCP tools, got $count" }
foreach ($tool in $tools.result.tools) {
  if (-not $tool.inputSchema -or -not $tool.outputSchema -or -not $tool.annotations) { throw "Incomplete tool contract: $($tool.name)" }
}
Write-Host "PASS: MCP discovery and $count typed tools."
