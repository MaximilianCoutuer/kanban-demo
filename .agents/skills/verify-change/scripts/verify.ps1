# AgentBoard verification. Does not install dependencies or modify source.
param(
    [ValidateSet('backend', 'frontend', 'all', 'e2e', 'full')]
    [string]$Scope = 'all'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$Frontend = Join-Path $RepoRoot 'frontend/agentboard'
# On Windows, use the .cmd launchers to avoid PowerShell execution-policy issues.
$Npm = if ($IsWindows) { 'npm.cmd' } else { 'npm' }
$Npx = if ($IsWindows) { 'npx.cmd' } else { 'npx' }
$script:Passed = [System.Collections.Generic.List[string]]::new()
$script:Failed = [System.Collections.Generic.List[string]]::new()

function Invoke-Check {
    param(
        [string]$Name,
        [string]$WorkingDirectory,
        [string]$Executable,
        [string[]]$Arguments
    )

    Write-Host "`n== $Name =="
    if (-not (Test-Path -LiteralPath $WorkingDirectory -PathType Container)) {
        Write-Host "FAIL: missing directory: $WorkingDirectory"
        $script:Failed.Add($Name)
        return
    }

    Push-Location -LiteralPath $WorkingDirectory
    try {
        & $Executable @Arguments
        if ($LASTEXITCODE -eq 0) {
            Write-Host "PASS: $Name"
            $script:Passed.Add($Name)
        } else {
            Write-Host "FAIL: $Name (exit $LASTEXITCODE)"
            $script:Failed.Add($Name)
        }
    } catch {
        Write-Host "FAIL: $Name ($($_.Exception.Message))"
        $script:Failed.Add($Name)
    } finally {
        Pop-Location
    }
}

if ($Scope -in @('backend', 'all', 'full')) {
    Invoke-Check -Name '.NET tests' -WorkingDirectory $RepoRoot -Executable 'dotnet' `
      -Arguments @('test', 'tests/AgentBoard.Api.Tests/AgentBoard.Api.Tests.csproj', '--no-restore', '-c', 'Release')
}
if ($Scope -in @('frontend', 'all', 'full')) {
    Invoke-Check -Name 'Angular unit tests' -WorkingDirectory $Frontend -Executable $Npm `
      -Arguments @('test', '--', '--watch=false')
    Invoke-Check -Name 'Angular production build' -WorkingDirectory $Frontend -Executable $Npm `
      -Arguments @('run', 'build')
}
if ($Scope -in @('e2e', 'full')) {
    Invoke-Check -Name 'Automated Playwright tests' -WorkingDirectory $Frontend -Executable $Npx `
      -Arguments @('--no-install', 'playwright', 'test')
}

Write-Host "`n== Summary =="
Write-Host "Passed: $($script:Passed.Count) | Failed: $($script:Failed.Count)"
if ($script:Failed.Count -gt 0) {
    Write-Host "Failed checks: $($script:Failed -join ', ')"
    exit 1
}
exit 0
