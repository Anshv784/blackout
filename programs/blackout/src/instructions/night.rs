//! Runs in the rollup: one night from start to lights on, and back to the lobby.
use anchor_lang::prelude::*;

use crate::config::*;
use crate::error::BlackoutError;
use crate::state::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use ephemeral_rollups_sdk::access_control::instructions::UpdateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::EphemeralMembersArgs;
use ephemeral_rollups_sdk::anchor::{vrf, vrf_callback};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::crank::{ScheduleCrankCpi, ScheduleTaskArgs};
use ephemeral_rollups_sdk::ephem::{CallHandler, FoldableIntentBuilder, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::vrf::instructions::{create_request_high_priority_scoped_randomness_ix, RequestRandomnessParams};
use ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta;
use ephemeral_rollups_sdk::{ActionArgs, ShortAccountMeta};

use super::lobby::Heartbeat;
use super::room_account::*;
use crate::sim;

pub const BOT_NAMES: [&str; 8] = ["SHADE", "NYX", "WRAITH", "UMBRA", "HUSH", "GLOOM", "VESPER", "DUSK"];

/// Fill empty seats with bots, request the VRF seed and start the 20 Hz crank.
pub fn handle_start_match<'info>(ctx: Context<'info, StartMatch<'info>>, fill_to: u8, client_seed: u8) -> Result<()> {
    let player = ctx.accounts.payer.key();
    let clock = Clock::get()?;
    let slot = clock.slot;
    let task_id = {
        let mut room = ctx.accounts.room.load_mut()?;
        require!(room.status == ST_LOBBY, BlackoutError::NotInLobby);
        require!(room.seat_of(&player).is_some(), BlackoutError::NotSeated);
        if room.stake == 0 {
            for i in 0..MAXP {
                if room.is_stale(i, slot) && room.players[i] != player {
                    room.clear_seat(i);
                }
            }
        }
        if room.stake > 0 {
            require!(clock.unix_timestamp.saturating_add(MATCH_WINDOW_SECS) <= room.stake_deadline, BlackoutError::NeedTicket);
            // no host: any seated staker may start it, once the table is full or the countdown has run out
            require!(room.staked_start_ok(clock.unix_timestamp), BlackoutError::TooEarly);
        } else {
            require!(room.host == player && room.host_present(slot), BlackoutError::NotHost);
        }
        // bots fill free seats (free rooms only)
        let total = if room.stake == 0 {
            let want = if room.cfg & 0xff != 0 { room.max_players() } else { (fill_to as usize).min(MAXP) };
            fill_bots(&mut room, want)
        } else {
            (0..MAXP).filter(|&i| room.players[i] != Pubkey::default() && room.is_bot[i] == 0).count()
        };
        require!(total >= 2, BlackoutError::NotEnoughPlayers);
        begin_match(&mut room, slot, ST_STARTING)
    };

    // 1. VRF: every random roll of the match comes from this seed
    let ix = create_request_high_priority_scoped_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.payer.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::OnSeed::DISCRIMINATOR.to_vec(),
        caller_seed: [client_seed; 32],
        accounts_metas: Some(vec![
            SerializableAccountMeta { pubkey: ctx.accounts.room.key(), is_signer: false, is_writable: true },
            SerializableAccountMeta { pubkey: ctx.accounts.world.key(), is_signer: false, is_writable: true },
        ]),
        ..Default::default()
    });
    ctx.accounts.invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;

    // 2. crank: tick every 50 ms inside the TEE, no server anywhere
    schedule_ticks(&ctx.accounts.payer, &ctx.accounts.magic_program, &ctx.accounts.room.to_account_info(), &ctx.accounts.world.to_account_info(), ctx.remaining_accounts, task_id)
}

/// Bots take free seats up to `want`. Returns how many seats are filled.
pub fn fill_bots(room: &mut Room, want: usize) -> usize {
    let mut total = (0..MAXP).filter(|&i| room.players[i] != Pubkey::default() && room.is_bot[i] == 0).count();
    for i in 0..want.min(MAXP) {
        if total >= want {
            break;
        }
        if room.players[i] == Pubkey::default() && room.is_bot[i] == 0 {
            room.is_bot[i] = 1;
            let mut nm = [0u8; 16];
            let label = BOT_NAMES[i % BOT_NAMES.len()].as_bytes();
            nm[..label.len()].copy_from_slice(label);
            room.names[i] = nm;
            room.payout[i] = Pubkey::default();
            total += 1;
        }
    }
    room.n_bots = (0..MAXP).filter(|&i| room.is_bot[i] == 1).count() as u32;
    total
}

