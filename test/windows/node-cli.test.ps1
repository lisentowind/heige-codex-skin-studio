$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$testPath = Join-Path $repositoryRoot "test\windows-node-cli-contract.test.mjs"

& node --test $testPath
if ($LASTEXITCODE -ne 0) {
    throw "Windows Node CLI contract failed with exit code $LASTEXITCODE"
}
