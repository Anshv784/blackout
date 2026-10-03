# BLACKOUT

**A real-time fog-of-war battle royale where nobody can see you — not the other players, not the RPC, not even the chain.**

Built for MagicBlock Solana Blitz v9. Every position, bullet, loot roll and zone plan lives inside a **MagicBlock Private Ephemeral Rollup** (Intel TDX TEE) in an account with **zero readers**. Each player only ever receives what their own flashlight hits. When the last player falls, the lights come on: the hidden World is flipped public, the full replay unlocks, and a **Magic Action** settles the match on Solana.

- Program (devnet): `VWHcbCSH4kATcuPJgjZ6QC56W3NBQ53U6fxJNtGknh3`
- TEE validator: `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo` (`devnet-tee.magicblock.app`)
- No wallet, no gas, no sign-up: open a room link and you're playing.

## Why this needs MagicBlock

Fog of war is the classic thing a public blockchain cannot do: if state is on-chain, anyone can read where everyone is standing. Dark Forest needed zero-knowledge proofs and was still turn-based. BLACKOUT does it in real time at **20 ticks per second** by combining every piece of the MagicBlock stack in one mechanic:

| MagicBlock feature | What it does in BLACKOUT |
|---|---|
| **Private Ephemeral Rollup** (TEE) | Runs the whole match. The World account has a permission with *no members*, so it is unreadable — even to spectators, the RPC and the room creator. |
| **Ephemeral permissions** | Each seat has a View account whose permission is rewritten on `join` so only that player's session key can read it. Recorder + World flip `private → public` at the end and back on `reset`. |
| **Ephemeral accounts** | World, 8 Views and 5 Recorder chunks are created *inside* the rollup, sponsored by the room PDA (32 lamports/byte), so nothing private ever touches the base layer. |
| **Crank (scheduled tasks)** | `start_match` schedules `tick` every 50 ms inside the TEE. There is no game server anywhere. |
| **VRF** | One VRF request per match seeds spawns, loot contents and every zone centre — derived straight into the sealed World, so even the next circle is secret until announced. |
| **Gasless ER transactions** | Players are in-browser session keys with 0 SOL. Movement/aim/fire are ~15 tx/s per player. |
| **Commit + Magic Action** | `finish` commits the room to Solana with a post-commit action `settle` that updates the global leaderboard and pays staked pots — atomically, no extra user transaction. Commits are paid from the delegated room PDA via `magic_fee_vault`. |
| **Delegation** | Room PDAs are delegated to the TEE validator; the bank, tickets and leaderboard stay on the base layer. |

## How a match works

1. **Join** — `join(seat, name)` (ER, gasless). The seat's View permission becomes `[your session key]`. Lobby presence is a gasless `heartbeat`; abandoned seats are reclaimed automatically.
2. **Start** — the host calls `start_match(fill_to)`: empty seats become on-chain bots, a VRF request is made, and a 20 Hz crank is scheduled.
3. **Seed** — the VRF callback `on_seed` rolls spawns (max-spread), 10 loot crates, and a 3-phase zone plan, all into the sealed World.
4. **Tick** — every 50 ms, inside the TEE: inputs → movement/collision → weapons → bullets → pickups → zone → deaths → placements. Then for each seat it computes **vision** (38° flashlight cone + walls via line-of-sight, a 2-tile "feel" circle, muzzle flashes that give shooters away, flares that reveal everyone) and **sound** (directional pings for footsteps, gunshots, reloads and loot you *can't* see) and writes only that into the seat's private View. Bots use the exact same vision rules — they can't see through walls either.
5. **Lights on** — at the final kill, anyone calls `finish`: World + Recorder become public (the seed becomes verifiable, the 10 Hz replay unlocks), and the room is committed to Solana with the `settle` Magic Action.
6. **Reset** — `reset` re-seals everything for the next match on the same accounts.

No ghosting: dead players' views are emptied, and spectators see nothing until the reveal.

## Accounts

```
Room      [room, id]          delegated PDA, public permission       lobby, names, kill feed, zone circle
World     [world, id]         ephemeral, permission with 0 members   positions, bullets, loot, VRF seed, zone plan, bot brains
View[i]   [view, id, i]       ephemeral, readable by seat i only     what seat i may know this tick (968 bytes)
Rec[c]    [rec, id, c] x5     ephemeral, sealed → public             10 Hz flight recorder (1,595 frames)
Bank      [bank, id]          base layer                             staked pot escrow
Ticket    [ticket, id, m, k]  base layer                             proof a seat paid the stake
Board     [board]             base layer                             global leaderboard, updated by the Magic Action
```

## Verified on devnet

`scripts/e2e.ts` plays full matches against the live TEE and checks, end to end:

- player A can read its own View but not player B's; a spectator cannot read the World
- VRF seeds the match (~0.2 s), the crank ticks at **20.0 ticks/s**, Views stream over the TEE websocket every tick
- after `finish`, the World and Recorder become readable by anyone, the seed and zone plan are verifiable
- the room is committed to Solana and the `settle` Magic Action updates the leaderboard
- `reset` re-seals the World

The simulation is deterministic integer math (`programs/blackout/src/sim.rs`) mirrored bit-for-bit in TypeScript (`app/src/game/sim.ts`) for client-side prediction; `cargo test` plays 40 full 8-bot matches to check every one ends with valid placements.

## Run it

```bash
# program
anchor build && ./scripts/deploy.sh
npx tsx scripts/admin.ts board
npx tsx scripts/admin.ts rooms 1 2 3 4 10 11 12 13

# end-to-end check against the live TEE
npx tsx scripts/e2e.ts 1

# frontend
cd app && npm i && npm run dev
```

## Stack

Anchor 1.0 · ephemeral-rollups-sdk 0.17 (access-control, crank, vrf) · React + Three.js (react-three-fiber) with real-time shadows from your flashlight · synthesized positional audio · twin-stick touch controls.
