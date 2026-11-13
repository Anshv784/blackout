//! Runs in the rollup: taking seats and the host's controls, before a night starts.
use anchor_lang::prelude::*;

use crate::config::*;
use crate::error::BlackoutError;
use crate::state::*;

use super::room_account::*;

/// Take a seat. The seat's view permission is rewritten so that only
/// `player` (your in-browser session key) can read it.
/// Staked rooms pass the ticket as the first remaining account.
pub fn handle_join<'info>(ctx: Context<'info, RoomAccount<'info>>, seat: u8, name: [u8; 16], payout: Pubkey, code: u32) -> Result<()> {
    let s = seat as usize;
    require!(s < MAXP, BlackoutError::BadSeat);
    let player = ctx.accounts.signer.key();
    let clock = Clock::get()?;
    let slot = clock.slot;
    let now = clock.unix_timestamp;
    let rid_bytes = {
        let mut room = ctx.accounts.room.load_mut()?;
        require!(room.status == ST_LOBBY, BlackoutError::NotInLobby);
        require!(room.ready_mask == READY_ALL, BlackoutError::NotReady);
        require!(room.private_code == 0 || room.private_code == code, BlackoutError::WrongCode);
        require!(room.seat_of(&player).is_none(), BlackoutError::AlreadySeated);
        require!(s < room.max_players(), BlackoutError::RoomFull);
        let staked = room.stake > 0;
        // A lobby that sat around until its tickets are nearly out can never start: clear it.
        if staked && room.n_players > 0 && now.saturating_add(MATCH_WINDOW_SECS) > room.stake_deadline {
            room.clear_humans();
        }
        if staked {
            // a staked table has no host: it starts itself (see `staked_start_ok`)
            room.host = Pubkey::default();
        } else {
            require!(room.host_present(slot) || room.host == player, BlackoutError::NoHost);
        }
        if room.is_stale(s, slot) {
            room.clear_seat(s);
        }
        require!(room.players[s] == Pubkey::default() && room.is_bot[s] == 0, BlackoutError::SeatTaken);
        let mut pay_to = if payout == Pubkey::default() { player } else { payout };
        if staked {
            let t = ctx.remaining_accounts.first().ok_or(BlackoutError::NeedTicket)?;
            require_keys_eq!(*t.owner, crate::ID, BlackoutError::NeedTicket);
            let data = t.try_borrow_data()?;
            let ticket = Ticket::try_deserialize(&mut &data[..])?;
            require!(ticket.room_id == room.room_id && ticket.player == player, BlackoutError::NeedTicket);
            require!(ticket.match_no == room.match_no + 1, BlackoutError::NeedTicket);
            require!(ticket.expires_at >= now.saturating_add(MATCH_WINDOW_SECS), BlackoutError::NeedTicket);
            room.stake_deadline = if room.n_players == 0 { ticket.expires_at } else { room.stake_deadline.min(ticket.expires_at) };
            pay_to = ticket.payout;
        }
        room.players[s] = player;
        room.payout[s] = pay_to;
        room.names[s] = name;
        room.last_seen[s] = slot as u32;
        room.n_players += 1;
        room.sync_pot();
        room.arm_staked_start(now, true); // a new high in stakers starts the countdown again (capped)
        room.room_id.to_le_bytes()
    };
    set_view_members(&ctx, &rid_bytes, seat, members_for(player))
}

/// "Create a room": claim a free room (no live humans), become its host and
/// choose how many seats it has. Bots fill whatever seats humans don't.
pub fn handle_claim_room(ctx: Context<Heartbeat>, max_players: u8, unlisted: bool, code: u32) -> Result<()> {
    let slot = Clock::get()?.slot;
    let mut room = ctx.accounts.room.load_mut()?;
    require!(room.status == ST_LOBBY, BlackoutError::NotInLobby);
    require!(room.ready_mask == READY_ALL && room.stake == 0, BlackoutError::NotReady);
    require!(room.live_humans(slot) == 0 || !room.host_present(slot), BlackoutError::RoomTaken);
    for i in 0..MAXP {
        if room.players[i] != Pubkey::default() && room.is_bot[i] == 0 {
            room.clear_seat(i);
        }
    }
    let m = (max_players as u32).clamp(2, MAXP as u32);
    // new rooms start with easy bots (BOT_EASY in bits 9-10); the host can raise it
    room.cfg = m | if unlisted { 1 << 8 } else { 0 } | (1 << 9);
    // private rooms are joined with a code the creator shares; public ones need none
    room.private_code = if unlisted { code.max(1) } else { 0 };
    room.host = ctx.accounts.player.key();
    // the lobby clock (see `lobby_overdue`); leaving and claiming again doesn't restart it
    room.stake_deadline = Room::lobby_clock_on_claim(room.stake_deadline, Clock::get()?.unix_timestamp, unlisted);
    Ok(())
}

