$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
& python (Join-Path $Root 'evidence/verification/world_tools.py') verify @args
exit $LASTEXITCODE