/// Move the room into a new match. Returns the crank's task id.
pub fn begin_match(room: &mut Room, slot: u64, status: u32) -> u64 {
    room.match_no += 1;
    room.status = status;
    room.start_slot = slot;
    room.last_tick_slot = 0;
    room.seed_revealed = 0;
    room.sync_pot();
    // slot, not match number: a called-off start reuses its match number
    room.task_id = (room.room_id % 1_000_000) * 10_000 + slot % 10_000;
    room.task_id
}

/// Schedule the 20 Hz crank that ticks the night. `rest` = view0..view7, rec0..rec4.
pub fn schedule_ticks<'info>(
    payer: &'info AccountInfo<'info>,
    magic_program: &'info AccountInfo<'info>,
    room: &AccountInfo<'info>,
    world: &AccountInfo<'info>,
    rest: &[AccountInfo<'info>],
    task_id: u64,
) -> Result<()> {
    require!(rest.len() >= MAXP + REC_CHUNKS, BlackoutError::BadAccount);
    let mut metas = vec![AccountMeta::new(room.key(), false), AccountMeta::new(world.key(), false)];
    for v in rest.iter().take(MAXP + REC_CHUNKS) {
        metas.push(AccountMeta::new(v.key(), false));
    }
    // ComputeBudget::SetComputeUnitLimit(1.4M)
    let mut cu = vec![2u8];
    cu.extend_from_slice(&1_400_000u32.to_le_bytes());
    let budget_ix = Instruction { program_id: COMPUTE_BUDGET_PROGRAM, accounts: vec![], data: cu };
    let tick_ix = Instruction { program_id: crate::ID, accounts: metas, data: anchor_lang::InstructionData::data(&crate::instruction::Tick {}) };
    let mut accs = vec![room.clone(), world.clone()];
    for v in rest.iter().take(MAXP + REC_CHUNKS) {
        accs.push(v.clone());
    }
    ScheduleCrankCpi {
        payer,
        magic_program,
        instruction_accounts: &accs,
        args: ScheduleTaskArgs { task_id: task_id as i64, execution_interval_millis: TICK_MS, iterations: TICK_ITERATIONS, instructions: vec![budget_ix, tick_ix] },
    }
    .invoke()?;
    Ok(())
}

/// VRF callback — seeds spawns, loot and the zone, sealed inside World.
pub fn handle_on_seed(ctx: Context<OnSeed>, randomness: [u8; 32]) -> Result<()> {
    let mut room = ctx.accounts.room.load_mut()?;
    if room.status != ST_STARTING {
        return Ok(());
    }
    // a staked table has no host to choose: its map is drawn from this same seed, before the
    // night is built (spawns depend on the map)
    draw_staked_map(&mut room, &randomness);
    let rid = room.room_id;
    let mut d = ctx.accounts.world.try_borrow_mut_data()?;
    let w: &mut World = world_mut(&mut d, rid)?;
    sim::seed_match(&mut room, w, randomness);
    room.seed_revealed = 0;
    Ok(())
}

/// Staked tables only: Yard or Meadow, from the top bit of the night's VRF output. Nobody at the
/// table can steer it, and it costs nothing extra (the seed is already being drawn).
pub fn draw_staked_map(room: &mut Room, randomness: &[u8; 32]) {
    if room.stake == 0 {
        return;
    }
    room.cfg &= !sim::CFG_MEADOW;
    if randomness[31] & 0x80 != 0 {
        room.cfg |= sim::CFG_MEADOW;
    }
}

