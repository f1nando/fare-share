#!/usr/bin/env bash

set -euo pipefail

EXPECTED_PROGRAM_ID="9ZLAzKr2taQMXPZjkAFDNfWHrtrCTspR7sXV1E2F6eVv"
EXPECTED_DEPLOYER="2uGKLnabWRSpDJaQSBy2fcbYzd8p8BYVzXNMgqzNNtAr"
EXPECTED_PROGRAM_SHA256="fd50b5de5cdd703dc961fd43d422b9eba418df8387debc9b25b9206a2deb4d47"
EXPECTED_PROGRAM_BYTES=558456
MIN_BALANCE_LAMPORTS=6000000000

PROGRAM_SO="${PROGRAM_SO:-/mnt/d/codex-taxi-sbf/deploy/taxi_park.so}"
PROGRAM_KEYPAIR="${PROGRAM_KEYPAIR:-/mnt/c/Users/ivan/Documents/fare-taxi-park-keys/program-keypair.json}"
DEPLOYER_KEYPAIR="${DEPLOYER_KEYPAIR:-/mnt/c/Users/ivan/Documents/fare-taxi-park-keys/admin-keypair.json}"
BUFFER_KEYPAIR="${BUFFER_KEYPAIR:-/mnt/c/Users/ivan/Documents/fare-taxi-park-keys/deploy-buffer-keypair.json}"
RPC_URL="${SOLANA_RPC_URL:-mainnet-beta}"

for required_file in "$PROGRAM_SO" "$PROGRAM_KEYPAIR" "$DEPLOYER_KEYPAIR"; do
  if [[ ! -f "$required_file" ]]; then
    echo "Missing required file: $required_file" >&2
    exit 1
  fi
done

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
  --commitment finalized \
  --max-sign-attempts 10

program_output="$(solana program show "$EXPECTED_PROGRAM_ID" \
  --url "$RPC_URL" \
  --keypair "$DEPLOYER_KEYPAIR" \
  --commitment finalized)"
echo "$program_output"
if ! grep -Fq "Authority: $EXPECTED_DEPLOYER" <<<"$program_output"; then
  echo "Deployment finalized with an unexpected upgrade authority; refusing to continue." >&2
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
