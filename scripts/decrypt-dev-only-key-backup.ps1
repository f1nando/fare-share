param(
    [Parameter(Mandatory = $true)]
    [string]$InputFile,

    [string]$OutputZip = "fare-taxi-park-keys.zip"
)

$securePassword = Read-Host "Recovery password" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $payload = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $InputFile))
    $magic = [Text.Encoding]::ASCII.GetBytes("TAXIKEY1")

    if ($payload.Length -lt 88) {
        throw "Encrypted backup is truncated."
    }
    for ($index = 0; $index -lt $magic.Length; $index++) {
        if ($payload[$index] -ne $magic[$index]) {
            throw "Unsupported encrypted backup format."
        }
    }

    $salt = $payload[8..23]
    $iv = $payload[24..39]
    $storedMac = $payload[40..71]
    $ciphertext = $payload[72..($payload.Length - 1)]

    $derive = [Security.Cryptography.Rfc2898DeriveBytes]::new(
        $password,
        $salt,
        600000,
        [Security.Cryptography.HashAlgorithmName]::SHA256
    )
    try {
        $keyMaterial = $derive.GetBytes(64)
    }
    finally {
        $derive.Dispose()
    }

    $encryptionKey = $keyMaterial[0..31]
    $authenticationKey = $keyMaterial[32..63]
    $authenticatedPayload = New-Object byte[] (40 + $ciphertext.Length)
    [Array]::Copy($payload, 0, $authenticatedPayload, 0, 40)
    [Array]::Copy($ciphertext, 0, $authenticatedPayload, 40, $ciphertext.Length)

    $hmac = [Security.Cryptography.HMACSHA256]::new($authenticationKey)
    try {
        $computedMac = $hmac.ComputeHash($authenticatedPayload)
    }
    finally {
        $hmac.Dispose()
    }
    $macDifference = 0
    for ($index = 0; $index -lt $storedMac.Length; $index++) {
        $macDifference = $macDifference -bor ($storedMac[$index] -bxor $computedMac[$index])
    }
    if ($macDifference -ne 0) {
        throw "Wrong password or damaged backup."
    }

    $aes = [Security.Cryptography.Aes]::Create()
    try {
        $aes.KeySize = 256
        $aes.Mode = [Security.Cryptography.CipherMode]::CBC
        $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
        $aes.Key = $encryptionKey
        $aes.IV = $iv
        $decryptor = $aes.CreateDecryptor()
        try {
            $plaintext = $decryptor.TransformFinalBlock($ciphertext, 0, $ciphertext.Length)
        }
        finally {
            $decryptor.Dispose()
        }
    }
    finally {
        $aes.Dispose()
    }

    [IO.File]::WriteAllBytes($OutputZip, $plaintext)
    Write-Host "Decrypted key archive written to $OutputZip"
}
finally {
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
}