/// If the VRF oracle doesn't answer, any seated player can move things along. A free
/// room seeds from ER state (flagged so the UI can say so). A staked room never does:
/// that seed is predictable, so the start is called off and seats and tickets stand.
pub fn handle_fallback_seed(ctx: Context<FallbackSeed>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let mut room = ctx.accounts.room.load_mut()?;
    require!(room.status == ST_STARTING, BlackoutError::NotStarting);
    require!(room.seat_of(&ctx.accounts.payer.key()).is_some(), BlackoutError::NotSeated);
    if room.stake > 0 {
        require!(slot > room.start_slot + ABORT_SLOTS, BlackoutError::TooEarly);
        room.status = ST_LOBBY;
        room.match_no -= 1;
        return Ok(());
    }
    require!(slot > room.start_slot + FALLBACK_SLOTS, BlackoutError::TooEarly);
    // splitmix64 over ER state — clearly not VRF-grade, flagged as such
    let mut seed = [0u8; 32];
    let k = ctx.accounts.payer.key().to_bytes();
    let mut z = room.room_id ^ ((room.match_no as u64) << 32) ^ slot ^ u64::from_le_bytes(k[0..8].try_into().unwrap());
    for chunk in seed.chunks_mut(8) {
        z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut x = z;
        x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        x ^= x >> 31;
        chunk.copy_from_slice(&x.to_le_bytes());
    }
    let rid = room.room_id;
    let mut d = ctx.accounts.world.try_borrow_mut_data()?;
    let w: &mut World = world_mut(&mut d, rid)?;
    sim::seed_match(&mut room, w, seed);
    room.seed_revealed = 2;
    Ok(())
}

/// Player input. Hidden: it only touches the private World.
pub fn handle_input(ctx: Context<Input>, dx: i8, dy: i8, aim: u16, buttons: u8, seq: u32, throw: u8) -> Result<()> {
    let room = ctx.accounts.room.load()?;
    require!(room.status == ST_COUNTDOWN || room.status == ST_LIVE, BlackoutError::NotInLobby);
    let seat = room.seat_of(&ctx.accounts.player.key()).ok_or(BlackoutError::NotSeated)?;
    let rid = room.room_id;
    drop(room);
    let mut d = ctx.accounts.world.try_borrow_mut_data()?;
    let w: &mut World = world_mut(&mut d, rid)?;
    let tick = w.tick;
    let p = &mut w.players[seat];
    // an input that arrives after a newer one is stale: ignore it (sequence numbers only go up)
    if seq < p.in_seq {
        return Ok(());
    }
    p.in_dx = dx as i32;
    p.in_dy = dy as i32;
    p.aim = aim as u32;
    // bits 8-15: how far a grenade thrown now should fly (0 = the old fixed throw)
    p.buttons = buttons as u32 | (throw as u32) << 8;
    p.in_seq = seq;
    p.last_input_tick = tick;
    Ok(())
}

/// One 50 ms simulation step. Called by the crank (or any client as a
/// fallback — the slot gate stops double-ticking).
pub fn handle_tick<'info>(ctx: Context<'info, Tick<'info>>) -> Result<()> {
    let clock = Clock::get()?;
    let slot = clock.slot;
    let mut room = ctx.accounts.room.load_mut()?;
    if room.status != ST_COUNTDOWN && room.status != ST_LIVE {
        return Ok(());
    }
    if room.last_tick_slot != 0 && slot < room.last_tick_slot + MIN_TICK_SLOTS {
        return Ok(());
    }
    room.last_tick_slot = slot;
    // A night is counted in ticks, tickets expire in wall time. If the rollup stalled long
    // enough that a seated ticket could soon be refunded mid-night, call the night off.
    if out_of_time(&room, clock.unix_timestamp) {
        void_night(&mut room);
        return Ok(());
    }
    let rid = room.room_id;
    let (lo, hi) = room_key_parts(rid);
    let accs = [
        &ctx.accounts.view0, &ctx.accounts.view1, &ctx.accounts.view2, &ctx.accounts.view3,
        &ctx.accounts.view4, &ctx.accounts.view5, &ctx.accounts.view6, &ctx.accounts.view7,
    ];
    let mut bufs = Vec::with_capacity(MAXP);
    for (i, a) in accs.iter().enumerate() {
        require_keys_eq!(*a.owner, crate::ID, BlackoutError::BadAccount);
        let b = a.try_borrow_mut_data()?;
        require!(b.len() >= VIEW_LEN, BlackoutError::BadAccount);
        {
            let v: &View = bytemuck::from_bytes(&b[..VIEW_LEN]);
            require!(
                v.magic == VIEW_MAGIC && v.room_lo == lo && v.room_hi == hi && v.seat == i as u32,
                BlackoutError::BadAccount
            );
        }
        bufs.push(b);
    }
    let mut views: Vec<&mut View> = bufs.iter_mut().map(|b| bytemuck::from_bytes_mut::<View>(&mut b[..VIEW_LEN])).collect();
    let views: &mut [&mut View] = &mut views[..];

    let mut wd = ctx.accounts.world.try_borrow_mut_data()?;
    let w: &mut World = world_mut(&mut wd, rid)?;
    let rec_accs = [&ctx.accounts.rec0, &ctx.accounts.rec1, &ctx.accounts.rec2, &ctx.accounts.rec3, &ctx.accounts.rec4];
    let mut rbufs = Vec::with_capacity(REC_CHUNKS);
    for (i, a) in rec_accs.iter().enumerate() {
        require_keys_eq!(*a.owner, crate::ID, BlackoutError::BadAccount);
        let b = a.try_borrow_mut_data()?;
        require!(b.len() >= REC_LEN, BlackoutError::BadAccount);
        {
            let h: &RecHeader = bytemuck::from_bytes(&b[..core::mem::size_of::<RecHeader>()]);
            require!(
                h.magic == REC_MAGIC && h.room_lo == lo && h.room_hi == hi && h.chunk == i as u32,
                BlackoutError::BadAccount
            );
        }
        rbufs.push(b);
    }
    let mut recs: Vec<&mut [u8]> = rbufs.iter_mut().map(|b| &mut b[..]).collect();
    let was_countdown = room.status == ST_COUNTDOWN;
    sim::tick(&mut room, w, views, &mut recs[..]);
    if was_countdown && room.status == ST_LIVE {
        room.start_slot = slot;
    }
    Ok(())
}

