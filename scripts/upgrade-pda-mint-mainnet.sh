#!/usr/bin/env bash
# Target-specific upgrade; defaults to a read-only preflight. Never closes ProgramData.
set -euo pipefail
trap 'echo "Upgrade safety gate failed at line $LINENO; stopping without automatic retry." >&2' ERR

PROGRAM=8Z9Mru23DFLJGFsDH7tPAfD289JSC4SABt81rqhrYwxD
PROGRAMDATA=8JHtNnvcKH435F55hD5gv3ZUCBfuzBSoAf4k1NLJLkCY
AUTHORITY=F3jKZokibZiN5SJM5JM4T3a99HVb4zueDTGPR5hbn8tR
BUFFER=9FxHoCC6jTocECMZmRKqKYoZSDzN3yhHPTEVHoAffeVY
GENESIS=5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d
HASH=124147cf9ba9683aad0943c8806e4eae976b6a2b98c4963b4c8803e33ab5f21e
BYTES=881680
CAPACITY=882048
RENT=4481682680
BUFFER_RENT=4479772600
FEE_RESERVE=20000000
CONFIRM="UPGRADE-$PROGRAM-$HASH"

: "${PROGRAM_SO:?explicit frozen binary required}"
: "${AUTHORITY_KEYPAIR:?explicit authority and fee-payer keypair required}"
: "${BUFFER_KEYPAIR:?explicit persistent buffer keypair required}"
: "${RPC_URL_FILE:?explicit RPC file required; never print its contents}"
: "${RELEASE_SHA:?explicit source commit required}"
: "${EVIDENCE_DIR:?external evidence directory required}"
: "${BACKUP_VERIFICATION_FILE:?local backup verification marker required}"
RPC_URL="$(cat "$RPC_URL_FILE")"

for file in "$PROGRAM_SO" "$AUTHORITY_KEYPAIR" "$BUFFER_KEYPAIR" "$BACKUP_VERIFICATION_FILE"; do
  test -f "$file" || { echo 'Required file missing' >&2; exit 1; }
done
test "$(git rev-parse HEAD)" = "$RELEASE_SHA"
# This workspace is checked out by Windows Git with CRLF normalization.
test -z "$(git -c core.autocrlf=true status --porcelain)"
test "$(solana-keygen pubkey "$AUTHORITY_KEYPAIR")" = "$AUTHORITY"
test "$(solana-keygen pubkey "$BUFFER_KEYPAIR")" = "$BUFFER"
test "$(sha256sum "$PROGRAM_SO" | cut -d ' ' -f 1)" = "$HASH"
test "$(stat -c '%s' "$PROGRAM_SO")" = "$BYTES"
test "$(solana genesis-hash --url "$RPC_URL")" = "$GENESIS"
grep -Fq 'AUTHORITY_AND_BUFFER_DPAPI_ROUNDTRIP=PASS' "$BACKUP_VERIFICATION_FILE"

show="$(solana program show "$PROGRAM" --url "$RPC_URL" --keypair "$AUTHORITY_KEYPAIR" --commitment finalized)"
grep -Fq "ProgramData Address: $PROGRAMDATA" <<<"$show"
grep -Fq "Authority: $AUTHORITY" <<<"$show"
grep -Fq "Data Length: $CAPACITY " <<<"$show"
grep -Fq 'Balance: 4.48168268 SOL' <<<"$show"
balance="$(solana balance "$AUTHORITY" --url "$RPC_URL" --lamports --commitment finalized | tr -cd '0-9')"
test "$balance" -ge "$((BUFFER_RENT + FEE_RESERVE))"
buffer_show="$(solana program show "$BUFFER" --url "$RPC_URL" --keypair "$AUTHORITY_KEYPAIR" --commitment finalized 2>&1)" && {
  echo 'Persistent buffer is already open; inspect before resuming an upgrade.' >&2; exit 1;
}
grep -Eq 'AccountNotFound|not found|does not exist|could not find' <<<"$buffer_show"
echo "UPGRADE_PREFLIGHT=PASS; source=$RELEASE_SHA; bytes=$BYTES; authority=$AUTHORITY"
echo "PROGRAMDATA_RENT_PRESERVED=$RENT; TEMPORARY_BUFFER_RENT=$BUFFER_RENT; FEE_RESERVE=$FEE_RESERVE"

if [[ "${1:-}" != --execute ]]; then
  echo "DRY_RUN_ONLY; confirmation=$CONFIRM"
  exit 0
fi
test "${2:-}" = "$CONFIRM"
mkdir -p "$EVIDENCE_DIR"
test ! -e "$EVIDENCE_DIR/before.so"
test ! -e "$EVIDENCE_DIR/after.so"
solana program dump "$PROGRAM" "$EVIDENCE_DIR/before.so" --url "$RPC_URL" --keypair "$AUTHORITY_KEYPAIR" --commitment finalized
printf '%s\n' "$balance" > "$EVIDENCE_DIR/balance-before.lamports"
echo 'Upgrading existing Program ID; automatic account extension is disabled.'
# No --final, no auto-extend, explicit fee payer/authority/buffer; upload fees have no priority premium.
solana program deploy "$PROGRAM_SO" --url "$RPC_URL" --program-id "$PROGRAM" \
  --keypair "$AUTHORITY_KEYPAIR" --fee-payer "$AUTHORITY_KEYPAIR" \
  --upgrade-authority "$AUTHORITY_KEYPAIR" --buffer "$BUFFER_KEYPAIR" \
  --no-auto-extend --with-compute-unit-price 0 --max-sign-attempts 3 \
  --use-rpc --commitment finalized | tee "$EVIDENCE_DIR/deploy.log"

after="$(solana program show "$PROGRAM" --url "$RPC_URL" --keypair "$AUTHORITY_KEYPAIR" --commitment finalized)"
grep -Fq "ProgramData Address: $PROGRAMDATA" <<<"$after"
grep -Fq "Authority: $AUTHORITY" <<<"$after"
grep -Fq "Data Length: $CAPACITY " <<<"$after"
grep -Fq 'Balance: 4.48168268 SOL' <<<"$after"
solana program dump "$PROGRAM" "$EVIDENCE_DIR/after.so" --url "$RPC_URL" --keypair "$AUTHORITY_KEYPAIR" --commitment finalized
test "$(head -c "$BYTES" "$EVIDENCE_DIR/after.so" | sha256sum | cut -d ' ' -f 1)" = "$HASH"
# Solana upgrade returns buffer rent to the upgrade authority. No extra close is attempted here.
remaining="$(solana program show "$BUFFER" --url "$RPC_URL" --keypair "$AUTHORITY_KEYPAIR" --commitment finalized 2>&1)" && {
  echo 'Buffer is still open; recover its rent explicitly, never close the mainnet program.' >&2; exit 1;
}
grep -Eq 'AccountNotFound|not found|does not exist|could not find' <<<"$remaining"
after_balance="$(solana balance "$AUTHORITY" --url "$RPC_URL" --lamports --commitment finalized | tr -cd '0-9')"
fee="$((balance - after_balance))"
test "$fee" -ge 0 && test "$fee" -le "$FEE_RESERVE"
printf '%s\n' "$after_balance" > "$EVIDENCE_DIR/balance-after.lamports"
echo "UPGRADE_VERIFIED=PASS; buffer=closed; total_fee_lamports=$fee; ProgramData_rent=$RENT"
