# Shutting BLACKOUT down on mainnet (and getting the SOL back)

Do the steps **in this order**. Once the program is closed, every account it owns is frozen
forever, so everything is emptied first and the program is closed last.

What comes back to the admin wallet `EXu7…`: the program deposit (~3.24 SOL), each room's rent
and whatever is left of its top-up (~0.01 SOL per free room, more for staked tables), the
leaderboard (~0.023 SOL), and the table fund (moved into the tables first, step 4).
What doesn't: the daily prize account (~0.044 SOL) and the old daily account (~0.016 SOL) have
no close instruction, and transaction fees are spent.

## 0. Set up a terminal

```bash
cd ~/blackout
export RPC=$(cat ~/.config/solana/blackout-mainnet-rpc-cli.txt)
export ADMIN_KEY=~/.config/solana/blackout-mainnet.json VITE_CLUSTER=mainnet VITE_BASE_RPC=$RPC \
       VITE_PROGRAM_ID=pzuVHdCZDQWwxHLEa2JAaEjUZLa43nKaFauLyqZmekb
solana balance EXu7bp1rbNw9R6UfRLnsJcxyEF4GCvqChcoHMdbHgCmx -u $RPC
```

If the program's upgrade authority has been moved to a Squads multisig, step 8 is done as a
Squads proposal instead (Squads app → your multisig → Programs).

## 1. Stop new players

Tell players a few days ahead. Then in GitHub (Settings → Secrets and variables → Actions)
delete the variable `VITE_CLUSTER` and push to `main`: the site goes back to devnet and nobody can
buy a new mainnet ticket.

## 2. Pay every daily prize still owed

```bash
npx tsx scripts/admin.ts prize          # lists "owed: <wallet> <amount>"
npx tsx scripts/admin.ts pay-prize <wallet> <wallet> ...
```

Prizes belong to players: pay them all before anything else. The prize account can't be closed,
so anything left in it stays there for good.

## 3. Let unused tickets play out

A staked table can't be closed while a player still holds an unused ticket for it (stakes are
never refunded, so there's no way to hand it back). Give players time to use them in a last
night, or keep that table open until they have. `admin.ts close` reports which tables refuse.

## 4. Move the table fund into the tables

The table fund can only be spent by topping a table up, so move it in before closing the tables
(it then comes back with them in step 6):

```bash
npx tsx scripts/admin.ts fund           # shows the fund
npx tsx scripts/admin.ts refill 11 12   # repeat while the fund has 0.026 SOL or more
```

## 5. Close spent tickets (their rent goes back to each player)

```bash
npx tsx scripts/sweep_tickets.ts
```

## 6. Close the rooms

```bash
npx tsx scripts/admin.ts close 1 2 3 4 5 6 7 8 9 10 11 12
```

Each one is handed back from MagicBlock and closed; its SOL goes to the admin wallet. A table with
unused tickets refuses (step 3).

## 7. Close the leaderboard

```bash
npx tsx scripts/admin.ts close-board
```

Only after every room is closed: a staked night's payout writes to the leaderboard.

## 8. Close the program (last, and permanent)

```bash
solana program close pzuVHdCZDQWwxHLEa2JAaEjUZLa43nKaFauLyqZmekb --bypass-warning \
  -k ~/.config/solana/blackout-mainnet.json -u $RPC
solana balance EXu7bp1rbNw9R6UfRLnsJcxyEF4GCvqChcoHMdbHgCmx -u $RPC
```

This returns the ~3.24 SOL deposit. It can't be undone: the program id `pzuV…` can never be used
again.