/// A staked night that can no longer settle before its earliest ticket becomes refundable.
pub fn out_of_time(room: &Room, now: i64) -> bool {
    room.stake > 0 && now.saturating_add(SETTLE_MARGIN_SECS) > room.stake_deadline
}

/// End a staked night with no winner: `settle` then pays nobody and marks the match
/// settled, so every seated ticket can be refunded in full straight away.
pub fn void_night(room: &mut Room) {
    room.status = ST_ENDED;
    room.winner = NO_SEAT;
    room.end_tick = room.tick;
    room.place = [0; MAXP];
}

/// Host ends a running night early: the next tick ends it normally (placements,
/// lights on, replay), then the room can be closed from the verdict.
pub fn handle_end_now(ctx: Context<Heartbeat>) -> Result<()> {
    let mut room = ctx.accounts.room.load_mut()?;
    require!(room.status == ST_LIVE || room.status == ST_COUNTDOWN, BlackoutError::NotInLobby);
    require!(room.host == ctx.accounts.player.key(), BlackoutError::NotHost);
    // Ending early ranks the living by health then seat: at a staked table
    // that would let the host hand themselves the pot during the countdown.
    // ...and on a daily night it would rank you first while everyone is still at full health
    require!(room.stake == 0 && !sim::daily(&room), BlackoutError::NotReady);
    room.end_tick = sim::END_REQUEST;
    Ok(())
}

