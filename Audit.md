# BLACKOUT · Program audit

Done 2026-11-03, again on 2026-11-08 and 2026-11-12 (third pass), and a fourth, pre-mainnet pass on 2026-11-12 (see "Fourth pass"). The results below are from that last run against the upgraded devnet program.
This is a self-review backed by on-chain tests, not a professional audit. Keep stakes small.

## Results

| Check | Result |
|---|---|
| `scripts/e2e_money.ts`: every money rule and attack, against a deployed program (devnet `CkSb4kkmhzr8n9awdmrvqhuoWka6nZUXXb8RXnrFBAKU`), incl. a full 8-seat staked night, the no-host countdown and its rejoin rule, carrying unused tickets over, the daily prize (3.5% of the pot, players beaten, early and wrong claims), the table fund and a real refill | **56 of 56 pass, twice** (2026-11-12) |
| `scripts/e2e_lobby.ts`: free lobbies can't be held (public start after 5 min, private clear after 10, nothing early, fresh clock after) | **12 of 12 pass** |
| `scripts/e2e_stake.ts`: a 2-player staked night started by the 60 s countdown, paid out | winner paid 0.019 of 0.02 (fee 0.001 to the table fund) |
| `cargo test` (incl. the byte-exact simulation fingerprint over 48 nights, money rules, the prize's players-beaten rule, the table fund, lobby limits and clock carry-over, the staked countdown cap, called-off nights and map draw) | 65 passed, plus 2 long ones run on demand |
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

Settle sends 10% of each paid pot (`FEE_BPS`, 5% until 2026-11-13) to the fixed `TREASURY` wallet and the rest to the winner. Both values are compiled into the program, so changing them takes an upgrade. Refunded tickets pay nothing. If the treasury is too empty to stay rent-exempt, the fee is skipped, so it can't block a payout. The room page shows the fee before anyone stakes.

## Second pass (2026-11-08, staked nights)

A full re-read of every path money can take: `buy_ticket`, `join`, `leave`, `kick`, `start_match`, the VRF fallback, `tick` and the end-of-night ranking, `end_now`, `finish`, `settle`, `reset`, `close_ticket`, and the admin close paths. An outside report of the 2026-11-03 issues (host pot steal, join/leave pot inflation, no refunds) was checked against the current code and the live program: all were already fixed, and the deployed devnet program is byte-identical to this build.

| Severity | Finding | Fix |
|---|---|---|
| Medium | **A stalled night could outlive its tickets.** Night length is counted in ticks but tickets expire in wall time. If the rollup stalled for 15+ minutes mid-night, a losing player could refund their ticket before `finish`, and the winner would be paid less. | `tick` calls a staked night off once it is within `SETTLE_MARGIN_SECS` (5 min) of the earliest seated ticket's expiry. Settle then pays nobody and every ticket is refundable immediately. Tests: `void_tests`. |
| Low | **A winnings wallet of all zeros** (the System Program) made the winner's settle fail. Everyone would still be refunded, but only after an hour. | `buy_ticket` refuses an all-zero payout wallet. |
| Medium | **Setup didn't check permission addresses.** `setup_core`, `setup_view`, `setup_rec` and the daily setup skip creating a permission that already exists, but never checked the permission account was the real PDA. Anyone could front-run setup of a new room (or the daily board) with a decoy account, leaving the World, a View or the sealed daily seed with no access rule. Existing devnet rooms are set up correctly (the live Try-to-cheat check shows them denied). | Every setup path requires `permission:` + account under the permission program (`expect_permission`). |
| Low | **Every ticket stranded ~0.00084 SOL** on the in-browser session key (a flat 0.002 SOL was sent for a ticket whose rent is 0.00116). It's lost if the browser's storage is cleared. | The app tops the session key up only to the ticket's rent plus one fee float (rent minimum + 50,000 lamports) and reuses it; verified by simulating the purchase on devnet. A float below the rent minimum is rejected by Solana (`InsufficientFundsForRent`), so a smaller one isn't possible. |
| Low | The deploy workflow ran with the repo's default `GITHUB_TOKEN` permissions. | `permissions: contents: read`. |

Checked and found safe this pass:
- **Refunding a seated ticket.** Possible only after `paid_match` passes it (settle has already run) or after expiry, and expiry can no longer fall inside a night.
- **Faking a ticket in `join`.** It must be owned by the program and carry the `Ticket` discriminator, and only `buy_ticket` makes those. Expired tickets or tickets for another match are refused.
- **A stale staker's seat being taken.** Their ticket is never used, so it is refundable once that match settles.
- **Wrong accounts in `finish`.** It derives the tickets itself and checks the winner against the room, and the board and bank are seed-constrained.
- **Calling `settle` directly or twice.** It needs the room's escrow signature, which only the delegation program can give, and it refuses a match at or below `paid_match`.
- **A night where everyone dies at once.** It has no winner, so it settles with no payout and every ticket is refunded.
- **Winner set to the bank itself.** That only costs the winner their own winnings; other stakes are untouched.
- **Player inputs crashing a tick.** Angles are masked to 16 bits against a 257-entry table, movement is clamped from `i8`, the throw distance is capped, and weapons only change inside the simulation.
- **Committed secrets.** None in the repo, its history or the built site.
- **Unsafe HTML.** The app never renders player text as raw HTML.
- **A stolen session key.** It can't redirect winnings, because payouts go to the wallet named on the ticket.
- **Nobody calling `finish`.** Every open client calls it automatically when it sees an ended room. If none does, tickets expire and are refunded.

Fairness notes (no funds at risk, by design): ties at the 5:00 bell go to the lower seat, and a staked night ends early once every living player has sent no input for 10 s, ranked by health.

## Third pass (2026-11-12, staked tables before mainnet)

Three changes to how staked tables work, each reviewed and tested before mainnet:

- **No host at a staked table.** It starts itself: at once when full, otherwise 60 s after the last new staker sits down (`STAKED_START_WAIT_SECS`), and never more than 3 minutes after the first countdown (`STAKED_MAX_WAIT_SECS`). Only a seat count the lobby hasn't reached before restarts it, so leaving and sitting back down can't hold the table; below two stakers the countdown and its cap start over. During a staked lobby `last_tick_slot` holds the first countdown's time and the most stakers seated (it is cleared when the night begins). Any seated staker may send `start_match`; the program checks the countdown (`staked_start_ok`), so an early start is refused. Seat count, bots, mode and host hand-offs are refused at staked tables: shrinking the table to "full" would otherwise skip the countdown. In a staked lobby the otherwise unused `start_slot` field holds the countdown's end, so the account layout is unchanged.
- **The map is drawn, not picked.** A staked table's map (Yard or Meadow) comes from the night's VRF output in `on_seed`, before spawns are placed. Staked rooms never take the predictable fallback seed, so nobody can steer it.
- **Stakes are never refunded.** `close_ticket` now only closes a spent ticket (its rent back to the payout wallet). An unused ticket carries over instead: `reuse_ticket` closes it and opens a ticket for the next night of any table with the same stake, moving its stake from one bank to the other. Rules: not spent; its own night has settled without it or it has expired; same stake; the destination night hasn't settled. A ticket still waiting in a lobby that hasn't played stays put (it's good for that table's next night as it is), because the base layer can't see the rollup's lobby and an instant move could buy two seats with one stake.

Found while doing this and fixed before it shipped: the settings lock first landed in `leave` instead of the four settings instructions, which would have stopped stakers leaving a staked lobby.

Accepted trade-off: with no refund path, a staked room holding anyone's unused ticket can't be closed, and if the rollup stopped for good, unused tickets would stay locked.

## Fourth pass (2026-11-12, before mainnet)

Every instruction re-read for who may call it, which accounts it trusts and how it moves lamports.

| Severity | Finding | Fix |
|---|---|---|
| High | `refill_table` passed seven accounts to MagicBlock's token program unchecked while the table fund signed. A signature carries into every program it reaches, so a stand-in "delegation program" could have been handed the fund's signature and drained it. | Every account is now derived in the program exactly as MagicBlock derives it (`rent`, `lamports` from fund + room + salt, buffer, delegation record and metadata, the room's delegation record) and the delegation program is pinned; anything else is refused. Re-verified with a real refill on devnet. |
| Medium | The free-lobby time limit could be dodged: leave and claim the room again in one transaction, which emptied the room (clearing its clock) and started a fresh one. | A claim keeps a lobby clock that is still inside its limit (`lobby_clock_on_claim`); an emptied free room no longer clears it. Unit-tested. |
| Medium | A ticket's winnings wallet could be any address, including one that can't take SOL (a program, a sysvar), or a wallet later turned into a program. If that player won, the payout transfer failed and the whole night's payout with it. | `buy_ticket` takes the winnings wallet as an account and requires an ordinary System-owned, non-executable wallet; settle treats a winner whose wallet has since become executable as no winner (the night's tickets carry over) instead of failing. |
| Medium | An expired ticket could be moved to another table right away. If a night's payout was delayed past expiry (a slow commit), a losing player could move their stake out of the bank first and the winner would be paid a smaller pot. | An expired ticket whose night never paid out can only move a day after it expired (`TICKET_RELEASE_GRACE_SECS`); once its night has paid out it moves at once, as before. |
| Info (cost) | The old free daily mode (`roll_daily`, `start_daily`, `on_daily_seed`) was unused since the daily prize replaced it. | Removed: −41.9 KB, about 0.21 SOL less deposit on mainnet. Nothing can set `CFG_DAILY` any more; account layouts and error codes are unchanged. |

Checked and fine: `on_seed` only accepts MagicBlock's VRF oracle (the `#[vrf_callback]` macro adds a `vrf_program_identity` signer pinned to this program's scoped identity); `settle` only runs as the post-commit Magic Action (escrow signer); `buy_ticket` and `reuse_ticket` read the stake from the pinned room PDA; `close_ticket` can only refund the ticket's own payout wallet (`has_one`); `close_room`/`close_board`/`undelegate_room`/`create_room`/`init_*`/`reset_prize` are admin-only and never touch stakes; `claim_prize` only pays `last_winner`; the mainnet build's program id, admin/treasury (`EXu7…`) and TEE validator match the key files. The app renders no raw HTML; `npm audit` shows the same 10 advisories in third-party Solana/MagicBlock packages.

