[CmdletBinding()]
param(
    [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'

$required = @(
    'README.md',
    'AGENTS.md',
    '.gitignore',
    '.gitattributes',
    'architecture',
    'os\kindred-os',
    'boot\kindred-bios',
    'virtualization\kindred-vm',
    'platform\dotai',
    'orchestration\kas',
    'coordination\brainstem',
    'labs\genesis',
    'foundry',
    'mission-control\ksrq4',
    'verticals\k1',
    'verticals\kjs',
    'verticals\watt',
    'enterprise\brainstem-intouch',
    'cloud',
    'control-plane\strata-fortress',
    'interfaces\supershell',
    'identity\iamix',
    'security\borg',
    'routing\mesh',
    'memory\ceramic',
    'optimization\omni-flywheel',
    'economics\retrobank',
    'payments\kindred-pay',
    'chain\kindred-chain',
    'evidence',
    'operations',
    'tests'
)

$missing = foreach ($relative in $required) {
    $path = Join-Path $Root $relative
    if (-not (Test-Path -LiteralPath $path)) {
        $relative
    }
}

if ($missing) {
    Write-Error ("Missing required paths:`n - " + ($missing -join "`n - "))
    exit 1
}

Write-Host "Kindred Superstructure skeleton: VALID" -ForegroundColor Green
