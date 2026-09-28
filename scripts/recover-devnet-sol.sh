#!/usr/bin/env bash

set -euo pipefail

PROGRAM_ID="H7X7Ky8q6mvEdeDLikx6fPGAyjjHywR74W53DyXZJrsY"
PROGRAM_DATA="3dUwFwcqrq15iqQJdW5hsAs4HRtpEu4YrysvA9iV8DSH"
DEPLOYER="2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF"
WORKER="J38s2zZLszLssXu6CAencaqwrZ6wvE3hmoc4jWy2piJu"
DEVNET_GENESIS="EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
DEPLOYER_KEYPAIR="${DEPLOYER_KEYPAIR:-/home/ivand/.config/solana/taxi-devnet-deployer.json}"
WORKER_KEYPAIR="${WORKER_KEYPAIR:-/home/ivand/.config/solana/taxi-devnet-claimmany-worker.json}"
RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
CONFIRMATION="CLOSE-$PROGRAM_ID"

for command in solana solana-keygen node; do
  command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }
done
for keypair in "$DEPLOYER_KEYPAIR" "$WORKER_KEYPAIR"; do
  [[ -f "$keypair" ]] || { echo "Missing keypair: $keypair" >&2; exit 1; }
done

[[ "$(solana-keygen pubkey "$DEPLOYER_KEYPAIR")" == "$DEPLOYER" ]] || { echo "Deployer key mismatch" >&2; exit 1; }
[[ "$(solana-keygen pubkey "$WORKER_KEYPAIR")" == "$WORKER" ]] || { echo "Worker key mismatch" >&2; exit 1; }
[[ "$(solana genesis-hash --url "$RPC_URL")" == "$DEVNET_GENESIS" ]] || { echo "RPC is not Solana Devnet" >&2; exit 1; }

program_output="$(solana program show "$PROGRAM_ID" --url "$RPC_URL" --keypair "$DEPLOYER_KEYPAIR" --commitment finalized)"
grep -Fq "ProgramData Address: $PROGRAM_DATA" <<<"$program_output" || { echo "ProgramData mismatch" >&2; exit 1; }
grep -Fq "Authority: $DEPLOYER" <<<"$program_output" || { echo "Upgrade authority mismatch" >&2; exit 1; }

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
SOLANA_RPC_URL="$RPC_URL" node scripts/audit-devnet-recovery.mjs

if [[ "${1:-}" != "--execute" ]]; then
  echo
  echo "DRY_RUN_ONLY: no funds moved and the program remains active."
  echo "Permanent recovery requires: bash scripts/recover-devnet-sol.sh --execute '$CONFIRMATION'"
  exit 0
fi

[[ "${2:-}" == "$CONFIRMATION" ]] || {
  echo "Exact confirmation required: $CONFIRMATION" >&2
  exit 1
}

# Never destroy the only program able to rescue protocol funds.
SOLANA_RPC_URL="$RPC_URL" node scripts/audit-devnet-recovery.mjs --require-empty-vaults

solana transfer "$DEPLOYER" ALL \
  --url "$RPC_URL" \
  --from "$WORKER_KEYPAIR" \
  --fee-payer "$DEPLOYER_KEYPAIR" \
  --allow-unfunded-recipient \
  --commitment finalized

solana program close "$PROGRAM_ID" \
  --url "$RPC_URL" \
  --keypair "$DEPLOYER_KEYPAIR" \
  --authority "$DEPLOYER_KEYPAIR" \
  --recipient "$DEPLOYER" \
  --commitment finalized \
  --bypass-warning

echo "DEPLOYER_BALANCE=$(solana balance "$DEPLOYER" --url "$RPC_URL" --commitment finalized)"
echo "DEVNET_RECOVERY_COMPLETE"
