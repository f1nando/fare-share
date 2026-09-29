#!/usr/bin/env bash

set -euo pipefail

EXPECTED_PROGRAM_ID="9ZLAzKr2taQMXPZjkAFDNfWHrtrCTspR7sXV1E2F6eVv"
EXPECTED_PROGRAMDATA="F7Nn6JS8bwZpL5cYWXs4m2DzZnkh8BAnA78X9gcCUATr"
EXPECTED_DEPLOYER="2uGKLnabWRSpDJaQSBy2fcbYzd8p8BYVzXNMgqzNNtAr"
EXPECTED_BUFFER="5uK9HMPXw7mhr8D5darUMvJnRL9gunQw9p1FWWk6TuoQ"
MAINNET_GENESIS="5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
EXPECTED_PROGRAM_SHA256="0e7a1573d67f09ad148f8c3f19bdc1f5650eea3e203159f3619c23ff164f1eed"
EXPECTED_PROGRAM_BYTES=669552
MIN_BALANCE_LAMPORTS=6830000000

PROGRAM_SO="${PROGRAM_SO:-/home/ivand/taxi-sbf-production-0e7a157/taxi_park.so}"
PROGRAM_KEYPAIR="${PROGRAM_KEYPAIR:-/mnt/c/Users/ivand/Documents/fare-taxi-park-keys/program-keypair.json}"
DEPLOYER_KEYPAIR="${DEPLOYER_KEYPAIR:-/mnt/c/Users/ivand/Documents/fare-taxi-park-keys/admin-keypair.json}"
BUFFER_KEYPAIR="${BUFFER_KEYPAIR:-/home/ivand/.config/solana/taxi-mainnet-production-buffer.json}"
RPC_URL="${SOLANA_RPC_URL:-mainnet-beta}"

for required_file in "$PROGRAM_SO" "$PROGRAM_KEYPAIR" "$DEPLOYER_KEYPAIR"; do
  if [[ ! -f "$required_file" ]]; then
    echo "Missing required file: $required_file" >&2
    exit 1
  fi
done

if [[ "$(solana genesis-hash --url "$RPC_URL")" != "$MAINNET_GENESIS" ]]; then
  echo "RPC is not mainnet-beta; refusing deployment." >&2
  exit 1
fi

program_id="$(solana-keygen pubkey "$PROGRAM_KEYPAIR")"
deployer_id="$(solana-keygen pubkey "$DEPLOYER_KEYPAIR")"
program_sha256="$(sha256sum "$PROGRAM_SO" | cut -d ' ' -f 1)"
program_bytes="$(stat -c '%s' "$PROGRAM_SO")"

if [[ "$program_id" != "$EXPECTED_PROGRAM_ID" ]]; then
  echo "Program key mismatch: expected $EXPECTED_PROGRAM_ID, got $program_id" >&2
  exit 1
fi

if [[ "$deployer_id" != "$EXPECTED_DEPLOYER" ]]; then
  echo "Deployer key mismatch: expected $EXPECTED_DEPLOYER, got $deployer_id" >&2
  exit 1
fi

if [[ "$program_sha256" != "$EXPECTED_PROGRAM_SHA256" ]]; then
  echo "Program binary mismatch: expected $EXPECTED_PROGRAM_SHA256, got $program_sha256" >&2
  exit 1
fi

if [[ "$program_bytes" != "$EXPECTED_PROGRAM_BYTES" ]]; then
  echo "Program size mismatch: expected $EXPECTED_PROGRAM_BYTES bytes, got $program_bytes" >&2
  exit 1
fi

if solana program show "$EXPECTED_PROGRAM_ID" --url "$RPC_URL" --keypair "$DEPLOYER_KEYPAIR" >/dev/null 2>&1; then
  echo "Program $EXPECTED_PROGRAM_ID already exists on mainnet; refusing an accidental upgrade." >&2
  exit 1
fi

