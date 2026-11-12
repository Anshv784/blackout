//! Runs on Solana, admin only: open a room, and close it to get its SOL back.
use anchor_lang::prelude::*;

use crate::config::*;
use crate::error::BlackoutError;
use crate::state::*;
use anchor_lang::system_program::{transfer, Transfer};
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::consts::{MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

/// Admin: create the staked leaderboard and the daily board. `daily_prefund` pays the
/// daily board's rollup rent (its sealed seed account).
/// Creates the leaderboard, and the daily board too unless it already exists (so the leaderboard
/// can be closed and made again without touching the daily, which lives in the rollup).
pub fn handle_init_board<'info>(ctx: Context<'info, InitBoard<'info>>, daily_prefund: u64) -> Result<()> {
    require_keys_eq!(ctx.accounts.payer.key(), ADMIN, BlackoutError::NotAdmin);
    ctx.accounts.board.load_init()?;
    let daily: &AccountInfo<'info> = ctx.accounts.daily.as_ref();
    if daily.owner == &anchor_lang::system_program::ID && daily.data_is_empty() {
        let space = 8 + core::mem::size_of::<Daily>();
        let lamports = Rent::get()?.minimum_balance(space) + daily_prefund;
        let bump = [ctx.bumps.daily];
        let seeds: &[&[u8]] = &[DAILY_SEED, &bump];
        anchor_lang::system_program::create_account(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.key(),
                anchor_lang::system_program::CreateAccount { from: ctx.accounts.payer.to_account_info(), to: daily.clone() },
                &[seeds],
            ),
            lamports,
            space as u64,
            &crate::ID,
        )?;
        let loader = AccountLoader::<Daily>::try_from_unchecked(&crate::ID, daily)?;
        loader.load_init()?;
        loader.exit(&crate::ID)?;
    }
    Ok(())
}

/// Create a room and pre-fund it: the room PDA sponsors its ephemeral
/// accounts, their permissions, and its own commits once delegated.
pub fn handle_create_room(ctx: Context<CreateRoom>, room_id: u64, stake: u64, private_code: u32, prefund: u64) -> Result<()> {
    require_keys_eq!(ctx.accounts.payer.key(), ADMIN, BlackoutError::NotAdmin);
    require!(stake == 0 || stake >= MIN_STAKE, BlackoutError::NotStaked);
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer { from: ctx.accounts.payer.to_account_info(), to: ctx.accounts.room.to_account_info() },
        ),
        prefund,
    )?;
    let mut room = ctx.accounts.room.load_init()?;
    room.room_id = room_id;
    room.stake = stake;
    room.private_code = private_code;
    room.status = ST_LOBBY;
    room.winner = NO_SEAT;
    let bank = &mut ctx.accounts.bank;
    bank.room_id = room_id;
    bank.paid_match = 0;
    bank.bump = ctx.bumps.bank;
    Ok(())
}

/// Admin: hand a room, or the daily board (`room_id` = DAILY_ID), to the TEE validator.
pub fn handle_delegate_room(ctx: Context<DelegateRoom>, room_id: u64) -> Result<()> {
    // A room on any other validator could commit whatever state it likes.
    require_keys_eq!(ctx.accounts.payer.key(), ADMIN, BlackoutError::NotAdmin);
    let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
    require!(validator == Some(TEE_VALIDATOR), BlackoutError::BadAccount);
    let rid = room_id.to_le_bytes();
    let seeds: &[&[u8]] = if room_id == DAILY_ID { &[DAILY_SEED] } else { &[ROOM_SEED, &rid] };
    let (pda, _) = Pubkey::find_program_address(seeds, &crate::ID);
    require_keys_eq!(ctx.accounts.pda.key(), pda, BlackoutError::BadAccount);
    ctx.accounts.delegate_pda(&ctx.accounts.payer, seeds, DelegateConfig { validator, ..Default::default() })?;
    Ok(())
}

/// Admin, on Solana, after `undelegate_room`: take the room's rent and leftover funding back.
pub fn handle_close_room(ctx: Context<CloseRoom>) -> Result<()> {
    let bank = &ctx.accounts.bank;
    require!(bank.outstanding == 0 && bank.tickets == 0, BlackoutError::StakesOutstanding);
    Ok(())
}

pub fn handle_close_board(_ctx: Context<CloseBoard>) -> Result<()> {
    Ok(())
}

