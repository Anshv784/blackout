//! Addresses and tunable numbers. Everything here is compiled in: changing it takes an upgrade.
use anchor_lang::prelude::*;

/// Creates rooms and closes them again. Holds no power over stakes or results.
#[cfg(not(feature = "mainnet"))]
pub const ADMIN: Pubkey = pubkey!("9Sg12k15Ann4SKSxcA85bq5fbpq7WMLH9bLCTUbTRkQV");
#[cfg(feature = "mainnet")]
pub const ADMIN: Pubkey = pubkey!("EXu7bp1rbNw9R6UfRLnsJcxyEF4GCvqChcoHMdbHgCmx");

/// Receives the fee on every staked pot.
pub const TREASURY: Pubkey = ADMIN;
/// House fee on a staked pot, in basis points (500 = 5%). Refunded tickets pay nothing.
pub const FEE_BPS: u64 = 500;

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
/// Smallest stake: the pot must always be enough to rent-exempt a brand new winner wallet.
pub const MIN_STAKE: u64 = 2_000_000;
/// VRF wait before a free room may self-seed (~5 s) or a staked start is called off (~30 s).
pub const FALLBACK_SLOTS: u64 = 500;
pub const ABORT_SLOTS: u64 = 3000;
/// `delegate_room` with this id delegates the daily board instead of a room.
pub const DAILY_ID: u64 = u64::MAX;