Not fixable by a program, left as known risks below: a script with many free identities can keep re-claiming a private room right after it is cleared (others get a window each time; public rooms stay joinable); collusion and aim assistance (flagged by the fair-play report); MagicBlock is trusted; one hot admin key.

## Rooms can't be held (2026-11-12)

Found in a review of how players could jam the game, fixed the same day:

| Way to jam it | Fix |
|---|---|
| Leave and rejoin a staked lobby to restart its countdown forever | only a new high in seated stakers restarts it, never past 3 min from the first countdown (`STAKED_MAX_WAIT_SECS`) |
| Hold every free room with free guest identities and never start | a free lobby records when it opened (`stake_deadline`, unused by free rooms); after 5 min anyone may start a public one (bots fill the seats), after 10 min anyone may clear a private one (`expire_lobby`). Players' games and any visitor's home page do this |
| Keep a finished room on its replay by leaving the tab open | the room reopens 45 s after the lights come on; the replay stays on the watcher's screen |

Left as is: with exactly two stakers seated, one can still keep leaving and rejoining, which only holds up the other one (who keeps their ticket); a third staker brings the 3-minute cap back.

## Fair-play report (2026-11-12)

Collusion and aim assistance can't be stopped by a program, so they are watched instead. Settle logs a `NightRecord` event for every staked night (room, night, each seat's payout wallet, kills, places, the kill feed, winner). `scripts/fairplay.ts` (`admin.ts fairplay`) reads them back from the transaction history and flags, for a person to review:

