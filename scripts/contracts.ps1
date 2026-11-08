# Build, test, and deploy the Soroban contracts with the host toolchain.
# Rust MSVC + wasm32v1-none, Stellar CLI on PATH (or %USERPROFILE%\.local\bin).
param(
  [Parameter(Position = 0)]
  [ValidateSet("test", "lint", "build", "deploy", "smoke", "doctor")]
  [string]$Command = "doctor"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-msvc"
$env:PATH = @(
  (Join-Path $env:USERPROFILE ".local\bin"),
  (Join-Path $env:USERPROFILE ".cargo\bin"),
  $env:PATH
) -join ";"

function Invoke-BashScript([string]$Name) {
  $bash = Join-Path $env:ProgramFiles "Git\bin\bash.exe"
  if (-not (Test-Path $bash)) {
    throw "Git Bash is required to run scripts/$Name."
  }
  & $bash --noprofile --norc (Join-Path $Root "scripts\$Name")
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

switch ($Command) {
  "doctor" {
    & rustc --version
    & cargo --version
    & stellar --version
    exit 0
  }
  "test" {
    Set-Location (Join-Path $Root "contracts")
    & cargo test
    exit $LASTEXITCODE
  }
  "lint" {
    Set-Location (Join-Path $Root "contracts")
    & cargo fmt --check
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & cargo clippy --all-targets "--" "-D" "warnings"
    exit $LASTEXITCODE
  }
  "build" {
    Set-Location (Join-Path $Root "contracts")
    & stellar contract build
    exit $LASTEXITCODE
  }
  "deploy" { Invoke-BashScript "deploy-testnet.sh" }
  "smoke" { Invoke-BashScript "smoke-testnet.sh" }
}