/// Admin: hand an empty room back to Solana so `close_room` can refund it.
pub fn handle_undelegate_room(ctx: Context<UndelegateRoom>) -> Result<()> {
    require_keys_eq!(ctx.accounts.admin.key(), ADMIN, BlackoutError::NotAdmin);
    let rid_bytes = {
        let room = ctx.accounts.room.load()?;
        require!(room.status == ST_LOBBY && room.n_players == 0, BlackoutError::RoomTaken);
        room.room_id.to_le_bytes()
    };
    let room_ai = ctx.accounts.room.to_account_info();
    let room_seeds: &[&[u8]] = &[ROOM_SEED, &rid_bytes, &[ctx.bumps.room]];
    MagicIntentBundleBuilder::new(
        room_ai.clone(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .magic_fee_vault(ctx.accounts.magic_fee_vault.to_account_info())
    .commit_and_undelegate(&[room_ai.clone()])
    .build_and_invoke_signed(&[room_seeds])?;
    Ok(())
}

#[derive(Accounts)]
pub struct InitBoard<'info> {
    #[account(init, payer = payer, space = 8 + core::mem::size_of::<Board>(), seeds = [BOARD_SEED], bump)]
    pub board: AccountLoader<'info, Board>,
    /// CHECK: the daily board's PDA; created here only if it doesn't exist yet (see the handler)
    #[account(mut, seeds = [DAILY_SEED], bump)]
    pub daily: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Admin: create the daily prize account (once). Settle skips the prize until it exists.
pub fn handle_init_prize(ctx: Context<InitPrize>) -> Result<()> {
    require_keys_eq!(ctx.accounts.payer.key(), ADMIN, BlackoutError::NotAdmin);
    ctx.accounts.prize.load_init()?;
    Ok(())
}

/// Admin: bring the prize account to the current layout and start it fresh (for a layout change).
/// Whatever it held above its rent goes to the treasury; the admin pays any extra rent.
pub fn handle_reset_prize(ctx: Context<ResetPrize>) -> Result<()> {
    require_keys_eq!(ctx.accounts.admin.key(), ADMIN, BlackoutError::NotAdmin);
    let ai = ctx.accounts.prize.to_account_info();
    require_keys_eq!(*ai.owner, crate::ID, BlackoutError::BadAccount);
    let space = 8 + core::mem::size_of::<Prize>();
    let rent = Rent::get()?.minimum_balance(space);
    if ai.lamports() < rent {
        transfer(
            CpiContext::new(ctx.accounts.system_program.key(), Transfer { from: ctx.accounts.admin.to_account_info(), to: ai.clone() }),
            rent - ai.lamports(),
        )?;
    }
    if ai.data_len() != space {
        ai.resize(space)?;
    }
    {
        let mut data = ai.try_borrow_mut_data()?;
        data.fill(0);
        data[..8].copy_from_slice(<Prize as anchor_lang::Discriminator>::DISCRIMINATOR);
        let p: &mut Prize = bytemuck::from_bytes_mut(&mut data[8..space]);
        p.last_claimed = 1;
    }
    let extra = ai.lamports().saturating_sub(rent);
    if extra > 0 {
        **ai.try_borrow_mut_lamports()? -= extra;
        **ctx.accounts.treasury.to_account_info().try_borrow_mut_lamports()? += extra;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct ResetPrize<'info> {
    /// CHECK: the prize PDA, rewritten in place
    #[account(mut, seeds = [PRIZE_SEED], bump)]
    pub prize: UncheckedAccount<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: the fee wallet
    #[account(mut, address = TREASURY)]
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitPrize<'info> {
    #[account(init, payer = payer, space = 8 + core::mem::size_of::<Prize>(), seeds = [PRIZE_SEED], bump)]
    pub prize: AccountLoader<'info, Prize>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(room_id: u64)]
pub struct CreateRoom<'info> {
    #[account(init, payer = payer, space = 8 + core::mem::size_of::<Room>(), seeds = [ROOM_SEED, &room_id.to_le_bytes()], bump)]
    pub room: AccountLoader<'info, Room>,
    #[account(init, payer = payer, space = BANK_LEN, seeds = [BANK_SEED, &room_id.to_le_bytes()], bump)]
    pub bank: Account<'info, Bank>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateRoom<'info> {
    /// CHECK: the room or daily board PDA, checked in the handler
    #[account(mut, del)]
    pub pda: UncheckedAccount<'info>,
    pub payer: Signer<'info>,
    /// CHECK: TEE validator identity
    pub validator: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct CloseRoom<'info> {
    #[account(mut, close = admin, seeds = [ROOM_SEED, &bank.room_id.to_le_bytes()], bump)]
    pub room: AccountLoader<'info, Room>,
    #[account(mut, close = admin, seeds = [BANK_SEED, &bank.room_id.to_le_bytes()], bump = bank.bump)]
    pub bank: Account<'info, Bank>,
    #[account(mut, address = ADMIN)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseBoard<'info> {
    #[account(mut, close = admin, seeds = [BOARD_SEED], bump)]
    pub board: AccountLoader<'info, Board>,
    #[account(mut, address = ADMIN)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct UndelegateRoom<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    /// CHECK: magic context
    #[account(mut, address = MAGIC_CONTEXT_ID)]
    pub magic_context: UncheckedAccount<'info>,
    /// CHECK: validator fee vault; the magic program checks it
    #[account(mut)]
    pub magic_fee_vault: UncheckedAccount<'info>,
}