/// Lights on: flip World + Recorder to public. A staked night also commits the room to
/// Solana with a Magic Action that pays the pot; a free night never touches Solana.
pub fn handle_finish<'info>(ctx: Context<'info, Finish<'info>>) -> Result<()> {
    let (rid_bytes, room_id, match_no, staked, winner_key, players, is_bot, is_daily) = {
        let mut room = ctx.accounts.room.load_mut()?;
        require!(room.status == ST_ENDED, BlackoutError::NotEnded);
        room.status = ST_REVEALED;
        room.seed_revealed = if room.seed_revealed == 2 { 2 } else { 1 };
        let wk = if room.winner != NO_SEAT { room.payout[room.winner as usize] } else { Pubkey::default() };
        (room.room_id.to_le_bytes(), room.room_id, room.match_no, room.stake > 0, wk, room.players, room.is_bot, sim::daily(&room))
    };
    set_sealed(
        &ctx.accounts.room.to_account_info(),
        &rid_bytes,
        ctx.bumps.room,
        &ctx.accounts.world.to_account_info(),
        &ctx.accounts.world_permission.to_account_info(),
        ctx.bumps.world,
        ctx.remaining_accounts,
        &ctx.accounts.ephemeral_vault.to_account_info(),
        &ctx.accounts.magic_program.to_account_info(),
        &ctx.accounts.permission_program.to_account_info(),
        false,
        !is_daily,
    )?;
    if is_daily {
        // the daily board is the account after the recorder pairs
        let daily = ctx.remaining_accounts.get(REC_CHUNKS * 2).ok_or(BlackoutError::BadAccount)?;
        let room = ctx.accounts.room.load()?;
        super::daily::post_score(daily, &room)?;
    }
    if !staked {
        return Ok(());
    }
    if winner_key != Pubkey::default() {
        require_keys_eq!(ctx.accounts.winner.key(), winner_key, BlackoutError::BadAccount);
    }
    let room_ai = ctx.accounts.room.to_account_info();
    let room_seeds: &[&[u8]] = &[ROOM_SEED, &rid_bytes, &[ctx.bumps.room]];
    let meta = |key: Pubkey, is_writable: bool| ShortAccountMeta { pubkey: key.to_bytes().into(), is_writable };
    let mut accounts = vec![
        meta(ctx.accounts.board.key(), true),
        meta(ctx.accounts.bank.key(), true),
        meta(room_ai.key(), false),
        meta(ctx.accounts.winner.key(), true),
        meta(TREASURY, true),
        meta(Pubkey::find_program_address(&[PRIZE_SEED], &crate::ID).0, true),
    ];
    // Derived here, not taken from the caller, so a losing player can't leave their own
    // ticket out of settle and then claim it back as unused.
    for s in 0..MAXP {
        if players[s] != Pubkey::default() && is_bot[s] == 0 {
            let (ticket, _) = Pubkey::find_program_address(&[TICKET_SEED, &room_id.to_le_bytes(), &match_no.to_le_bytes(), players[s].as_ref()], &crate::ID);
            accounts.push(meta(ticket, true));
        }
    }
    let action = CallHandler {
        destination_program: crate::ID,
        accounts,
        args: ActionArgs::new(anchor_lang::InstructionData::data(&crate::instruction::Settle {})),
        escrow_authority: room_ai.clone(),
        compute_units: 300_000,
    };
    MagicIntentBundleBuilder::new(
        room_ai.clone(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .magic_fee_vault(ctx.accounts.magic_fee_vault.to_account_info())
    .commit(&[room_ai.clone()])
    .add_post_commit_actions([action])
    .build_and_invoke_signed(&[room_seeds])?;
    Ok(())
}

/// Back to the lobby: re-seal World + Recorder for the next match.
pub fn handle_reset<'info>(ctx: Context<'info, Reset<'info>>) -> Result<()> {
    let rid_bytes = {
        let mut room = ctx.accounts.room.load_mut()?;
        require!(room.status == ST_REVEALED, BlackoutError::NotEnded);
        room.status = ST_LOBBY;
        room.tick = 0;
        room.pot = 0;
        room.start_slot = 0;
        room.last_tick_slot = 0;
        for i in 0..MAXP {
            if room.is_bot[i] == 1 {
                room.is_bot[i] = 0;
                room.names[i] = [0; 16];
            }
            room.alive[i] = 0;
        }
        room.n_bots = 0;
        room.cfg &= !sim::CFG_DAILY;
        if room.stake > 0 {
            // staked seats must buy a new ticket for the next match
            room.clear_humans();
        }
        room.room_id.to_le_bytes()
    };
    set_sealed(
        &ctx.accounts.room.to_account_info(),
        &rid_bytes,
        ctx.bumps.room,
        &ctx.accounts.world.to_account_info(),
        &ctx.accounts.world_permission.to_account_info(),
        ctx.bumps.world,
        ctx.remaining_accounts,
        &ctx.accounts.ephemeral_vault.to_account_info(),
        &ctx.accounts.magic_program.to_account_info(),
        &ctx.accounts.permission_program.to_account_info(),
        true,
        true,
    )?;
    let rid = u64::from_le_bytes(rid_bytes);
    let mut wd = ctx.accounts.world.try_borrow_mut_data()?;
    let w: &mut World = world_mut(&mut wd, rid)?;
    // free rooms: seats that never sent a single input last match are abandoned tabs
    {
        let mut room = ctx.accounts.room.load_mut()?;
        if room.stake == 0 {
            let slot = Clock::get()?.slot;
            for i in 0..MAXP {
                if room.is_bot[i] == 0 && room.players[i] != Pubkey::default() {
                    if w.players[i].in_seq == 0 {
                        room.clear_seat(i);
                    } else {
                        // they played this match: give them a fresh presence window
                        room.last_seen[i] = slot as u32;
                    }
                }
            }
        }
    }
    let (magic, lo, hi) = (w.magic, w.room_lo, w.room_hi);
    *w = bytemuck::Zeroable::zeroed();
    w.magic = magic;
    w.room_lo = lo;
    w.room_hi = hi;
    for c in 0..REC_CHUNKS {
        let mut rd = ctx.remaining_accounts[c * 2].try_borrow_mut_data()?;
        let h: &mut RecHeader = bytemuck::from_bytes_mut(&mut rd[..core::mem::size_of::<RecHeader>()]);
        h.frames = 0;
    }
    Ok(())
}

