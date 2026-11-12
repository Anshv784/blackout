# How BLACKOUT was built with AI

BLACKOUT was built by one developer (Ansh Verma) working with **Claude Code**, Anthropic's coding agent, running **Claude Opus**. This document covers the whole project, from the first commit on **3 Oct 2026** to the current build. It explains what the AI did, what the human did, how the work was checked, and where the AI got things wrong.

Everything here can be checked against the git history: 168 commits over 13 working days. The project has about **5,400 lines of Rust** (the on-chain program and its deterministic simulation) and about **18,200 lines of TypeScript/TSX** (the 3D client, UI and scripts).

---

## At a glance

| | |
|---|---|
| Coding agent | Claude Code (Claude Opus), run in the terminal against this repo |
| What the AI wrote | Nearly all of the code: the Anchor program, the simulation, the 3D client, UI, scripts, tests, the asset pipeline and the docs |
| What the human did | Product direction, design calls, every playtest, bug reports with screenshots, asset sourcing through their own accounts, and approval of every deploy and every action that spends money |
| How the work was checked | Rust unit tests, a golden fingerprint test, on-chain end-to-end suites, a Rust ↔ TypeScript mirror check, Playwright screenshot grids, and human playtests |
| Other AI-adjacent tools | Mixamo (auto-rigging and motion capture), FBX2glTF, gltf-transform with meshopt, and Playwright for automated visual QA |

---

## How the work was split

**The human (Ansh)**
- Came up with the game: a real-time battle royale where fog of war is enforced by a private rollup, not by the client.
- Made every product and design call: the room size, the 5% house fee, the maps, the feel of the guns, which operators and emotes to keep, and what "looks bad" means.
- Played every build in a real browser on laptop and phone, and reported bugs with screenshots and short notes ("gun holding is sooo bad", "fingers are bent", "the daily challenge position is not good").
- Downloaded characters and animations from Mixamo with their own Adobe account, and chose the CC-BY gun models.
- Approved every deploy, every devnet/mainnet transaction and every public push.

**The AI (Claude Code)**
- Designed the architecture and wrote the code: the program, the simulation, the client, the UI, and the scripts.
- Read MagicBlock's SDKs and docs to wire up Private Ephemeral Rollups, permissions, VRF, the crank and Magic Actions.
- Wrote and ran the tests, including the end-to-end suites against devnet.
- Built the asset pipeline (FBX → GLB, retargeting, compression, rigging guns to hands).
- Diagnosed bugs from the human's screenshots and from its own screenshots, fixed them, and re-verified.
- Audited its own program for money bugs before the mainnet work.
- Wrote the README, the audit notes, the in-game How page, the credits and this file.

The loop was always the same: **human sets direction → AI builds → AI verifies with tests and screenshots → human plays → human reports → AI fixes.**

---

## Timeline

### Phase 1: core game (3–6 Oct)
About 60 commits in four days.

- **On-chain game loop.** An Anchor program whose world state is delegated into a MagicBlock **Private Ephemeral Rollup** (an Intel TDX enclave). Per-account **ephemeral permissions** decide who may read what, so each player only receives what their own flashlight hits.
- **Deterministic simulation.** The full game step (movement, collision, line of sight, shooting, damage) is written in Rust for the chain and mirrored in TypeScript for client prediction and replay verification. The AI kept the two identical with integer and fixed-point maths and no floats in the on-chain path.
- **Staked rooms.** Entry stakes held in a vault, paid out to the winner, with the seed re-derived and checked so the house can't rig a night.
- **3D client.** React-three-fiber scene, a third-person camera, controls, the flashlight cone as the only light, and IK soldiers.
- **Content.** The 48×48 map, supply drops, gadgets, duos with revive, VRF-driven night modifiers, bots, private rooms with codes, the leaderboard, guest mode with no wallet, a horror soundscape, a story intro, the living 3D gate and lobby, phone controls and a trailer.

### Phase 2: polish and robustness (8–17 Oct)
- **Audio.** Recorded sound effects (CC0 and public domain, credited) through a limiter.
- **Performance.** Tuned for phones; automatic graphics tiers; shader precompiling so the first shot doesn't stutter.
- **Network.** A lag chip showing real network delay; sequence numbers on inputs so out-of-order packets can't replay moves.
- **Crank fallback clock.** When MagicBlock's crank stopped ticking, the host's browser keeps the night running at 20 ticks a second. Before this fix it dropped to about 1 tick a second, which was the "big lag" bug.
- **Death box and loot; trackpad aim.**
- **Audit.md**, a written security review of the program.
- **Playwright playtest scripts** that drive full games headlessly (`scripts/ui/*`).

