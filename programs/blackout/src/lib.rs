//! BLACKOUT — a real-time fog-of-war battle royale that runs inside a
//! MagicBlock Private Ephemeral Rollup (Intel TDX TEE).
//!
//! * Room      — public lobby/scoreboard (delegated PDA, public permission)
//! * World     — every position, bullet, loot roll and the zone plan.
//!               Ephemeral account, private permission with ZERO members:
//!               nobody can read it until the match ends.
//! * View[i]   — what seat i is allowed to see this tick. Private to seat i.
//! * Recorder  — flight recorder. Private during play, public after.
//! * A crank ticks the simulation at 20 Hz inside the TEE, VRF seeds every
//!   random roll, and a Magic Action settles staked pots + the leaderboard on Solana.
#![allow(deprecated)]
#![allow(unexpected_cfgs)]

// No panic messages on chain: formatting them is the largest single piece of dead weight.
#[cfg(all(target_os = "solana", feature = "custom-panic"))]
#[no_mangle]
fn custom_panic(_: &core::panic::PanicInfo<'_>) {}

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod config;
pub mod error;
pub mod gen;
pub mod instructions;
pub mod sim;
pub mod state;

pub use config::*;
pub use error::*;
pub use instructions::*;
pub use state::*;

#[cfg(not(feature = "mainnet"))]
declare_id!("CkSb4kkmhzr8n9awdmrvqhuoWka6nZUXXb8RXnrFBAKU");
#[cfg(feature = "mainnet")]
declare_id!("pzuVHdCZDQWwxHLEa2JAaEjUZLa43nKaFauLyqZmekb");

#[ephemeral]
#[program]
pub mod blackout {
    use super::*;

    // ---- Solana: admin

    pub fn init_board<'info>(ctx: Context<'info, InitBoard<'info>>, daily_prefund: u64) -> Result<()> {
        instructions::admin::handle_init_board(ctx, daily_prefund)
    }

    pub fn create_room(ctx: Context<CreateRoom>, room_id: u64, stake: u64, private_code: u32, prefund: u64) -> Result<()> {
        instructions::admin::handle_create_room(ctx, room_id, stake, private_code, prefund)
    }

    pub fn delegate_room(ctx: Context<DelegateRoom>, room_id: u64) -> Result<()> {
        instructions::admin::handle_delegate_room(ctx, room_id)
    }

    pub fn close_room(ctx: Context<CloseRoom>) -> Result<()> {
        instructions::admin::handle_close_room(ctx)
    }

    pub fn undelegate_room(ctx: Context<UndelegateRoom>) -> Result<()> {
        instructions::admin::handle_undelegate_room(ctx)
    }

    /// The leaderboard's rent back, when the game is shutting down.
    pub fn close_board(ctx: Context<CloseBoard>) -> Result<()> {
        instructions::admin::handle_close_board(ctx)
    }

    // ---- Solana: money

    pub fn buy_ticket(ctx: Context<BuyTicket>, room_id: u64, match_no: u32, payout: Pubkey) -> Result<()> {
        instructions::stake::handle_buy_ticket(ctx, room_id, match_no, payout)
    }

    pub fn close_ticket(ctx: Context<CloseTicket>) -> Result<()> {
        instructions::stake::handle_close_ticket(ctx)
    }

    pub fn claim_prize(ctx: Context<ClaimPrize>) -> Result<()> {
        instructions::stake::handle_claim_prize(ctx)
    }

    pub fn init_prize(ctx: Context<InitPrize>) -> Result<()> {
        instructions::admin::handle_init_prize(ctx)
    }

    pub fn reuse_ticket(ctx: Context<ReuseTicket>, room_id: u64, match_no: u32) -> Result<()> {
        instructions::stake::handle_reuse_ticket(ctx, room_id, match_no)
    }

    pub fn settle<'info>(ctx: Context<'info, Settle<'info>>) -> Result<()> {
        instructions::stake::handle_settle(ctx)
    }

    // ---- Rollup: setup

    pub fn setup_core<'info>(ctx: Context<'info, RoomAccount<'info>>) -> Result<()> {
        instructions::setup::handle_setup_core(ctx)
    }

    pub fn setup_rec<'info>(ctx: Context<'info, RoomAccount<'info>>, chunk: u8) -> Result<()> {
        instructions::setup::handle_setup_rec(ctx, chunk)
    }

    pub fn setup_view<'info>(ctx: Context<'info, RoomAccount<'info>>, seat: u8) -> Result<()> {
        instructions::setup::handle_setup_view(ctx, seat)
    }

    // ---- Rollup: lobby

    pub fn join<'info>(ctx: Context<'info, RoomAccount<'info>>, seat: u8, name: [u8; 16], payout: Pubkey, code: u32) -> Result<()> {
        instructions::lobby::handle_join(ctx, seat, name, payout, code)
    }

    pub fn claim_room(ctx: Context<Heartbeat>, max_players: u8, unlisted: bool, code: u32) -> Result<()> {
        instructions::lobby::handle_claim_room(ctx, max_players, unlisted, code)
    }

    pub fn make_host(ctx: Context<Heartbeat>, seat: u8) -> Result<()> {
        instructions::lobby::handle_make_host(ctx, seat)
    }

    pub fn set_bots(ctx: Context<Heartbeat>, level: u8) -> Result<()> {
        instructions::lobby::handle_set_bots(ctx, level)
    }

    pub fn set_mode(ctx: Context<Heartbeat>, mode: u8) -> Result<()> {
        instructions::lobby::handle_set_mode(ctx, mode)
    }

    pub fn set_size(ctx: Context<Heartbeat>, max_players: u8) -> Result<()> {
        instructions::lobby::handle_set_size(ctx, max_players)
    }

    pub fn heartbeat(ctx: Context<Heartbeat>) -> Result<()> {
        instructions::lobby::handle_heartbeat(ctx)
    }

    pub fn leave<'info>(ctx: Context<'info, RoomAccount<'info>>, seat: u8) -> Result<()> {
        instructions::lobby::handle_leave(ctx, seat)
    }

    pub fn kick<'info>(ctx: Context<'info, RoomAccount<'info>>, seat: u8, new_code: u32) -> Result<()> {
        instructions::lobby::handle_kick(ctx, seat, new_code)
    }

    // ---- The daily challenge

    pub fn roll_daily(ctx: Context<RollDaily>, client_seed: u8) -> Result<()> {
        instructions::daily::handle_roll_daily(ctx, client_seed)
    }

    pub fn on_daily_seed(ctx: Context<OnDailySeed>, randomness: [u8; 32]) -> Result<()> {
        instructions::daily::handle_on_daily_seed(ctx, randomness)
    }

    pub fn start_daily<'info>(ctx: Context<'info, StartDaily<'info>>) -> Result<()> {
        instructions::daily::handle_start_daily(ctx)
    }

    // ---- Rollup: the night

    pub fn start_match<'info>(ctx: Context<'info, StartMatch<'info>>, fill_to: u8, client_seed: u8) -> Result<()> {
        instructions::night::handle_start_match(ctx, fill_to, client_seed)
    }

    pub fn on_seed(ctx: Context<OnSeed>, randomness: [u8; 32]) -> Result<()> {
        instructions::night::handle_on_seed(ctx, randomness)
    }

    pub fn fallback_seed(ctx: Context<FallbackSeed>) -> Result<()> {
        instructions::night::handle_fallback_seed(ctx)
    }

    pub fn input(ctx: Context<Input>, dx: i8, dy: i8, aim: u16, buttons: u8, seq: u32, throw: u8) -> Result<()> {
        instructions::night::handle_input(ctx, dx, dy, aim, buttons, seq, throw)
    }

    pub fn tick<'info>(ctx: Context<'info, Tick<'info>>) -> Result<()> {
        instructions::night::handle_tick(ctx)
    }

    pub fn end_now(ctx: Context<Heartbeat>) -> Result<()> {
        instructions::night::handle_end_now(ctx)
    }

    pub fn finish<'info>(ctx: Context<'info, Finish<'info>>) -> Result<()> {
        instructions::night::handle_finish(ctx)
    }

    pub fn reset<'info>(ctx: Context<'info, Reset<'info>>) -> Result<()> {
        instructions::night::handle_reset(ctx)
    }
}