balance_lamports="$(solana balance "$EXPECTED_DEPLOYER" --url "$RPC_URL" --lamports | tr -cd '0-9')"
if [[ -z "$balance_lamports" || "$balance_lamports" -lt "$MIN_BALANCE_LAMPORTS" ]]; then
  echo "Deployer needs at least 6 SOL before deployment; current balance is ${balance_lamports:-unknown} lamports." >&2
  exit 1
fi

if [[ ! -f "$BUFFER_KEYPAIR" ]]; then
  mkdir -p "$(dirname "$BUFFER_KEYPAIR")"
  solana-keygen new --no-bip39-passphrase --silent --outfile "$BUFFER_KEYPAIR"
fi
buffer_id="$(solana-keygen pubkey "$BUFFER_KEYPAIR")"
if [[ "$buffer_id" != "$EXPECTED_BUFFER" ]]; then
  echo "Buffer key mismatch: expected $EXPECTED_BUFFER, got $buffer_id" >&2
  exit 1
fi

deployment_complete=false
report_recoverable_buffer() {
  status=$?
  if [[ "$deployment_complete" != true ]] && solana program show "$buffer_id" --url "$RPC_URL" --keypair "$DEPLOYER_KEYPAIR" >/dev/null 2>&1; then
    echo "Deployment did not finish, but the upload rent is recoverable from buffer $buffer_id." >&2
    echo "Resume with the same script or reclaim it with:" >&2
    echo "solana program close $buffer_id --url $RPC_URL --keypair $DEPLOYER_KEYPAIR --authority $DEPLOYER_KEYPAIR --recipient $DEPLOYER_KEYPAIR" >&2
  fi
  exit "$status"
}
trap report_recoverable_buffer EXIT

echo "Deploying $EXPECTED_PROGRAM_ID from $PROGRAM_SO"
solana program deploy "$PROGRAM_SO" \
  --url "$RPC_URL" \
  --program-id "$PROGRAM_KEYPAIR" \
  --keypair "$DEPLOYER_KEYPAIR" \
  --fee-payer "$DEPLOYER_KEYPAIR" \
  --upgrade-authority "$DEPLOYER_KEYPAIR" \
  --buffer "$BUFFER_KEYPAIR" \
  --max-len "$EXPECTED_PROGRAM_BYTES" \
  --commitment finalized \
  --max-sign-attempts 10 \
  --use-rpc

program_output="$(solana program show "$EXPECTED_PROGRAM_ID" \
  --url "$RPC_URL" \
  --keypair "$DEPLOYER_KEYPAIR" \
  --commitment finalized)"
echo "$program_output"
if ! grep -Fq "Authority: $EXPECTED_DEPLOYER" <<<"$program_output"; then
  echo "Deployment finalized with an unexpected upgrade authority; refusing to continue." >&2
  exit 1
fi
if ! grep -Fq "ProgramData Address: $EXPECTED_PROGRAMDATA" <<<"$program_output"; then
  echo "Deployment finalized with an unexpected ProgramData address." >&2
  exit 1
fi

onchain_binary="/home/ivand/taxi-sbf-production-0e7a157/onchain-taxi_park.so"
rm -f "$onchain_binary"
solana program dump "$EXPECTED_PROGRAM_ID" "$onchain_binary" \
  --url "$RPC_URL" --keypair "$DEPLOYER_KEYPAIR"
if [[ "$(stat -c '%s' "$onchain_binary")" != "$EXPECTED_PROGRAM_BYTES" ]] ||
   [[ "$(sha256sum "$onchain_binary" | cut -d ' ' -f 1)" != "$EXPECTED_PROGRAM_SHA256" ]]; then
  echo "On-chain program binary does not match the frozen release." >&2
  exit 1
fi

if solana program show "$buffer_id" --url "$RPC_URL" --keypair "$DEPLOYER_KEYPAIR" >/dev/null 2>&1; then
  solana program close "$buffer_id" \
    --url "$RPC_URL" \
    --keypair "$DEPLOYER_KEYPAIR" \
    --authority "$DEPLOYER_KEYPAIR" \
    --recipient "$DEPLOYER_KEYPAIR" \
    --commitment finalized
fi

deployment_complete=true
trap - EXIT
