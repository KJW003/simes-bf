[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$EncryptedArchive,

    [Parameter(Mandatory = $true)]
    [string]$PrivateKey,

    [Parameter(Mandatory = $true)]
    [string]$RecipientCertificate,

    [Parameter(Mandatory = $true)]
    [string]$OutputArchive,

    [string]$OpenSsl = 'C:\Program Files\Git\mingw64\bin\openssl.exe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$encryptedPath = [System.IO.Path]::GetFullPath($EncryptedArchive)
$privateKeyPath = [System.IO.Path]::GetFullPath($PrivateKey)
$certificatePath = [System.IO.Path]::GetFullPath($RecipientCertificate)
$outputPath = [System.IO.Path]::GetFullPath($OutputArchive)
$partialPath = "$outputPath.partial"

foreach ($requiredPath in @($encryptedPath, $privateKeyPath, $certificatePath, $OpenSsl)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required file not found: $requiredPath"
    }
}

$checksumPath = "$encryptedPath.sha256"
if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) {
    throw "Checksum file not found: $checksumPath"
}
$checksumText = (Get-Content -LiteralPath $checksumPath -Raw).Trim()
if ($checksumText -notmatch '^([0-9a-fA-F]{64})\s+\*?(.+)$') {
    throw "Invalid checksum file: $checksumPath"
}
$expectedHash = $Matches[1].ToUpperInvariant()
$actualHash = (Get-FileHash -LiteralPath $encryptedPath -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash) {
    throw 'Encrypted archive SHA-256 verification failed.'
}

$outputDirectory = Split-Path -Parent $outputPath
$null = New-Item -ItemType Directory -Path $outputDirectory -Force
Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue

try {
    & $OpenSsl cms -decrypt -binary -inform DER `
        -in $encryptedPath `
        -inkey $privateKeyPath `
        -recip $certificatePath `
        -out $partialPath
    if ($LASTEXITCODE -ne 0) {
        throw "OpenSSL CMS decryption failed with exit code $LASTEXITCODE."
    }

    & tar.exe -tzf $partialPath | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Decrypted archive failed tar integrity validation.'
    }

    Move-Item -LiteralPath $partialPath -Destination $outputPath -Force
    Write-Output "Verified decrypted archive: $outputPath"
}
finally {
    Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
}