### Phase 3: feel (21 Oct)
- Set dressing for the Yard, plus gun handling: per-gun recoil, muzzle flash at the barrel, and client-side move replay so you never snap back.

### Phase 4: mainnet hardening (3 Nov)
- **Self-audit of the money paths** ([`Audit.md`](Audit.md)). The AI went back through its own program looking for ways to lose funds or cheat, and fixed every finding. The main ones:
  - **Critical: the host could steal the pot.** Ending a night during the countdown made everyone tie, and ties go to the lowest seat. Now refused at staked tables.
  - **Critical: the pot could be inflated.** A ticket stayed valid after `leave`, so join/leave repeatedly added its stake again. Settle now pays exactly the tickets it uses up.
  - **High: stakes could be stuck forever** after a lost seat race, a vanished host or a dead rollup. Now anyone can send `close_ticket`, which only ever pays the ticket's own wallet.
  - **High: fake leaderboard results** from rooms on a rogue validator. Room creation and delegation are now admin-only, and only to the TEE validator.
  - **High: bot nights froze at tick 59** because every bot pathfound on the same tick and blew the compute budget. Now there's one waypoint search per tick.
- **Carry-over tickets** for rooms that never fill (an unused stake moves to a later night, never lost), and a **5% house fee**.
- **Deploy cost.** A smaller program size, so deploying costs less.
- **Gameplay.** A daily challenge, "One Light" nights, a death cam, and bot personalities.

### Phase 5: content and characters (4 Nov)
About 40 commits in one day.

- **Meadow**, a second map with tall grass, plus crates, airdrops and aimed throws with a trajectory preview.
- **Weapons.** Eight guns with original names. A **ghillie suit**, a **prone** stance and **emotes**, all carried through the on-chain input bits and the simulation.
- **Operators.** Six Mixamo characters, the **Operator** page, and a **Gunsmith** with seven weapon finishes. Each player's look is packed into three spare bytes of their name, so it needs no extra accounts.
- **Real gun models.** CC-BY models from Sketchfab, each fitted per weapon slot (length, rear offset, flip, roll, grip point, fore-grip point).
- **Animations.** 35 recorded animation clips in one shared bundle.
- **Lobby and controls.** A lobby redesign, a controls card, an emote wheel, and the launch trailer.

---

## What the AI did, by area

### Solana program (Rust, Anchor 1.1)
- Accounts, instructions and permission rules for the private rollup.
- VRF for the seed, the crank for ticks, and Magic Actions to settle the night on Solana when the last player falls.
- Built with `cargo build-sbf` plus `anchor idl build`. Plain `anchor build` didn't work with this toolchain, and the AI found and documented the workaround.

### Deterministic simulation
- `programs/blackout/src/sim/*.rs` is the source of truth. `app/src/game/sim.ts` and `scripts/verify.ts` mirror it.
- `scripts/mirror.ts` runs both versions side by side and compares state every step.

### 3D client and UI
- React-three-fiber scenes for the game, the lobby, the menu hero, the operator stage and the gun stage.
- Every screen of the HUD and menus: the emote wheel, the key guide, touch controls, settings and the room pages.

### Asset pipeline
- Converted Mixamo FBX files to GLB with FBX2glTF, compressed them with gltf-transform, meshopt and sharp, and bundled the 35 clips into one shared `anims.glb`.
- Fixed per-clip problems automatically, for example clips exported at 0.1 scale were rescaled at bundle time.
- **Gun holding.** The gun is socketed along the line between the two recorded hands, rather than parented to one bone. Finger curl is measured from the palm, and the support hand slides along the fore-grip. This took several rounds of human feedback to get right (see below).

### Security
- The money-path audit described in Phase 4.
- Input sequencing, so packets can't be replayed.
- A "Try to cheat" button on the How page that asks the TEE for a real room's sealed accounts and shows the denial live.

### Ops
- Deploy scripts for devnet and mainnet (`scripts/deploy.sh`, `scripts/deploy-mainnet.sh`) and admin and cleanup tools (`admin.ts`, `kick.ts`, `sweep_tickets.ts`).
- Vercel production deploys. When the Git webhook missed a push, the AI deployed manually and confirmed by checking that the live bundle hash had changed.

