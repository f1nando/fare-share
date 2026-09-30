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

function Convert-ToWslPath([string]$Path) {
  $portablePath = $Path.Replace('\', '/')
  $converted = (& wsl.exe -e wslpath -a -u $portablePath).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $converted) { throw "Could not convert path for WSL: $Path" }
  return $converted
}

function Invoke-SolanaKeygen([string[]]$KeygenArguments) {
  $output = & wsl.exe solana-keygen @KeygenArguments
  if ($LASTEXITCODE -ne 0) { throw "WSL solana-keygen failed: $($KeygenArguments -join ' ')" }
  return $output
}

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
    $wslPath = Convert-ToWslPath $path
    Invoke-SolanaKeygen @('new', '--no-bip39-passphrase', '--silent', '--outfile', $wslPath) | Out-Null
  }
  $addresses = [ordered]@{}
  foreach ($entry in $keyFiles.GetEnumerator()) {
    $addresses[$entry.Key] = (Invoke-SolanaKeygen @('pubkey', (Convert-ToWslPath $entry.Value))).Trim()
  }

  Compress-Archive -Path $keyFiles.Values -DestinationPath $zip -CompressionLevel Optimal
  $verifyDirectory = Join-Path ([IO.Path]::GetTempPath()) ("fare-share-keyset-" + [guid]::NewGuid().ToString('N'))
  try {
    Expand-Archive -Path $zip -DestinationPath $verifyDirectory
    foreach ($entry in $keyFiles.GetEnumerator()) {
      $restored = Join-Path $verifyDirectory ([IO.Path]::GetFileName($entry.Value))
      $restoredAddress = (Invoke-SolanaKeygen @('pubkey', (Convert-ToWslPath $restored))).Trim()
      if ($restoredAddress -ne $addresses[$entry.Key]) {
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