/// A private lobby left waiting too long: anyone may clear it so the room frees up.
pub fn handle_expire_lobby(ctx: Context<Heartbeat>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let mut room = ctx.accounts.room.load_mut()?;
    require!(room.cfg & (1 << 8) != 0 && room.lobby_overdue(now), BlackoutError::TooEarly);
    for i in 0..MAXP {
        if room.players[i] != Pubkey::default() && room.is_bot[i] == 0 {
            room.clear_seat(i);
        }
    }
    room.host = Pubkey::default();
    room.sync_pot();
    room.stake_deadline = 0;
    Ok(())
}

/// Host hands the room to another player who is in it.
pub fn handle_make_host(ctx: Context<Heartbeat>, seat: u8) -> Result<()> {
    let slot = Clock::get()?.slot;
    let mut room = ctx.accounts.room.load_mut()?;
    require!(room.status == ST_LOBBY, BlackoutError::NotInLobby);
    require!(room.stake == 0, BlackoutError::NotReady); // staked tables have no host and fixed settings
    require!(room.host == ctx.accounts.player.key(), BlackoutError::NotHost);
    let s = seat as usize;
    require!(s < MAXP && room.is_bot[s] == 0 && room.players[s] != Pubkey::default(), BlackoutError::BadSeat);
    require!(!room.is_stale(s, slot), BlackoutError::BadSeat);
    room.host = room.players[s];
    Ok(())
}

/// Host picks how good the bots are: 0 = medium, 1 = easy, 2 = hard.
pub fn handle_set_bots(ctx: Context<Heartbeat>, level: u8) -> Result<()> {
    let mut room = ctx.accounts.room.load_mut()?;
    require!(room.status == ST_LOBBY, BlackoutError::NotInLobby);
    require!(room.stake == 0, BlackoutError::NotReady); // staked tables have no host and fixed settings
    require!(room.host == ctx.accounts.player.key(), BlackoutError::NotHost);
    room.cfg = (room.cfg & !(3 << 9)) | ((level as u32 & 3).min(2) << 9);
    Ok(())
}

/// Host switches the room between solo and duos (seats pair up 0-1, 2-3, 4-5, 6-7).
/// Host sets the night: bit 0 duos (teams of two), bit 1 the Meadow instead of the Yard.
/// (A plain `true`/`false` from an older client still just means duos on/off, on the Yard.)
pub fn handle_set_mode(ctx: Context<Heartbeat>, mode: u8) -> Result<()> {
    let mut room = ctx.accounts.room.load_mut()?;
    require!(room.status == ST_LOBBY, BlackoutError::NotInLobby);
    require!(room.stake == 0, BlackoutError::NotReady); // staked tables have no host and fixed settings
    require!(room.host == ctx.accounts.player.key(), BlackoutError::NotHost);
    let duos = mode & 1 != 0;
    // staked nights are every player for themselves
    require!(!duos || room.stake == 0, BlackoutError::NotReady);
    room.cfg &= !(crate::sim::CFG_DUOS | crate::sim::CFG_MEADOW);
    if duos {
        room.cfg |= crate::sim::CFG_DUOS;
    }
    if mode & 2 != 0 {
        room.cfg |= crate::sim::CFG_MEADOW;
    }
    Ok(())
}

/// Host resizes the room (seats beyond the new size must be empty).
pub fn handle_set_size(ctx: Context<Heartbeat>, max_players: u8) -> Result<()> {
    let mut room = ctx.accounts.room.load_mut()?;
    require!(room.status == ST_LOBBY, BlackoutError::NotInLobby);
    require!(room.stake == 0, BlackoutError::NotReady); // staked tables have no host and fixed settings
    require!(room.host == ctx.accounts.player.key(), BlackoutError::NotHost);
    let m = (max_players as usize).clamp(2, MAXP);
    for i in m..MAXP {
        require!(room.players[i] == Pubkey::default() || room.is_bot[i] == 1, BlackoutError::SeatTaken);
    }
    room.cfg = (room.cfg & !0xff) | m as u32;
    Ok(())
}