#[vrf]
#[derive(Accounts)]
pub struct StartMatch<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: ephemeral World PDA
    #[account(mut, seeds = [WORLD_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub world: UncheckedAccount<'info>,
    /// CHECK: VRF ephemeral queue
    #[account(mut, address = ephemeral_rollups_sdk::vrf::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    // remaining accounts: view0..view7, rec0..rec4 (writable)
}

#[vrf_callback]
#[derive(Accounts)]
pub struct OnSeed<'info> {
    #[account(mut)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: ephemeral World, verified by magic + room id
    #[account(mut, owner = crate::ID)]
    pub world: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct FallbackSeed<'info> {
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: ephemeral World PDA
    #[account(mut, seeds = [WORLD_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub world: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Input<'info> {
    pub player: Signer<'info>,
    pub room: AccountLoader<'info, Room>,
    /// CHECK: ephemeral World, verified by owner + magic + room id
    #[account(mut, owner = crate::ID)]
    pub world: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Tick<'info> {
    #[account(mut)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: verified by owner + magic + room id
    #[account(mut, owner = crate::ID)]
    pub world: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub view0: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub view1: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub view2: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub view3: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub view4: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub view5: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub view6: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub view7: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub rec0: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub rec1: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub rec2: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub rec3: UncheckedAccount<'info>,
    /// CHECK: verified in handler
    #[account(mut)]
    pub rec4: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Finish<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: ephemeral World PDA
    #[account(mut, seeds = [WORLD_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub world: UncheckedAccount<'info>,
    /// CHECK: permission program checks
    #[account(mut)]
    pub world_permission: UncheckedAccount<'info>,
    /// CHECK: base-layer leaderboard (action target)
    #[account(seeds = [BOARD_SEED], bump)]
    pub board: UncheckedAccount<'info>,
    /// CHECK: base-layer bank (action target)
    #[account(seeds = [BANK_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub bank: UncheckedAccount<'info>,
    /// CHECK: winner payout wallet (checked against the room)
    pub winner: UncheckedAccount<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: ephemeral rent vault
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
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

#[derive(Accounts)]
pub struct Reset<'info> {
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: ephemeral World PDA
    #[account(mut, seeds = [WORLD_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub world: UncheckedAccount<'info>,
    /// CHECK: permission program checks
    #[account(mut)]
    pub world_permission: UncheckedAccount<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: ephemeral rent vault
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

/// Flip World (unless `include_world` is false) + all recorder chunks between sealed
/// (private, no members) and public.
/// `rest` = [rec0, perm0, rec1, perm1, ... rec4, perm4].
#[allow(clippy::too_many_arguments)]
pub fn set_sealed<'info>(
    room: &AccountInfo<'info>,
    rid: &[u8; 8],
    room_bump: u8,
    world: &AccountInfo<'info>,
    world_perm: &AccountInfo<'info>,
    world_bump: u8,
    rest: &[AccountInfo<'info>],
    vault: &AccountInfo<'info>,
    magic: &AccountInfo<'info>,
    perm_program: &AccountInfo<'info>,
    private: bool,
    include_world: bool,
) -> Result<()> {
    require!(rest.len() >= REC_CHUNKS * 2, BlackoutError::BadAccount);
    let room_seeds: &[&[u8]] = &[ROOM_SEED, rid, &[room_bump]];
    let flip = |acc: &AccountInfo<'info>, perm: &AccountInfo<'info>, seeds: &[&[u8]]| -> Result<()> {
        UpdateEphemeralPermissionCpi {
            payer: room.clone(),
            permissioned_account: acc.clone(),
            permission: perm.clone(),
            vault: vault.clone(),
            magic_program: magic.clone(),
            permission_program: perm_program.clone(),
            authority: acc.clone(),
            authority_is_signer: false,
            args: EphemeralMembersArgs { is_private: private, members: vec![] },
        }
        .invoke_signed(&[room_seeds, seeds])?;
        Ok(())
    };
    if include_world {
        flip(world, world_perm, &[WORLD_SEED, rid, &[world_bump]])?;
    }
    for c in 0..REC_CHUNKS {
        let acc = &rest[c * 2];
        let perm = &rest[c * 2 + 1];
        let (key, bump) = Pubkey::find_program_address(&[REC_SEED, rid, &[c as u8]], &crate::ID);
        require_keys_eq!(acc.key(), key, BlackoutError::BadAccount);
        flip(acc, perm, &[REC_SEED, rid, &[c as u8], &[bump]])?;
    }
    Ok(())
}

