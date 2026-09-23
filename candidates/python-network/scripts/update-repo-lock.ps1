$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if ($args.Count -eq 0) { $arguments = @('--output', (Join-Path $Root 'integration/repos.lock.json')) } else { $arguments = $args }
& python (Join-Path $Root 'evidence/verification/world_tools.py') update-lock @arguments
exit $LASTEXITCODE
