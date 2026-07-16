$script:TestCount = 0
$script:TestFailures = 0

function ConvertTo-TestValue {
    param($Value)
    if ($null -eq $Value) { return "<null>" }
    if ($Value -is [string]) { return $Value }
    return ($Value | ConvertTo-Json -Depth 12 -Compress)
}

function Test-Case {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Body
    )
    $script:TestCount++
    try {
        & $Body
        Write-Host "PASS $Name"
    } catch {
        $script:TestFailures++
        Write-Host "FAIL $Name"
        Write-Host "  $($_.Exception.Message)"
    }
}

function Assert-True {
    param($Value, [string]$Message = "expected true")
    if (-not [bool]$Value) { throw $Message }
}

function Assert-False {
    param($Value, [string]$Message = "expected false")
    if ([bool]$Value) { throw $Message }
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    $expectedValue = ConvertTo-TestValue $Expected
    $actualValue = ConvertTo-TestValue $Actual
    if ($expectedValue -cne $actualValue) {
        if (-not $Message) { $Message = "expected <$expectedValue>, got <$actualValue>" }
        throw $Message
    }
}

function Assert-Match {
    param([string]$Pattern, $Actual, [string]$Message)
    if ([string]$Actual -notmatch $Pattern) {
        if (-not $Message) { $Message = "expected <$Actual> to match <$Pattern>" }
        throw $Message
    }
}

function Assert-Throws {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Body,
        [Parameter(Mandatory = $true)][string]$Pattern
    )
    try {
        & $Body
    } catch {
        if ($_.Exception.Message -notmatch [regex]::Escape($Pattern)) {
            throw "expected error containing <$Pattern>, got <$($_.Exception.Message)>"
        }
        return
    }
    throw "expected an error containing <$Pattern>"
}

function Complete-TestRun {
    if ($script:TestFailures -gt 0) {
        throw "$($script:TestFailures) of $($script:TestCount) tests failed"
    }
    Write-Host "$($script:TestCount) tests passed"
}
