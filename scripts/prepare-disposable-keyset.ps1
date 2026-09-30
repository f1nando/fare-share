param(
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [Parameter(Mandatory = $true)][string]$BackupZip,
  [Parameter(Mandatory = $true)][string]$UpgradeAuthorityAddress,
  [string]$Confirm,
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$requiredConfirmation = 'GENERATE-DISPOSABLE-REHEARSAL-KEYSET'
$repo = [IO.Path]::GetFullPath((git rev-parse --show-toplevel).Trim())
$output = [IO.Path]::GetFullPath($OutputDirectory)
$zip = [IO.Path]::GetFullPath($BackupZip)

if ($output.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'OutputDirectory must be outside the Git repository.'
}
if ($zip.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'BackupZip must be outside the Git repository.'
}
if ((Test-Path $output) -or (Test-Path $zip)) { throw 'OutputDirectory and BackupZip must not already exist.' }
if (-not $Execute) {
  Write-Output 'READ_ONLY=true'
  Write-Output "OUTPUT_DIRECTORY=$output"
  Write-Output "BACKUP_ZIP=$zip"
  Write-Output "EXECUTE_CONFIRMATION=$requiredConfirmation"
  exit 0
}
if ($Confirm -ne $requiredConfirmation) { throw "Exact confirmation required: $requiredConfirmation" }

New-Item -ItemType Directory -Path $output | Out-Null
$keyFiles = [ordered]@{
  program = Join-Path $output 'program-id.json'
  collection = Join-Path $output 'collection.json'
  userWallet = Join-Path $output 'user-wallet.json'
  buffer = Join-Path $output 'persistent-buffer.json'
}
try {
  foreach ($path in $keyFiles.Values) {
    & solana-keygen new --no-bip39-passphrase --silent --outfile $path
    if ($LASTEXITCODE -ne 0) { throw "solana-keygen failed for $path" }
  }
  $addresses = [ordered]@{}
  foreach ($entry in $keyFiles.GetEnumerator()) {
    $addresses[$entry.Key] = (& solana-keygen pubkey $entry.Value).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Could not derive $($entry.Key) address" }
  }

  Compress-Archive -Path $keyFiles.Values -DestinationPath $zip -CompressionLevel Optimal
  $verifyDirectory = Join-Path ([IO.Path]::GetTempPath()) ("fare-share-keyset-" + [guid]::NewGuid().ToString('N'))
  try {
    Expand-Archive -Path $zip -DestinationPath $verifyDirectory
    foreach ($entry in $keyFiles.GetEnumerator()) {
      $restored = Join-Path $verifyDirectory ([IO.Path]::GetFileName($entry.Value))
      $restoredAddress = (& solana-keygen pubkey $restored).Trim()
      if ($LASTEXITCODE -ne 0 -or $restoredAddress -ne $addresses[$entry.Key]) {
        throw "Backup verification failed for $($entry.Key)"
      }
    }
  } finally {
    if (Test-Path $verifyDirectory) { Remove-Item -Recurse -Force $verifyDirectory }
  }

  $marker = [ordered]@{
    backupVerified = $true
    verifiedAt = [DateTime]::UtcNow.ToString('o')
    programId = $addresses.program
    collection = $addresses.collection
    userWallet = $addresses.userWallet
    buffer = $addresses.buffer
    upgradeAuthority = $UpgradeAuthorityAddress
    backupZipSha256 = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  $marker | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $output 'backup-marker.json')
  Write-Output 'DISPOSABLE_KEYSET_READY=true'
  foreach ($entry in $addresses.GetEnumerator()) { Write-Output "$($entry.Key.ToUpperInvariant())_ADDRESS=$($entry.Value)" }
  Write-Output "BACKUP_ZIP_SHA256=$($marker.backupZipSha256)"
} catch {
  Write-Error $_
  throw
}
