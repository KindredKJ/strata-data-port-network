if ($Host.UI -and $Host.UI.RawUI) {
    try { $Host.UI.RawUI.WindowTitle = "Strata Data Port Network" } catch { }
}

Clear-Host

Write-Host ""
Write-Host "=============================================================="
Write-Host "              STRATA DATA PORT NETWORK"
Write-Host "=============================================================="
Write-Host ""
Write-Host " Founder: Kindred Jermaine Cox"
Write-Host " Kindred Labs"
Write-Host ""
Write-Host " Canonical commit:"
Write-Host " 25c3b5aff912cd14b71c7abf49050be1b60722d0"
Write-Host ""
Write-Host " [1] Open Strata repository"
Write-Host " [2] Run verification"
Write-Host " [3] Run SW06-E measurement"
Write-Host " [4] Open public launch site"
Write-Host " [5] Open receipt directory"
Write-Host " [6] Start Strata Node"
Write-Host " [7] Stop Strata Node"
Write-Host " [8] Restart Strata Node"
Write-Host " [9] Strata Node status"
Write-Host " [L] Strata Node logs"
Write-Host " [V] Verify Strata Node"
Write-Host " [Q] Quit"
Write-Host ""

while ($true) {

    $choice = Read-Host "STRATA"

    switch ($choice.ToUpper()) {

        "1" {
            Start-Process "https://github.com/KindredKJ/strata-data-port-network"
        }

        "2" {
            $repositoryRoot = "C:\Users\Kindred KJ Cox\KindredLabs\strata-data-port-network"
            $pythonExe = Join-Path $repositoryRoot "candidates\python-network\.venv\Scripts\python.exe"
            if (-not (Test-Path -LiteralPath $pythonExe -PathType Leaf)) {
                Write-Error "Release verification blocked: explicit virtual-environment interpreter not found: $pythonExe"
                break
            }
            Set-Location $repositoryRoot
            $env:STRATA_PYTHON = $pythonExe
            npm run verify:release
            $releaseExitCode = $LASTEXITCODE
            Remove-Item Env:STRATA_PYTHON -ErrorAction SilentlyContinue
            if ($releaseExitCode -ne 0) {
                Write-Error "Release verification failed with exit code $releaseExitCode; no green receipt or READY status was created."
            } else {
                Write-Host "Release verification PASS; receipt was created only after all gates passed." -ForegroundColor Green
            }
        }

        "3" {
            Set-Location "C:\Users\Kindred KJ Cox\KindredLabs\strata-data-port-network"
            npm run measure
        }

        "4" {
            Start-Process "https://stratadataportnetwork.vercel.app"
        }

        "5" {
            Start-Process explorer.exe "C:\Users\Kindred KJ Cox\KindredLabs\strata-data-port-network\.strata\receipts"
        }

        "6" { & "$PSScriptRoot\..\node\Invoke-StrataNode.ps1" -Operation start -Port 8787; $nodeExitCode = $LASTEXITCODE; if ($nodeExitCode -ne 0) { Write-Error "Strata Node start failed with exit code $nodeExitCode" } }
        "7" { & "$PSScriptRoot\..\node\Invoke-StrataNode.ps1" -Operation stop -Port 8787; $nodeExitCode = $LASTEXITCODE; if ($nodeExitCode -ne 0) { Write-Error "Strata Node stop failed with exit code $nodeExitCode" } }
        "8" { & "$PSScriptRoot\..\node\Invoke-StrataNode.ps1" -Operation restart -Port 8787; $nodeExitCode = $LASTEXITCODE; if ($nodeExitCode -ne 0) { Write-Error "Strata Node restart failed with exit code $nodeExitCode" } }
        "9" { & "$PSScriptRoot\..\node\Invoke-StrataNode.ps1" -Operation status -Port 8787; $nodeExitCode = $LASTEXITCODE; if ($nodeExitCode -ne 0) { Write-Error "Strata Node status failed with exit code $nodeExitCode" } }
        "L" { & "$PSScriptRoot\..\node\Invoke-StrataNode.ps1" -Operation logs -Port 8787; $nodeExitCode = $LASTEXITCODE; if ($nodeExitCode -ne 0) { Write-Error "Strata Node logs failed with exit code $nodeExitCode" } }
        "V" { & "$PSScriptRoot\..\node\Invoke-StrataNode.ps1" -Operation verify -Port 8787; $nodeExitCode = $LASTEXITCODE; if ($nodeExitCode -ne 0) { Write-Error "Strata Node verification failed with exit code $nodeExitCode" } }

        "Q" {
            exit
        }
    }
}
