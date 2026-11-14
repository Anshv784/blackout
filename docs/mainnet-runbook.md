# Mainnet runbook

**Launched 14 Nov 2026.** Program `pzuVHdCZDQWwxHLEa2JAaEjUZLa43nKaFauLyqZmekb` deployed (645,544 bytes,
byte-equal to the build), board, prize, public rooms 1-6, private rooms 7-9 and staked tables 11 (0.01)
and 12 (0.05) created; the site switched with the GitHub variables. Room 10 created and the staked rehearsal passed
(`scripts/rehearse_mainnet.ts`: winner +0.018, admin +0.001 after table fuel, tickets closed, all swept
back). Left: section 5. A script with no browser must drive ticks itself if MagicBlock's crank stalls
(players' browsers do this already): each tick needs a different compute limit or it's dropped as a duplicate.
The first deploy stopped at "Max retries exceeded" on the free RPC; resuming into the same buffer
with `--buffer <recovered key> --max-sign-attempts 100` finished it.

Everything below is ready in the code; these are the steps, in order. Each one that spends SOL is
marked. Nothing here touches the devnet game.

## Before the day

- [ ] Admin wallet `EXu7bp1rbNw9R6UfRLnsJcxyEF4GCvqChcoHMdbHgCmx` funded with ~3.7 SOL (measured 2026-11-12 after the pre-mainnet audit: ~3.55 needed + margin)
      (`~/.config/solana/blackout-mainnet.json`, backed up offline). Send 0.01 first and confirm it landed.
- [ ] A mainnet RPC key (Helius free tier is enough for ~500 players/day), restricted to playblackout.fun.
- [ ] The Cloudflare API token that was pasted in chat is rotated.
- [ ] A decision on staked tables (real-money rules where you and your players are).

Local commands use the CLI key (no domain lock; never put it in the site):
`export BASE_RPC=$(cat ~/.config/solana/blackout-mainnet-rpc-cli.txt)` and, for the TypeScript
scripts, `VITE_BASE_RPC=$BASE_RPC`. The site's key (`VITE_BASE_RPC` secret in GitHub) only works from
playblackout.fun, www.playblackout.fun and blackout.anshverma.tech.

## 1. Program (SPENDS ~3.22 SOL, refundable deposit; 634 KB at mainnet rent of 5,080 lamports/byte)

```bash
scripts/deploy-mainnet.sh              # dry run: builds, prints size, cost and balance
CONFIRM=yes scripts/deploy-mainnet.sh  # deploys pzuVHdCZDQWwxHLEa2JAaEjUZLa43nKaFauLyqZmekb
```

## 2. Boards, prize and rooms (SPENDS ~0.32 SOL, mostly refundable)

```bash
export ADMIN_KEY=~/.config/solana/blackout-mainnet.json VITE_CLUSTER=mainnet VITE_BASE_RPC=$BASE_RPC \
       VITE_PROGRAM_ID=pzuVHdCZDQWwxHLEa2JAaEjUZLa43nKaFauLyqZmekb
npx tsx scripts/admin.ts board
npx tsx scripts/admin.ts prize                              # daily challenge prize account (~0.03 SOL rent)
npx tsx scripts/admin.ts rooms 1 2 3 4 5 6 7 8 9 10        # 6 public + 4 private
npx tsx scripts/admin.ts room 11 0.01 0 0.05               # staked table, 0.01 SOL
npx tsx scripts/admin.ts room 12 0.05 0 0.05               # staked table, 0.05 SOL
```

The old free daily (you + 3 bots) is gone from the site, so the daily board is no longer delegated
(saves its 0.05 SOL top-up). The daily challenge is now the 0.05 SOL table's prize: 3.5% of each pot
there goes to the day's top earner (3+ nights), the fee wallet keeps 3%.

Each staked table's 0.05 SOL top-up pays MagicBlock's commit fee (~0.001 SOL per staked night after
the first 25). It refills itself: every staked night puts 0.001 SOL of the fee into the table fund,
and players' games move 0.02 SOL from it into a table that runs low. Check with
`npx tsx scripts/admin.ts fund`; `admin.ts refill 11` does it by hand.

## 3. Rehearsal (SPENDS ~0.02 SOL, comes back)

One free night, then one staked night at the 0.01 table with two of your own wallets. Check on the
explorer: the winner got the pot less 10%, the fee reached the admin wallet, spent tickets returned rent.
Optional: one night at the 0.05 table: the admin wallet gets 6.5% less 0.001 and the prize account 3.5%
(`npx tsx scripts/admin.ts prize` prints today's pot).

## 4. Site

Set in GitHub (Settings → Secrets and variables → Actions):

- variable `VITE_CLUSTER` = `mainnet`
- variable `VITE_PROGRAM_ID` = `pzuVHdCZDQWwxHLEa2JAaEjUZLa43nKaFauLyqZmekb`
- secret `VITE_BASE_RPC` = the RPC url (already stored 2026-11-13; it only reaches a build once `VITE_CLUSTER` is `mainnet`)

Then push to `main`. Unset them to go back to devnet.

## 5. Right after launch

- [ ] Move the program's upgrade authority to a Squads multisig or a hardware wallet.
- [ ] Watch the RPC dashboard for the first week.
- [ ] List BLACKOUT on MagicQuests (quests.magicblock.app → List your project).
- [ ] Once a week: `npx tsx scripts/admin.ts fairplay` (with the mainnet env above) for wallets worth a look
      (possible teaming or aim help). Flags, not proof; holding a daily prize is your call.
