#!/bin/bash
# Upgrade the program in place (buffer rent is refunded after the upgrade).
set -e
cd "$(dirname "$0")/.."
if ! anchor build > /tmp/blackout-build.log 2>&1; then grep -E "^error" -A8 /tmp/blackout-build.log | head -40; echo "BUILD FAILED"; exit 1; fi
solana program deploy target/deploy/blackout.so --program-id target/deploy/blackout-keypair.json \
  -k ~/.config/solana/blackout-devnet.json -u https://rpc.magicblock.app/devnet --with-compute-unit-price 1000 2>&1 | tail -2
cp target/idl/blackout.json app/src/idl/
solana balance -k ~/.config/solana/blackout-devnet.json -u devnet
