# BLACKOUT · Program audit

Done 2026-11-03 before the first mainnet deploy: two passes over the program, the app and the scripts.
This is a self-review backed by on-chain tests, not a professional audit. Keep stakes small.

## Results

| Check | Result |
|---|---|
| `scripts/e2e_money.ts`: every money rule and attack, against a deployed program (devnet `CkSb4kkmhzr8n9awdmrvqhuoWka6nZUXXb8RXnrFBAKU`), incl. a full 8-seat staked night | **29 of 29 pass** |
| `scripts/e2e_daily.ts`: the daily challenge's rules and attacks, on the same program | **14 of 14 pass** |
| `cargo test` (incl. the byte-exact simulation fingerprint over 48 nights, One Light, death cam, bot styles, daily scoring) | 20 passed |
| `scripts/mirror.ts` (Rust vs browser movement) | 2,000 steps identical |
| Crank alone, 7 bots, no client ticks | went live and kept ticking in 2 of 2 rooms (failed at tick 59 before the fix) |
| Rollup vs Solana clock | 0-1 s apart |
| `npx tsc --noEmit`, `vite build` (app) | clean |

## Fixed

| Severity | Finding | Fix |
|---|---|---|
| Critical | **The host could steal the pot.** `end_now` during the countdown ended the night with everyone tied, and ties go to the lowest seat. | `end_now` refused at staked tables. |
| Critical | **The pot could be inflated and the bank drained.** A ticket stayed valid after `leave`, so join/leave repeated added its stake to the pot each time. | Settle pays exactly the tickets it uses up. The shown pot is recounted from seats. |
| High | **Stakes could be stuck forever** after a lost seat race, a vanished host, a failed settle or a dead rollup. | `close_ticket`: anyone can send it, and the money only goes to the ticket's wallet. `scripts/sweep_tickets.ts` refunds everything refundable. |
| High | **Anyone could create a room on their own validator** and write made-up results to the global leaderboard. | Room creation and delegation are admin-only, and only to the TEE validator. |
| High | **Predictable seed at staked tables** after a VRF timeout. | Staked rooms never self-seed. The start is called off and seats and tickets stand. |
| High | **Nights with bots froze at tick 59.** Every bot searched for its first waypoint on the first live tick, which cost 400k-600k compute units. The crank failed there and stopped. | One waypoint search per tick. Bots fight the same (180 vs 183 gun kills over 30 test nights). |
| Medium | **1 lamport sent to a bank blocked `close_room` forever**, because outstanding stakes were read from the balance. | The bank counts outstanding stakes and open tickets. |
| Medium | **Closing a room stranded players' ticket rent**, because closing a ticket needs its bank. | A room can only close once every ticket is closed. |
| Medium | **The app's refund lookup never found anything** (wrong ticket size). | Fixed and covered by the test suite. |
| Medium | `finish` sat right at the default 200k compute limit and sometimes failed. | The app gives `finish` and `reset` 800k (rollup transactions are free). |
| Medium | A vanished host blocked a staked start in the app (the program allowed it). The host leaving unseated every staker. | Any seated staker can start. The others stay seated. |
| Medium | `join` took the payout wallet from its arguments, not the ticket. | Staked seats are paid to the ticket's wallet. |
| Medium | Room, bank and leaderboard rent could never be recovered. Every free night sent a commit to Solana. | `undelegate_room`, `close_room`, `close_board` (admin). Free nights never touch Solana. |
| Low | Dead code and stale comments (`set_length`, `link_wallet`, `board_remove`, `fix_host`, unused constants), input accepted outside a match. | Removed. |

Checked and found safe: a loser calling `reset` right after `finish` can't cancel the payout. Settle reads the room as it was committed at `finish` (tested on-chain). The VRF callback only accepts the program's scoped VRF identity. The undelegation callback only accepts the delegation program's signed buffer.

## Daily challenge

Once a day anyone can roll a VRF seed into a sealed rollup account nobody can read. Every daily night that day is played on it: you in seat 0, three bots, 4 seats, medium bots, solo. The board lives in the rollup (no Solana fees).

| Rule | How it's enforced | Tested |
|---|---|---|
| Nobody sees today's seed | private permission with no members; the daily World stays sealed after the night (only the replay opens); yesterday's seed is published at the next roll | yes |
| One try per wallet per day | the wallet must sign `start_daily` (not the session key); a 4096-bit filter in the board marks it | yes |
| No early or idle "wins" | `end_now` refused; a night that ended because you went idle ranks you last among the survivors | yes |
| A night past midnight | scores only count on the board of the day they were played | unit test |

Known limits: anyone with several wallets gets several tries (a program can't tell people apart). The filter wrongly says "already played" for about 1 in 400 players at 200 players a day. The VRF oracle sees each seed it produces, as with every VRF night. Players can still tell friends what they saw.

## House fee

Settle sends 5% of each paid pot (`FEE_BPS`) to the fixed `TREASURY` wallet and the rest to the winner. Both values are compiled into the program, so changing them takes an upgrade. Refunded tickets pay nothing. If the treasury is too empty to stay rent-exempt, the fee is skipped, so it can't block a payout. The room page shows the fee before anyone stakes.

## How refunds stay safe

A ticket can't be refunded and also ride in a match:

- `finish` derives the seated tickets itself, so a loser can't leave theirs out of settle and reclaim it.
- Settle marks those tickets used. An unused ticket at or below `bank.paid_match` was therefore never in that match.
- A match only starts with 20+ minutes left on every seated ticket, and tickets last an hour.

## Known risks that remain

| Severity | Risk |
|---|---|
| Design | **MagicBlock is trusted.** The TEE validator runs the game and commits the result, so a compromised validator could name any winner. Privacy also depends on the TEE. |
| High (ops) | **One hot key does everything.** `blackout-mainnet.json` is the upgrade authority, the admin and the fee wallet, and it's an unencrypted file. Whoever holds it can upgrade the program and take every stake. Back it up offline, and move it to a hardware wallet or multisig once the game has users. |
| Medium | **Collusion.** Two wallets at one table can team up; a program can't detect this. |
| Medium | **Aimbots.** Clients choose their aim, so a modified client can aim perfectly at players it can already see. |
| Medium | **Paid RPC key in the browser.** `VITE_BASE_RPC` ships in the app bundle. Use a key restricted to the site's domain. |
| Low | 10 npm advisories (2 high), all in third-party Solana/MagicBlock dependencies, none fed untrusted input by our code. |
| Low | Private room codes are readable in the public Room account, so "private" means unlisted. |
| Low | A settle that fails leaves the winner unpaid. Everyone gets refunds instead; nobody loses a stake. |
| Legal | Real-money play may be illegal where players or the operator are. India's Online Gaming Act 2025 bans online money games, and the house fee makes the operator part of it. Get legal advice before enabling stakes. |

## Re-running

```bash
cargo test --manifest-path programs/blackout/Cargo.toml
npx tsx scripts/mirror.ts
npx tsx scripts/e2e_money.ts <unused room id; it uses 3 ids>
```