- **possible teaming:** two wallets with 5+ nights at the same table (`PAIR_MIN`), no kills on each other, and one winning clearly more often when the other is there (25 points above their rate apart) or the two together winning 60%+ of those nights;
- **possible aim help:** a wallet with 10+ staked nights (`WALLET_MIN`) winning more than half its nights at tables of 4+, or averaging 3+ kills a night.

Flags only: nothing is banned automatically. Accuracy (shots vs hits) isn't recorded, so the aim check works from wins and kills.

## Table fund (2026-11-12)

Each staked table pays MagicBlock ~0.001 SOL per payout from its own wallet inside the rollup (the room account). So tables can't run dry and stop paying winners, settle sets 0.001 SOL of the house fee aside per staked night (`TABLE_FUND_PER_NIGHT`) in a system-owned PDA (`table_fund`). `refill_table` lets anyone move 0.02 SOL (`TABLE_REFILL`) from it into a staked table's rollup wallet through MagicBlock's lamports transfer (Ephemeral SPL Token program, instruction 20), with the fund signing as payer; MagicBlock's program checks every PDA it is given. Seated stakers' games send it when a table is under 0.02 SOL.

| Rule | How | Tested |
|---|---|---|
| The fund's cut can't block a payout | skipped if it alone wouldn't make a new fund rent-exempt; never more than what's left of the fee | unit |
| Fund money only goes to this game's staked tables | the room must be our room PDA and its committed copy must have a stake | e2e |
| A refill only runs when the fund covers it | 0.02 + MagicBlock's ~0.003 transfer cost (5 mSOL margin) + rent | e2e |