/// A seated player updates their look (operator, outfit, gun finish and skins: bytes 13-15 of their
/// name, see app/src/game/look.ts), so a change made after sitting down reaches everyone. In a
/// lobby it can also play their emote for the table: `emote` is a counter (128-255) that the other
/// players' screens watch; it lives in the seat's kill count, which a lobby doesn't use and every
/// night resets (sim::seed_match). The name itself (bytes 0-12) is never touched.
pub fn handle_set_look(ctx: Context<Heartbeat>, look: [u8; 3], emote: u8) -> Result<()> {
    let slot = Clock::get()?.slot;
    let mut room = ctx.accounts.room.load_mut()?;
    require!(room.status == ST_LOBBY || room.status == ST_REVEALED, BlackoutError::NotInLobby);
    let s = room.seat_of(&ctx.accounts.player.key()).ok_or(BlackoutError::NotSeated)?;
    require!(look[0] & 0xc0 == 0xc0, BlackoutError::BadAccount); // the packed-look marker
    room.names[s][12] = 0;
    room.names[s][13..16].copy_from_slice(&look);
    if room.status == ST_LOBBY && emote >= 128 {
        room.kills[s] = emote as u32;
    }
    room.last_seen[s] = slot as u32;
    Ok(())
}

/// A guest in a free room asks the host to start the night. In a free lobby `start_slot` and
/// `last_tick_slot` are unused (the night's start overwrites both), so they carry the request:
/// when it was asked and from which seat. The host's game shows it.
pub fn handle_ask_start(ctx: Context<Heartbeat>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let mut room = ctx.accounts.room.load_mut()?;
    require!(room.status == ST_LOBBY, BlackoutError::NotInLobby);
    require!(room.stake == 0, BlackoutError::NotReady);
    let player = ctx.accounts.player.key();
    let seat = room.seat_of(&player).ok_or(BlackoutError::NotSeated)?;
    require!(room.host != player, BlackoutError::NotReady);
    room.start_slot = slot;
    room.last_tick_slot = seat as u64;
    room.last_seen[seat] = slot as u32;
    Ok(())
}

/// Lobby presence: seated browsers ping every few seconds so abandoned
/// seats can be reclaimed and an absent host replaced.
pub fn handle_heartbeat(ctx: Context<Heartbeat>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let mut room = ctx.accounts.room.load_mut()?;
    let seat = room.seat_of(&ctx.accounts.player.key()).ok_or(BlackoutError::NotSeated)?;
    room.last_seen[seat] = slot as u32;
    Ok(())
}

pub fn handle_leave<'info>(ctx: Context<'info, RoomAccount<'info>>, seat: u8) -> Result<()> {
    let s = seat as usize;
    let player = ctx.accounts.signer.key();
    let rid_bytes = {
        let mut room = ctx.accounts.room.load_mut()?;
        require!(room.status == ST_LOBBY, BlackoutError::NotInLobby);
        require!(s < MAXP && room.players[s] == player, BlackoutError::BadSeat);
        room.clear_seat(s);
        // a staked table: under two stakers left, the countdown stops
        room.arm_staked_start(Clock::get()?.unix_timestamp, false);
        if room.host == player {
            if room.stake > 0 {
                room.host = Pubkey::default();
            } else {
                // the host walked out of a free room: it closes, everyone is unseated
                room.clear_humans();
                room.private_code = 0;
            }
        }
        room.sync_pot();
        room.room_id.to_le_bytes()
    };
    set_view_members(&ctx, &rid_bytes, seat, vec![])
}

/// Host removes a player from the lobby. In a private room the code rotates
/// (`new_code`), so the kicked player's copy of the old one stops working.
pub fn handle_kick<'info>(ctx: Context<'info, RoomAccount<'info>>, seat: u8, new_code: u32) -> Result<()> {
    let s = seat as usize;
    let host = ctx.accounts.signer.key();
    let rid_bytes = {
        let mut room = ctx.accounts.room.load_mut()?;
        require!(room.status == ST_LOBBY, BlackoutError::NotInLobby);
        require!(room.host == host, BlackoutError::NotHost);
        require!(room.stake == 0, BlackoutError::NotReady); // stakers have paid in: no kicking at a staked table
        require!(s < MAXP && room.is_bot[s] == 0 && room.players[s] != Pubkey::default() && room.players[s] != host, BlackoutError::BadSeat);
        room.clear_seat(s);
        if room.private_code != 0 && new_code != 0 {
            room.private_code = new_code;
        }
        room.room_id.to_le_bytes()
    };
    set_view_members(&ctx, &rid_bytes, seat, vec![])
}

#[derive(Accounts)]
pub struct Heartbeat<'info> {
    pub player: Signer<'info>,
    #[account(mut)]
    pub room: AccountLoader<'info, Room>,
}
