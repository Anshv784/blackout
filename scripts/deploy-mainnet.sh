#!/bin/bash
# First mainnet deploy. Costs ~3.22 SOL (634 KB program), nearly all of it refundable rent: the
# temporary upload buffer is drained back to the payer before the program account is paid for,
# so the wallet never needs twice that.
#   BASE_RPC=<paid mainnet rpc> CONFIRM=yes scripts/deploy-mainnet.sh
# Without CONFIRM=yes it builds, prints the cost and stops.
# To get the rent back one day (kills this program id for good):
#   solana program close <PROGRAM_ID> --bypass-warning -k ~/.config/solana/blackout-mainnet.json -u $BASE_RPC
set -euo pipefail
cd "$(dirname "$0")/.."
KEY=~/.config/solana/blackout-mainnet.json
PROGRAM=~/.config/solana/blackout-mainnet-program.json
OUT=target/mainnet
: "${BASE_RPC:?set BASE_RPC to a mainnet RPC url}"
GENESIS=$(solana genesis-hash -u "$BASE_RPC")
[ "$GENESIS" = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" ] || { echo "BASE_RPC is not mainnet"; exit 1; }
cargo build-sbf --manifest-path programs/blackout/Cargo.toml --sbf-out-dir "$OUT" --features mainnet >/dev/null
SIZE=$(stat -f%z "$OUT/blackout.so")
echo "program:  $(solana address -k "$PROGRAM")"
echo "admin:    $(solana address -k "$KEY")  balance $(solana balance -k "$KEY" -u "$BASE_RPC")"
echo "size:     $SIZE bytes, rent $(solana rent "$SIZE" -u "$BASE_RPC" | grep -i exempt)"
[ "${CONFIRM:-}" = "yes" ] || { echo "Dry run. CONFIRM=yes to deploy."; exit 0; }
solana program deploy "$OUT/blackout.so" --program-id "$PROGRAM" --upgrade-authority "$KEY" \
  -k "$KEY" -u "$BASE_RPC" --max-len "$SIZE" --with-compute-unit-price 1000 --use-rpc
solana program show "$(solana address -k "$PROGRAM")" -u "$BASE_RPC"
