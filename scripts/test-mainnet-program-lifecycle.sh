#!/usr/bin/env bash

set -euo pipefail

EXPECTED_PAYER="F3jKZokibZiN5SJM5JM4T3a99HVb4zueDTGPR5hbn8tR"
MAINNET_GENESIS="5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
RPC_URL="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}"
PAYER_KEYPAIR="${PAYER_KEYPAIR:-$HOME/.config/solana/taxi-devnet-deployer.json}"
PROGRAM_KEYPAIR="${PROGRAM_KEYPAIR:-$HOME/.config/solana/lifecycle-mainnet-program.json}"
BUFFER_KEYPAIR="${BUFFER_KEYPAIR:-$HOME/.config/solana/lifecycle-mainnet-buffer.json}"
BINARY="${LIFECYCLE_TEST_BINARY:-target/deploy/lifecycle_test.so}"
CONFIRMATION="DEPLOY-INVOKE-CLOSE-MAINNET"
MAX_BINARY_BYTES=25000
MIN_BALANCE_LAMPORTS=250000000

[[ "${1:-}" == "--execute" && "${2:-}" == "$CONFIRMATION" ]] || {
  echo "Usage: $0 --execute $CONFIRMATION" >&2
  exit 1
}

for command in solana solana-keygen stat sha256sum node.exe; do
  command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }
done
[[ -f "$PAYER_KEYPAIR" ]] || { echo "Missing payer keypair" >&2; exit 1; }
[[ -f "$BINARY" ]] || { echo "Missing lifecycle test binary" >&2; exit 1; }
[[ "$(solana-keygen pubkey "$PAYER_KEYPAIR")" == "$EXPECTED_PAYER" ]] || { echo "Payer mismatch" >&2; exit 1; }
[[ "$(solana genesis-hash --url "$RPC_URL")" == "$MAINNET_GENESIS" ]] || { echo "RPC is not mainnet-beta" >&2; exit 1; }

binary_size="$(stat -c %s "$BINARY")"
(( binary_size <= MAX_BINARY_BYTES )) || { echo "Binary exceeds $MAX_BINARY_BYTES bytes" >&2; exit 1; }
balance="$(solana balance "$EXPECTED_PAYER" --url "$RPC_URL" --lamports --commitment finalized | tr -dc '0-9')"
(( balance >= MIN_BALANCE_LAMPORTS )) || { echo "At least $MIN_BALANCE_LAMPORTS lamports required" >&2; exit 1; }

for keypair in "$PROGRAM_KEYPAIR" "$BUFFER_KEYPAIR"; do
  [[ ! -e "$keypair" ]] || { echo "Refusing to overwrite $keypair" >&2; exit 1; }
  solana-keygen new --no-bip39-passphrase --silent --outfile "$keypair"
  chmod 600 "$keypair"
done

program_id="$(solana-keygen pubkey "$PROGRAM_KEYPAIR")"
buffer_id="$(solana-keygen pubkey "$BUFFER_KEYPAIR")"
binary_hash="$(sha256sum "$BINARY" | cut -d' ' -f1)"
echo "PAYER=$EXPECTED_PAYER"
echo "PROGRAM_ID=$program_id"
echo "BUFFER_ID=$buffer_id"
echo "BINARY_SIZE=$binary_size"
echo "BINARY_SHA256=$binary_hash"
echo "BALANCE_BEFORE_LAMPORTS=$balance"

solana program deploy "$BINARY" \
  --url "$RPC_URL" \
  --keypair "$PAYER_KEYPAIR" \
  --fee-payer "$PAYER_KEYPAIR" \
  --program-id "$PROGRAM_KEYPAIR" \
  --buffer "$BUFFER_KEYPAIR" \
  --upgrade-authority "$PAYER_KEYPAIR" \
  --max-len "$binary_size" \
  --commitment finalized \
  --use-rpc

program_output="$(solana program show "$program_id" --url "$RPC_URL" --keypair "$PAYER_KEYPAIR" --commitment finalized)"
grep -Fq "Authority: $EXPECTED_PAYER" <<<"$program_output" || { echo "Upgrade authority mismatch" >&2; exit 1; }
program_data="$(sed -n 's/^ProgramData Address: //p' <<<"$program_output")"
[[ -n "$program_data" ]] || { echo "ProgramData address missing" >&2; exit 1; }

dump_file="$(mktemp)"
trap 'rm -f "$dump_file"' EXIT
solana program dump "$program_id" "$dump_file" --url "$RPC_URL"
[[ "$(sha256sum "$dump_file" | cut -d' ' -f1)" == "$binary_hash" ]] || { echo "Deployed ELF mismatch" >&2; exit 1; }

node.exe scripts/invoke-lifecycle-test.mjs "$program_id" "$RPC_URL" < "$PAYER_KEYPAIR"

solana program close "$program_id" \
  --url "$RPC_URL" \
  --keypair "$PAYER_KEYPAIR" \
  --authority "$PAYER_KEYPAIR" \
  --recipient "$EXPECTED_PAYER" \
  --commitment finalized \
  --bypass-warning

if solana program show "$program_id" --url "$RPC_URL" --keypair "$PAYER_KEYPAIR" --commitment finalized >/dev/null 2>&1; then
  echo "Program still appears active" >&2
  exit 1
fi
if solana account "$program_data" --url "$RPC_URL" --commitment finalized >/dev/null 2>&1; then
  echo "ProgramData still exists" >&2
  exit 1
fi

echo "BALANCE_AFTER_LAMPORTS=$(solana balance "$EXPECTED_PAYER" --url "$RPC_URL" --lamports --commitment finalized | tr -dc '0-9')"
echo "MAINNET_LIFECYCLE_TEST_COMPLETE"
