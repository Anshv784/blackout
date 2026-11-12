# Contributing to BLACKOUT

Thanks for taking a look. BLACKOUT is a small project, so there's no process to learn. This page is mostly the things that aren't obvious from the code.

## Ways to help

- **Play it and tell me what's wrong.** Lag, confusing screens, a gun that feels off or a bot doing something silly all count. [Open an issue](../../issues/new/choose) with your browser, device and, if you can, a screenshot. The room number is shown in the lobby, and it helps.
- **Fix something.** Small, focused pull requests are the easiest to review. If you want to change how the game plays (new weapon, new map, rule changes), open an issue first so we can agree on it before you spend the time.
- **Security problems** (reading hidden state, cheating, moving anyone's SOL) go through [SECURITY.md](SECURITY.md), not public issues.

## Getting set up

The browser client runs against the live devnet program, so most work needs only Node 22 or newer:

```bash
cd app
npm install
npm run dev        # http://localhost:5173
```

Program work also needs Rust, the Solana CLI 3.x and Anchor 1.0. Run the tests with:

```bash
cd programs/blackout
cargo test
```

## How the code fits together

| Where | What |
|---|---|
| `programs/blackout/src/instructions/` | The on-chain instructions. `stake.rs` holds all the money (tickets, carrying unused ones over, settle); `night.rs` runs a night from start to reset; `lobby.rs` handles seats and host controls. |
| `programs/blackout/src/sim/` | The game itself: movement, shooting, vision, bots, the zone. It's pure, deterministic Rust with integer and fixed-point maths only, and it runs inside the TEE every tick. |
| `app/src/game/sim.ts` | A line-for-line TypeScript mirror of the parts of the sim the browser predicts (movement, stamina, throws). |
| `app/src/chain/` | Instruction builders and account decoders. `layout.ts` must match `state.rs` byte for byte. |
| `app/src/scene/`, `app/src/ui/` | The 3D world (react-three-fiber) and the screens. |
| `scripts/` | Devnet tooling and the end-to-end suites. |

The [README](README.md#how-it-works) has diagrams of a night and of one tick.

## The rules that matter

**1. The Rust sim and `sim.ts` change together.** The browser predicts your own movement with `sim.ts` and reconciles against what the program computed. If the two disagree, players rubber-band. After touching movement, stamina, stances or throws on either side, run:

```bash
npx tsx scripts/mirror.ts      # must report every step identical
```

**2. No floats in the program.** Everything in `sim/` uses integers and fixed point (`UNIT = 256` per tile, angles in 0..65536). Floats would break determinism between the TEE, the tests and the browser's replay check.

**3. Account layouts are shared.** If you change a struct in `state.rs`, update the decoder in `app/src/chain/layout.ts` in the same pull request. Fields are 4-byte aligned on purpose so the client can read them with a `DataView`.

**4. Money changes need a test.** Anything that touches `stake.rs`, `join`, `leave`, `start_match`, `finish` or `reset` needs a Rust test, and ideally a check in `scripts/e2e_money.ts`. [Audit.md](Audit.md) lists the attacks those paths already defend against; please don't reopen one.

**5. Keep the program small.** Deploy cost scales with program size. Avoid pulling in new crates or the standard library's heavier helpers on the on-chain path. (The insertion sort in `check_end` is there on purpose.)

## Before you open a pull request

```bash
cd programs/blackout && cargo test && cd ../..
npx tsx scripts/mirror.ts           # if you touched the sim
cd app && npm run build             # typecheck + production build
```

For UI changes, please attach a screenshot or a short clip, ideally on a phone as well as desktop. Phones are a big share of players.

Commit messages are plain sentences about what changed and why, for example "Bots stop re-pathing every tick when their waypoint is behind a wall". There's no prefix convention.

## Running your own program

The client points at the devnet program by default. To deploy your own copy:

1. Generate a program keypair (`solana-keygen new -o target/deploy/blackout-keypair.json`) and put its address in `declare_id!` in `programs/blackout/src/lib.rs`.
2. Set `ADMIN` in `programs/blackout/src/config.rs` to a key you control. It creates rooms and receives the house fee, and it's also the treasury.
3. Run `./scripts/deploy.sh`. It signs with `~/.config/solana/blackout-devnet.json`, so keep your admin key there or edit the path. Use the script rather than `anchor build`, because `anchor build` rewrites `declare_id!` from whatever keypair it finds.
4. Create the leaderboard and rooms: `npx tsx scripts/admin.ts board`, then `npx tsx scripts/admin.ts rooms 1 2 3`. The admin scripts read the key from `ADMIN_KEY`, falling back to the same file.
5. In `app/.env`, set `VITE_PROGRAM_ID` to your program, and list your room ids in `app/src/config.ts`.

The scripts read keys from `~/.config/solana/`. Keypair files are git-ignored. Never commit one.

## Assets

The code is MIT, but some assets are not ours to relicense:

- **Characters and animations** come from Adobe Mixamo. They may be used inside the game, but the raw FBX files must not be redistributed, so don't add source files from Mixamo to the repo.
- **Gun models** are CC-BY. Add any new model to `app/public/models/guns/CREDITS.md` with its author and link.
- **Sounds** are CC0 or public domain. Add new ones to `app/public/sfx/CREDITS.txt`.

## Be kind

Assume good intent, keep feedback about the work, and remember most people here are doing this in their spare time.