Cost: the fee wallet gets 10% − 0.001 SOL a staked night (minus the 3.5% prize at the 0.05 table). Anyone can trigger refills, which only moves the fund's SOL into our tables (recoverable when a table closes).

## Daily prize (2026-11-12)

The daily challenge now funnels players to the 0.05 SOL table. At that table only, 3.5% of each pot (`PRIZE_BPS`, taken out of the 10% fee, never on top of it) goes into a `Prize` account on Solana; the fee wallet keeps the rest (6.5% less the table fund's 0.001). The 0.01 table is unchanged. The prize account is never delegated, so settle's Magic Action writes it directly.

| Rule | How it's enforced | Tested |
|---|---|---|
| Only the 0.05 table feeds it | settle checks `room.stake == PRIZE_STAKE` | e2e |
| The cut never exceeds the fee | `prize_cut = min(pot * 3.5%, fee)`; the winner's share is unchanged | unit + e2e |
| The pot resets every UTC day | every write first calls `roll(today)`, which closes the previous day | unit |
| Winner = most *different* players finished above that day, with 3+ nights; net profit (won − staked) breaks a tie, then the earlier entry | `Prize::record_night` sets one bit per beaten player's entry (`PrizeEntry::beaten`, 128 bits ≥ `PRIZE_SLOTS`), so beating the same wallet again adds nothing; `Prize::leader()` | unit + e2e |
| A prize only ever goes to its winner, once | `claim_prize` pays only a wallet on the owed list, everything it is owed, then clears it; anyone may send it (paying the fee) but the SOL only goes to the winner's own wallet | unit + e2e |
| Today's prize can't be claimed early | a day is only decided when the next day's first write (or a claim) rolls it | e2e |
| An unclaimed prize is never lost | the day's prize goes onto an owed list (32 winners) and waits there with no deadline; winning again adds up; if the list were ever full (32 unpaid winners) the new prize goes to the fee wallet. A pot nobody qualified for also goes to the fee wallet | unit |
| A missing prize account can't block payouts | without it settle takes no cut and the whole fee goes to the fee wallet | code review |

Known limits: the account tracks at most 100 players a day (later players are not recorded that day). Players are counted by their payout wallet, so the rule can still be gamed with many wallets: filling a whole table with your own 8 wallets gives 7 "players beaten" for ~3% of the stakes a night. It pays only on days when honest players have staked more than the cheat costs (roughly 2+ SOL at the 0.05 table); the fair-play report flags the pattern (one wallet killing its whole table). Two wallets farming each other, the cheap case, now scores 1. A prize won on a quiet day is only decided when the next 0.05 night settles or the winner claims.

## How refunds stayed safe (before 2026-11-12; carry-over now uses the same timing rules)

A ticket can't be refunded and also ride in a match:

- `finish` derives the seated tickets itself, so a loser can't leave theirs out of settle and reclaim it.
- Settle marks those tickets used. An unused ticket at or below `bank.paid_match` was therefore never in that match.
- A match only starts with 20+ minutes left on every seated ticket, and tickets last an hour.
- A night is measured in ticks, so a stalled rollup could stretch it. If a staked night is still running within 5 minutes of its earliest ticket expiry, the next tick calls it off: no winner, and every ticket can be refunded in full at once.

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
| Low | A settle that fails leaves the winner unpaid. No stake is lost: it stays in the bank and the night's unused tickets can move to a later night after an hour. The table fund keeps each table's MagicBlock wallet topped up so commits don't run dry. |
| Legal | Real-money play may be illegal where players or the operator are. India's Online Gaming Act 2025 bans online money games, and the house fee makes the operator part of it. Get legal advice before enabling stakes. |

## Re-running

```bash
cargo test --manifest-path programs/blackout/Cargo.toml
npx tsx scripts/mirror.ts
npx tsx scripts/e2e_money.ts <unused room id; it uses 5 ids>
npx tsx scripts/e2e_lobby.ts <free public room> <free private room>   # ~11 minutes
npx tsx scripts/e2e_stake.ts <staked 0.01 table>
```
