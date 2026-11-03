//! Runs in the rollup: create a room's sealed accounts, once, before anyone can sit down.
use anchor_lang::prelude::*;

use crate::error::BlackoutError;
use crate::state::*;
use ephemeral_rollups_sdk::access_control::instructions::CreateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::EphemeralMembersArgs;

use super::room_account::*;

/// Create the sealed World and the Room's public permission.
/// The Room's permission account is the first remaining account.
pub fn handle_setup_core<'info>(ctx: Context<'info, RoomAccount<'info>>) -> Result<()> {
    let room_id = {
        let room = ctx.accounts.room.load()?;
        if room.ready_mask & 1 != 0 {
            return Ok(());
        }
        room.room_id
    };
    let rid = room_id.to_le_bytes();
    let (lo, hi) = room_key_parts(room_id);
    let bump = expect_pda(&ctx.accounts.target, &[WORLD_SEED, &rid])?;
    create_sealed(&ctx, &rid, &[WORLD_SEED, &rid, &[bump]], WORLD_LEN as u32, |d| {
        let w: &mut World = bytemuck::from_bytes_mut(&mut d[..WORLD_LEN]);
        w.magic = WORLD_MAGIC;
        w.room_lo = lo;
        w.room_hi = hi;
    })?;
    let room_permission = ctx.remaining_accounts.first().ok_or(BlackoutError::BadAccount)?;
    if room_permission.data_is_empty() {
        let room_ai = ctx.accounts.room.to_account_info();
        CreateEphemeralPermissionCpi {
            payer: room_ai.clone(),
            permissioned_account: room_ai,
            permission: room_permission.clone(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs { is_private: false, members: vec![] },
        }
        .invoke_signed(&[&[ROOM_SEED, &rid, &[ctx.bumps.room]]])?;
    }
    ctx.accounts.room.load_mut()?.ready_mask |= 1;
    Ok(())
}

/// Create one sealed flight-recorder chunk (10 KiB each, five per room).
pub fn handle_setup_rec<'info>(ctx: Context<'info, RoomAccount<'info>>, chunk: u8) -> Result<()> {
    require!((chunk as usize) < REC_CHUNKS, BlackoutError::BadSeat);
    let bit = 1u32 << (1 + chunk as u32);
    let room_id = {
        let room = ctx.accounts.room.load()?;
        if room.ready_mask & bit != 0 {
            return Ok(());
        }
        room.room_id
    };
    let rid = room_id.to_le_bytes();
    let (lo, hi) = room_key_parts(room_id);
    let bump = expect_pda(&ctx.accounts.target, &[REC_SEED, &rid, &[chunk]])?;
    create_sealed(&ctx, &rid, &[REC_SEED, &rid, &[chunk], &[bump]], REC_LEN as u32, |d| {
        let h: &mut RecHeader = bytemuck::from_bytes_mut(&mut d[..core::mem::size_of::<RecHeader>()]);
        h.magic = REC_MAGIC;
        h.room_lo = lo;
        h.room_hi = hi;
        h.chunk = chunk as u32;
    })?;
    ctx.accounts.room.load_mut()?.ready_mask |= bit;
    Ok(())
}

/// Create the private view for one seat (no members until someone sits).
pub fn handle_setup_view<'info>(ctx: Context<'info, RoomAccount<'info>>, seat: u8) -> Result<()> {
    require!((seat as usize) < MAXP, BlackoutError::BadSeat);
    let bit = 1u32 << (8 + seat as u32);
    let room_id = {
        let room = ctx.accounts.room.load()?;
        if room.ready_mask & bit != 0 {
            return Ok(());
        }
        room.room_id
    };
    let rid = room_id.to_le_bytes();
    let (lo, hi) = room_key_parts(room_id);
    let bump = expect_pda(&ctx.accounts.target, &[VIEW_SEED, &rid, &[seat]])?;
    create_sealed(&ctx, &rid, &[VIEW_SEED, &rid, &[seat], &[bump]], VIEW_LEN as u32, |d| {
        let v: &mut View = bytemuck::from_bytes_mut(&mut d[..VIEW_LEN]);
        v.magic = VIEW_MAGIC;
        v.room_lo = lo;
        v.room_hi = hi;
        v.seat = seat as u32;
    })?;
    ctx.accounts.room.load_mut()?.ready_mask |= bit;
    Ok(())
}
