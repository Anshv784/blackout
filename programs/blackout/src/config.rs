//! Addresses and tunable numbers. Everything here is compiled in: changing it takes an upgrade.
use anchor_lang::prelude::*;

/// Creates rooms and closes them again. Holds no power over stakes or results.
#[cfg(not(feature = "mainnet"))]
pub const ADMIN: Pubkey = pubkey!("9Sg12k15Ann4SKSxcA85bq5fbpq7WMLH9bLCTUbTRkQV");
#[cfg(feature = "mainnet")]
pub const ADMIN: Pubkey = pubkey!("EXu7bp1rbNw9R6UfRLnsJcxyEF4GCvqChcoHMdbHgCmx");

/// Receives the fee on every staked pot.
pub const TREASURY: Pubkey = ADMIN;
/// House fee on a staked pot, in basis points (1000 = 10%). Refunded tickets pay nothing.
pub const FEE_BPS: u64 = 1000;

/// The only validator rooms may be delegated to (same identity on devnet and mainnet).
pub const TEE_VALIDATOR: Pubkey = pubkey!("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
/// Escrow index used for the post-commit settle action.
pub const ACTION_ESCROW_INDEX: u8 = 255;
pub const COMPUTE_BUDGET_PROGRAM: Pubkey = pubkey!("ComputeBudget111111111111111111111111111111");
pub const TICK_MS: i64 = 50;
/// A full 5:00 night (6,000 ticks) plus countdown, with headroom.
pub const TICK_ITERATIONS: i64 = 6600;
/// ER slots are ~10 ms; never tick faster than 40 ms.
pub const MIN_TICK_SLOTS: u64 = 4;
/// Core | 5 recorder chunks | 8 views.
pub const READY_ALL: u32 = 1 | (0b11111 << 1) | (0xff << 8);
/// A ticket can be refunded this long after purchase if no settled match used it.
pub const TICKET_TTL_SECS: i64 = 3600;
/// A staked match may only start with at least this long left on every seated ticket,
/// so no ticket can be refunded before the match it is riding on has settled.
pub const MATCH_WINDOW_SECS: i64 = 1200;
/// A staked night still running this close to its earliest ticket expiry is called off
/// (no winner, every ticket refundable): `finish` needs time to settle before any
/// seated ticket could be refunded mid-night.
pub const SETTLE_MARGIN_SECS: i64 = 300;
/// An expired ticket whose night never paid out may move to a later night only this long after it
/// expired. Moving it sooner could take its stake out of the bank while that night's payout is
/// still on its way (a slow commit), and the winner would be paid a smaller pot.
pub const TICKET_RELEASE_GRACE_SECS: i64 = 86_400;
/// A staked table with two or more stakers seated starts this long after the last one sat down
/// (a full table starts at once). There is no host: any seated staker's game may start it.
pub const STAKED_START_WAIT_SECS: i64 = 60;
/// ...but a staked lobby never waits longer than this from its first countdown, so leaving and
/// sitting down again can't hold a table forever
pub const STAKED_MAX_WAIT_SECS: i64 = 180;
/// A free lobby can't be held forever: a public one may be started by anyone after this long
/// (bots fill the empty seats)...
pub const PUBLIC_LOBBY_MAX_SECS: i64 = 300;
/// ...and a private one may be cleared by anyone after this long, so the room frees up.
pub const PRIVATE_LOBBY_MAX_SECS: i64 = 600;

/// The daily prize: tables at exactly this stake (0.05 SOL) feed it. Of each such pot's 10% fee,
/// PRIZE_BPS (3.5%) goes to the prize and the rest to the treasury.
pub const PRIZE_STAKE: u64 = 50_000_000;
pub const PRIZE_BPS: u64 = 350;
/// Nights at the prize table a wallet must play in a day to be able to win it.
pub const PRIZE_MIN_GAMES: u32 = 3;

/// Each staked night sets this much of the house fee aside in the table fund, which keeps the
/// tables' own MagicBlock wallets topped up (each staked night's commit costs ~0.001 SOL).
pub const TABLE_FUND_PER_NIGHT: u64 = 1_000_000;
/// One refill from the table fund into a table's MagicBlock wallet.
pub const TABLE_REFILL: u64 = 20_000_000;
/// MagicBlock's transfer also opens a few helper accounts, paid by the fund (~0.0032 SOL measured)
pub const TABLE_REFILL_OVERHEAD: u64 = 5_000_000;
/// MagicBlock's Ephemeral SPL Token program: its lamports transfer (instruction 20) credits a
/// delegated account inside the rollup.
pub const ESPL_PROGRAM: Pubkey = pubkey!("SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2");
/// MagicBlock's delegation program (pinned so no stand-in can receive the fund's signature)
pub const DELEGATION_PROGRAM: Pubkey = pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
/// Smallest stake: the pot must always be enough to rent-exempt a brand new winner wallet.
pub const MIN_STAKE: u64 = 2_000_000;
/// VRF wait before a free room may self-seed (~5 s) or a staked start is called off (~30 s).
pub const FALLBACK_SLOTS: u64 = 500;
pub const ABORT_SLOTS: u64 = 3000;
/// `delegate_room` with this id delegates the daily board instead of a room.
pub const DAILY_ID: u64 = u64::MAX;