pub fn world_mut(d: &mut [u8], room_id: u64) -> Result<&mut World> {
    require!(d.len() >= WORLD_LEN, BlackoutError::BadAccount);
    let w: &mut World = bytemuck::from_bytes_mut(&mut d[..WORLD_LEN]);
    let (lo, hi) = room_key_parts(room_id);
    require!(w.magic == WORLD_MAGIC && w.room_lo == lo && w.room_hi == hi, BlackoutError::BadAccount);
    Ok(w)
}

#[cfg(test)]
mod void_tests {
    use super::*;

    fn staked(deadline: i64) -> Room {
        let mut r: Room = bytemuck::Zeroable::zeroed();
        r.stake = MIN_STAKE;
        r.stake_deadline = deadline;
        r.status = ST_LIVE;
        r.winner = 3;
        r.place = [1; MAXP];
        r
    }

    #[test]
    fn a_staked_night_is_called_off_before_any_ticket_can_be_refunded() {
        let r = staked(10_000);
        assert!(!out_of_time(&r, 10_000 - SETTLE_MARGIN_SECS));
        assert!(out_of_time(&r, 10_000 - SETTLE_MARGIN_SECS + 1));
        // a full night always fits: a match only starts with MATCH_WINDOW_SECS left
        assert!(!out_of_time(&r, 10_000 - MATCH_WINDOW_SECS + 6 * 60));
    }

    #[test]
    fn free_nights_never_run_out_of_time() {
        let mut r = staked(0);
        r.stake = 0;
        assert!(!out_of_time(&r, i64::MAX));
    }

    #[test]
    fn a_called_off_night_has_no_winner() {
        let mut r = staked(0);
        void_night(&mut r);
        assert_eq!((r.status, r.winner), (ST_ENDED, NO_SEAT));
        assert!(r.place.iter().all(|&p| p == 0));
    }
}

#[cfg(test)]
mod staked_map_tests {
    use super::*;
    use bytemuck::Zeroable;

    #[test]
    fn a_staked_table_draws_its_map_from_the_seed() {
        let mut r: Room = Zeroable::zeroed();
        r.stake = 10_000_000;
        let mut seed = [0u8; 32];
        draw_staked_map(&mut r, &seed);
        assert_eq!(r.cfg & sim::CFG_MEADOW, 0, "low draw: the Yard");
        seed[31] = 0x80;
        draw_staked_map(&mut r, &seed);
        assert_ne!(r.cfg & sim::CFG_MEADOW, 0, "high draw: the Meadow");
        seed[31] = 0x7f;
        draw_staked_map(&mut r, &seed);
        assert_eq!(r.cfg & sim::CFG_MEADOW, 0, "redrawn every night, not sticky");
    }

    #[test]
    fn other_settings_survive_the_draw() {
        let mut r: Room = Zeroable::zeroed();
        r.stake = 10_000_000;
        r.cfg = 6 | (2 << 9); // six seats, a bot level
        let mut seed = [0u8; 32];
        seed[31] = 0xff;
        draw_staked_map(&mut r, &seed);
        assert_eq!(r.cfg & !sim::CFG_MEADOW, 6 | (2 << 9));
    }

    #[test]
    fn a_free_room_keeps_the_hosts_pick() {
        let mut r: Room = Zeroable::zeroed();
        r.cfg = sim::CFG_MEADOW;
        draw_staked_map(&mut r, &[0u8; 32]);
        assert_ne!(r.cfg & sim::CFG_MEADOW, 0);
    }
}
