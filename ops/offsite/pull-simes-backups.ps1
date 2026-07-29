[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$IdentityFile,

    [Parameter(Mandatory = $true)]
    [string]$Destination,

    [string]$RemoteHost = '76.13.44.23',
    [string]$RemoteUser = 'simes-backup',
    [string]$KnownHostsFile = (Join-Path $HOME '.ssh\known_hosts'),
    [int]$RetentionDays = 90
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($RetentionDays -lt 1) {
    throw 'RetentionDays must be greater than zero.'
}

$identityPath = [System.IO.Path]::GetFullPath($IdentityFile)
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
$knownHostsPath = [System.IO.Path]::GetFullPath($KnownHostsFile)
if (-not (Test-Path -LiteralPath $identityPath -PathType Leaf)) {
    throw "SSH identity file not found: $identityPath"
}
if (-not (Test-Path -LiteralPath $knownHostsPath -PathType Leaf)) {
    throw "SSH known-hosts file not found: $knownHostsPath"
}

$null = New-Item -ItemType Directory -Path $destinationPath -Force
$destinationResolved = (Resolve-Path -LiteralPath $destinationPath).Path
$sftp = (Get-Command sftp.exe -ErrorAction Stop).Source
$remote = "$RemoteUser@$RemoteHost"
$commonArguments = @(
    '-q',
    '-oBatchMode=yes',
    '-oStrictHostKeyChecking=yes',
    "-oUserKnownHostsFile=$knownHostsPath",
    '-oConnectTimeout=15',
    '-oServerAliveInterval=15',
    '-oServerAliveCountMax=2',
    '-i', $identityPath
)

function Invoke-SftpBatch {
    param([Parameter(Mandatory = $true)][string[]]$Commands)

    $batchPath = [System.IO.Path]::GetTempFileName()
    try {
        [System.IO.File]::WriteAllLines(
            $batchPath,
            $Commands,
            [System.Text.UTF8Encoding]::new($false)
        )
        $output = & $sftp @commonArguments -b $batchPath $remote 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "SFTP failed with exit code $LASTEXITCODE`: $($output -join [Environment]::NewLine)"
        }
        return @($output)
    }
    finally {
        Remove-Item -LiteralPath $batchPath -Force -ErrorAction SilentlyContinue
    }
}

$listing = Invoke-SftpBatch -Commands @('ls -1 /archives')
$remoteNames = @(
    $listing |
        ForEach-Object { [string]$_ } |
        ForEach-Object {
            if ($_ -match '(daily-\d{8}T\d{6}Z\.tar\.gz\.cms(?:\.sha256)?)$') {
                $Matches[1]
            }
        } |
        Sort-Object -Unique
)

$archiveNames = @(
    $remoteNames |
        Where-Object { $_ -match '\.tar\.gz\.cms$' } |
        Sort-Object
)

foreach ($archiveName in $archiveNames) {
    $checksumName = "$archiveName.sha256"
    if ($remoteNames -notcontains $checksumName) {
        throw "Remote checksum is missing for $archiveName"
    }

    $archivePath = Join-Path $destinationResolved $archiveName
    $checksumPath = Join-Path $destinationResolved $checksumName
    $archivePartial = "$archivePath.partial"
    $checksumPartial = "$checksumPath.partial"

    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
        Remove-Item -LiteralPath $archivePartial -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $checksumPartial -Force -ErrorAction SilentlyContinue

        $localDirectoryForSftp = $destinationResolved.Replace('\', '/')
        Invoke-SftpBatch -Commands @(
            "lcd `"$localDirectoryForSftp`"",
            "get /archives/$checksumName `"$checksumName.partial`"",
            "get /archives/$archiveName `"$archiveName.partial`""
        ) | Out-Null

        Move-Item -LiteralPath $checksumPartial -Destination $checksumPath -Force
        Move-Item -LiteralPath $archivePartial -Destination $archivePath -Force
    }
    elseif (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) {
        $localDirectoryForSftp = $destinationResolved.Replace('\', '/')
        Invoke-SftpBatch -Commands @(
            "lcd `"$localDirectoryForSftp`"",
            "get /archives/$checksumName `"$checksumName.partial`""
        ) | Out-Null
        Move-Item -LiteralPath $checksumPartial -Destination $checksumPath -Force
    }

    $checksumText = (Get-Content -LiteralPath $checksumPath -Raw).Trim()
    if ($checksumText -notmatch '^([0-9a-fA-F]{64})\s+\*?(.+)$') {
        throw "Invalid checksum file: $checksumPath"
    }
    $expectedHash = $Matches[1].ToUpperInvariant()
    $expectedName = [System.IO.Path]::GetFileName($Matches[2].Trim())
    if ($expectedName -ne $archiveName) {
        throw "Checksum filename mismatch for $archiveName"
    }

    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
    if ($actualHash -ne $expectedHash) {
        throw "SHA-256 mismatch for $archivePath"
    }
}

$cutoff = [DateTime]::UtcNow.AddDays(-$RetentionDays)
$managedFiles = Get-ChildItem -LiteralPath $destinationResolved -File |
    Where-Object {
        $_.Name -match '^daily-(\d{8}T\d{6}Z)\.tar\.gz\.cms(?:\.sha256)?$'
    }

foreach ($file in $managedFiles) {
    if ($file.Name -notmatch '^daily-(\d{8}T\d{6}Z)\.tar\.gz\.cms(?:\.sha256)?$') {
        continue
    }
    $timestampText = $Matches[1]
    $timestamp = [DateTime]::ParseExact(
        $timestampText,
        'yyyyMMddTHHmmssZ',
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AssumeUniversal -bor
            [Globalization.DateTimeStyles]::AdjustToUniversal
    )
    if ($timestamp -lt $cutoff) {
        $resolvedFile = [System.IO.Path]::GetFullPath($file.FullName)
        $destinationPrefix = $destinationResolved.TrimEnd('\') + '\'
        if (-not $resolvedFile.StartsWith($destinationPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove a file outside the destination: $resolvedFile"
        }
        Remove-Item -LiteralPath $resolvedFile -Force
    }
}

$status = [ordered]@{
    completed_utc = [DateTime]::UtcNow.ToString('o')
    remote = $remote
    destination = $destinationResolved
    verified_archives = $archiveNames.Count
    retention_days = $RetentionDays
}
$statusPath = Join-Path $destinationResolved 'last-pull.json'
$status | ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8

Write-Output "Verified offsite archives: $($archiveNames.Count)"
