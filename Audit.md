# BLACKOUT · Project audit

A short, plain audit of the program, the client and the deployment, done on 2026-10-11 against `main`.
It lists what was checked, what passed, and what is still a known risk. Nothing here is hidden from judges.

## 1. Checks that were run

| Check | Command | Result |
|---|---|---|
| Program unit tests | `cargo test` (programs/blackout) | ✅ 10 passed, 0 failed |
| Program build warnings | `cargo build` | ✅ 0 warnings |
| Client type check | `npx tsc --noEmit` (app) | ✅ clean |
| Rust ↔ TypeScript movement mirror | `npx tsx scripts/mirror.ts` | ✅ 2,000 steps identical |
| Secrets in git | search for keypairs, `.env`, raw secret-key arrays | ✅ none tracked (`*keypair*.json`, `.env*` are gitignored) |
| Browser console | `scripts/ui/console_audit.ts` | ✅ no app errors (only headless GPU notices) |
| Dependency advisories | `npm audit --omit=dev` (app) | ⚠️ 10 (2 high, 6 moderate, 2 low), all in third-party libraries, see §4 |
| Movement under a slow network | headless test: walk a square with 200 ms latency, 1 Mbps | ✅ 0 position snaps (was 2 before the latest fix) |

## 2. What the program protects, and how

| Risk | Protection | Where |
|---|---|---|
| Reading other players' positions | World has a permission with **no members**; each View has exactly **one** member (that seat's key). The TEE refuses other reads. | `setup_core`, `join`, `set_sealed` in `lib.rs` |
| Paying yourself the pot | `settle` only accepts a call signed by the Magic Action's escrow PDA, which only the delegation program can sign. Each match can be paid once (`bank.paid_match`). | `settle` in `lib.rs` |
| Paying the wrong winner | `finish` requires the `winner` account to equal the winner's recorded payout address. | `finish` in `lib.rs` |
| Sending inputs for someone else | `input` looks up the seat from the signer's key; no seat → rejected. | `input` in `lib.rs` |
| Speeding up the game by spamming `tick` | `tick` is slot-gated (`MIN_TICK_SLOTS`), so extra calls are ignored. | `tick` in `lib.rs` |
| Rigging the map | Spawns, loot and zones come from a MagicBlock VRF seed; the VERIFY tab re-derives the night from it after lights-on. | `start_match`, `on_seed`, `app/src/game/verify.ts` |
| Joining a staked table without paying | `join` checks a ticket account owned by the program, for this room, this match and this player. | `join` in `lib.rs` |
| Host abuse | Only the host can change seats, bot level, mode, kick, or end the night early. | `set_*`, `kick`, `end_now` |
| Rooms stuck forever | A night with no living human sending input for 200 ticks (10 s) ends itself. | `sim.rs` end-of-match check |

## 3. Known risks and limits (honest list)

| # | Severity | Finding | Notes / suggestion |
|---|---|---|---|
| 1 | Design | **Privacy depends on the TEE.** The program cannot prove privacy by itself; it relies on MagicBlock's Intel TDX validator enforcing permissions. | Stated in the README limits. Inherent to the approach. |
| 2 | Medium | **`input` doesn't reject older inputs.** An input transaction that arrives late can overwrite a newer one for one tick. | Add `require!(seq > p.in_seq)` in `input`. Low impact in practice (inputs are sent ~20/s). |
| 3 | Medium | **VRF fallback seed is weaker.** If the oracle doesn't answer in time, a seated player can seed from rollup state (`fallback_seed`). It is not VRF-grade. | The room is flagged and the UI says so. Could be limited to non-staked rooms. |
| 4 | Medium | **Client-chosen aim.** The program trusts the aim angle each client sends, so a modified client could aim perfectly at players it can already see (an aimbot). It still cannot see hidden players. | Inherent to client-side aiming; vision limits the damage. |
| 5 | Low | **Session key stored in browser localStorage, unencrypted.** It holds 0 SOL and can only play, and the wallet is separate. | Acceptable for a guest key. |
| 6 | Fixed | **Debug handles on `window`** (`__session`, `__controls`, `__store`, `__gl`, `__scene`) were exposed for testing. | Now only set on the dev server (`import.meta.env.DEV`); absent from the live build. |
| 7 | Low | **Dependency advisories** (§4) are in libraries pulled in by Solana/MagicBlock packages, not in our code. | Re-check on each dependency upgrade; don't run `npm audit fix --force` blindly (breaking changes). |
| 8 | Info | **Leaderboard data on devnet** comes from staked nights played by six devnet test wallets to exercise ticket → play → Magic Action settle. Every row was written on-chain by `settle`. | Disclosed in the judge docs. |
| 9 | Info | **Devnet only, fixed room pool** (13 pre-created rooms; room 5 is the staked table). | Mainnet would need real stakes review and more rooms. |
| 10 | Info | **First download is large** (main bundle ~1.7 MB, 3D chunk ~0.97 MB, soldier model 1.7 MB). Cached after the first visit. | Further code-splitting would help phones on slow data. |

## 4. Dependency advisories (from `npm audit --omit=dev`)

| Package | Severity | Pulled in by | Exposure in BLACKOUT |
|---|---|---|---|
| `toml` | high | build tooling under Solana/Anchor packages | Not used on user input at runtime |
| `elliptic` | high | `@phala/dcap-qvl` (MagicBlock TEE attestation library) | Not used by our code to sign anything; our keys use `tweetnacl` / web3.js ed25519 |
| `stream-json`, `uuid` | moderate | transitive | Not fed untrusted input by our code |
| 2 others | low | transitive | — |

## 5. How to re-run this audit

```bash
cd programs/blackout && cargo test && cargo build && cd ../..
cd app && npx tsc --noEmit && npm audit --omit=dev && cd ..
npx tsx scripts/mirror.ts
npx tsx scripts/ui/console_audit.ts   # needs `npm run dev` running in app/
```
