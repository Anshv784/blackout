# Mainnet runbook

Everything below is ready in the code; these are the steps, in order. Each one that spends SOL is
marked. Nothing here touches the devnet game.

## Before the day

- [ ] Admin wallet `EXu7bp1rbNw9R6UfRLnsJcxyEF4GCvqChcoHMdbHgCmx` funded with ~3.6 SOL
      (`~/.config/solana/blackout-mainnet.json`, backed up offline). Send 0.01 first and confirm it landed.
- [ ] A mainnet RPC key (Helius free tier is enough for ~500 players/day), restricted to playblackout.fun.
- [ ] The Cloudflare API token that was pasted in chat is rotated.
- [ ] A decision on staked tables (real-money rules where you and your players are).

## 1. Program (SPENDS ~3.12 SOL, refundable deposit)

```bash
BASE_RPC=<rpc url> scripts/deploy-mainnet.sh              # dry run: builds, prints size, cost and balance
BASE_RPC=<rpc url> CONFIRM=yes scripts/deploy-mainnet.sh  # deploys pzuVHdCZDQWwxHLEa2JAaEjUZLa43nKaFauLyqZmekb
```

## 2. Boards and rooms (SPENDS ~0.45 SOL, mostly refundable)

```bash
export ADMIN_KEY=~/.config/solana/blackout-mainnet.json VITE_CLUSTER=mainnet VITE_BASE_RPC=<rpc url> \
       VITE_PROGRAM_ID=pzuVHdCZDQWwxHLEa2JAaEjUZLa43nKaFauLyqZmekb
npx tsx scripts/admin.ts board
npx tsx scripts/admin.ts prize                              # daily challenge prize account (~0.04 SOL rent)
npx tsx scripts/admin.ts rooms 1 2 3 4 5 6 7 8 9 10        # 6 public + 4 private
npx tsx scripts/admin.ts room 11 0.01 0 0.05               # staked table, 0.01 SOL
npx tsx scripts/admin.ts room 12 0.05 0 0.05               # staked table, 0.05 SOL
```

The old free daily (you + 3 bots) is gone from the site, so the daily board is no longer delegated
(saves its 0.05 SOL top-up). The daily challenge is now the 0.05 SOL table's prize: 2% of each pot
there goes to the day's top earner (3+ nights), the fee wallet keeps 3%.

Each staked table's 0.05 SOL top-up pays MagicBlock's commit fee (~0.001 SOL per staked night after
the first 25): top it up after ~75 staked nights.

## 3. Rehearsal (SPENDS ~0.02 SOL, comes back)

One free night, then one staked night at the 0.01 table with two of your own wallets. Check on the
explorer: the winner got the pot less 5%, the fee reached the admin wallet, spent tickets returned rent.
Optional: one night at the 0.05 table: the admin wallet gets 3% and the prize account 2%
(`npx tsx scripts/admin.ts prize` prints today's pot).

## 4. Site

Set in GitHub (Settings → Secrets and variables → Actions):

- variable `VITE_CLUSTER` = `mainnet`
- variable `VITE_PROGRAM_ID` = `pzuVHdCZDQWwxHLEa2JAaEjUZLa43nKaFauLyqZmekb`
- secret `VITE_BASE_RPC` = the RPC url

Then push to `main`. Unset them to go back to devnet.

## 5. Right after launch

- [ ] Move the program's upgrade authority to a Squads multisig or a hardware wallet.
- [ ] Watch the RPC dashboard for the first week.
- [ ] List BLACKOUT on MagicQuests (quests.magicblock.app → List your project).