---

## How the work was verified

The AI didn't count anything as done because it compiled. Each kind of change had its own check.

| Check | What it proves | Result |
|---|---|---|
| Rust unit tests (`cargo test`) | Sim rules, maps, weapons, throws, stances, encoding | 35 tests, plus 2 long ones run on demand |
| Golden fingerprint | A fixed replay produces exactly the same final state hash after any refactor | Must match bit for bit |
| `scripts/mirror.ts` | The TypeScript sim matches the Rust sim | 2,000 movement steps identical; 72/72 throw cases |
| `scripts/e2e_money.ts` | Stakes, payouts, refunds and fees on devnet, including the attack cases from the audit | 29/29 |
| `scripts/e2e_daily.ts` | The daily challenge on devnet | 14/14 |
| `scripts/e2e.ts`, `e2e_stake.ts` | Full room lifecycle on devnet | Pass |
| Playwright grids (`scripts/ui/*`) | Every operator × gun × action rendered to a contact sheet the AI inspected, plus phone, landscape and guest flows | Reviewed each round |
| Human playtests | How it feels | Every build |

The screenshot grids were how the AI "saw" its own animation work. It rendered every combination, looked at the images, and fixed what was wrong before handing a build to the human.

---

## Iteration examples

The real record shows what working with an AI agent looks like, including the misses.

**Fingers bent backwards.** The human sent a screenshot of the hands wrapped the wrong way around the grip. The AI traced it to the sign of the finger-curl axis on the Mixamo rig, flipped it, measured the curl from the palm instead, and re-rendered the grid to confirm.

**Animations at a tenth of their size.** Some Mixamo clips came out with the hips at 0.1 scale, so soldiers shrank mid-animation. The AI found the per-clip scale in the FBX export and normalised it in the bundling step, so no clip can ship broken again.

**Floating gun after emotes.** After an emote ended, the gun reappeared floating near the chest for a few frames. The AI changed it to stay hidden until the emote's blend weight drops below 0.04.

**B opened two things.** The emote key also opened the settings menu. The AI added a wheel-open lock in the input layer and made the game recapture the mouse after a pick.

**A change that made things worse.** One attempt at hand IK for the clap emote and at sliding the stock along the shoulder was judged worse by the human ("you messed it more"). The AI reverted it in the next commit and redeployed rather than piling more fixes on top. The clap still needs a better source clip, and that is listed as open below.

**Crank stalls.** Players reported heavy lag. The AI found that when MagicBlock's crank stopped ticking, the night fell back to about 1 tick a second. It added a host-browser fallback clock that keeps 20 ticks a second.

---

## What the human decided

Plenty here wasn't the AI's call:
- The game concept, the name and the tone (a horror-tinged night, with the light as your only weapon and your only weakness).
- Room size, the stake model and the 5% fee.
- Which guns, operators, emotes and maps made the cut.
- When a build was good enough, and when it wasn't.
- Every deploy and every transaction.

---

## About the git history

Every commit in this repo was written by Claude Code and committed under the developer's account. Until this point the commits carried no AI attribution line, because that was the developer's choice at the time.

The commit that added this section is co-authored by Claude on purpose, as a marker that the project is AI-built. A co-author line is only a label, and anyone can add one. The real evidence is everything else in this file: the timeline matches the commit history day by day, the tests can be re-run, and the Claude Code session logs that produced each commit still exist and can be shown on request.

---

## Known limits and open items

- The **clap** emote needs a better source clip, or should be replaced.
- On bulky operators the **stock can clip into the chest** in some poses.
- The **LANCE** marksman rifle still uses the code-built model rather than a real one.
- **Mixamo** assets are used under Adobe's terms for use inside a game. The raw FBX sources are not meant to be redistributed.

---

## Credits for third-party assets

- **Characters and animations:** Adobe Mixamo.
- **Gun models:** CC-BY models from Sketchfab, credited per model in [`app/public/models/guns/CREDITS.md`](app/public/models/guns/CREDITS.md) and on the in-game How page.
- **Sound:** CC0 and public-domain recordings, credited in [`app/public/sfx/CREDITS.txt`](app/public/sfx/CREDITS.txt).
- **Rollup infrastructure:** MagicBlock (Private Ephemeral Rollups, VRF, crank, Magic Actions).
