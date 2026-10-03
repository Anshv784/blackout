//! BLACKOUT — a real-time fog-of-war battle royale that runs inside a
//! MagicBlock Private Ephemeral Rollup (Intel TDX TEE).
//!
//! * Room      — public lobby/scoreboard (delegated PDA, public permission)
//! * World     — every position, bullet, loot roll and the zone plan.
//!               Ephemeral account, private permission with ZERO members:
//!               nobody can read it until the match ends.
//! * View[i]   — what seat i is allowed to see this tick. Private to seat i.
//! * Recorder  — 10 Hz flight recorder. Private during play, public after.
//! * A crank ticks the simulation at 20 Hz inside the TEE, VRF seeds every
//!   random roll, and a Magic Action settles the pot + leaderboard on Solana.
#![allow(deprecated)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::system_program::{transfer, Transfer};
use ephemeral_rollups_sdk::access_control::instructions::{
    CreateEphemeralPermissionCpi, UpdateEphemeralPermissionCpi,
};
use ephemeral_rollups_sdk::access_control::structs::{
    EphemeralMembersArgs, Member, AUTHORITY_FLAG, TX_LOGS_FLAG,
};
use ephemeral_rollups_sdk::anchor::{action, delegate, ephemeral, vrf, vrf_callback};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::crank::{ScheduleCrankCpi, ScheduleTaskArgs};
use ephemeral_rollups_sdk::ephem::{CallHandler, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::ephemeral_accounts::EphemeralAccount;
use ephemeral_rollups_sdk::vrf::instructions::{create_request_high_priority_scoped_randomness_ix, RequestRandomnessParams};
use ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta;
use ephemeral_rollups_sdk::{ActionArgs, ShortAccountMeta};

pub mod gen;
pub mod sim;
pub mod state;

use state::*;

declare_id!("VWHcbCSH4kATcuPJgjZ6QC56W3NBQ53U6fxJNtGknh3");

/// Escrow index used for the post-commit settle action.
pub const ACTION_ESCROW_INDEX: u8 = 255;
pub const COMPUTE_BUDGET_PROGRAM: Pubkey = pubkey!("ComputeBudget111111111111111111111111111111");
pub const TICK_MS: i64 = 50;
pub const TICK_ITERATIONS: i64 = 3300;
pub const MIN_TICK_SLOTS: u64 = 4;
/// core | 5 recorder chunks | 8 views
pub const READY_ALL: u32 = 1 | (0b11111 << 1) | (0xff << 8); // ER slots are ~10 ms; never tick faster than 40 ms

fn room_key_parts(room_id: u64) -> (u32, u32) {
    (room_id as u32, (room_id >> 32) as u32)
}

fn members_for(key: Pubkey) -> Vec<Member> {
    vec![Member { flags: AUTHORITY_FLAG | TX_LOGS_FLAG, pubkey: key }]
}

#[ephemeral]
#[program]
pub mod blackout {
    use super::*;

    // ======================================================== base layer

    pub fn init_board(_ctx: Context<InitBoard>) -> Result<()> {
        Ok(())
    }

    /// Create a room and pre-fund it: the room PDA sponsors its ephemeral
    /// accounts, their permissions, and its own commits once delegated.
    pub fn create_room(ctx: Context<CreateRoom>, room_id: u64, stake: u64, private_code: u32, prefund: u64) -> Result<()> {
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

    pub fn delegate_room(ctx: Context<DelegateRoom>, room_id: u64) -> Result<()> {
        let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[ROOM_SEED, &room_id.to_le_bytes()],
            DelegateConfig { validator, ..Default::default() },
        )?;
        Ok(())
    }

    /// Staked rooms: pay the stake into the room bank and get a ticket the ER
    /// can verify when you take a seat.
    pub fn buy_ticket(ctx: Context<BuyTicket>, room_id: u64, match_no: u32, payout: Pubkey) -> Result<()> {
        let data = ctx.accounts.room.try_borrow_data()?;
        require!(data.len() >= 8 + core::mem::size_of::<Room>(), BlackoutError::BadAccount);
        let room: &Room = bytemuck::from_bytes(&data[8..8 + core::mem::size_of::<Room>()]);
        require!(room.room_id == room_id, BlackoutError::BadAccount);
        require!(room.stake > 0, BlackoutError::NotStaked);
        let stake = room.stake;
        drop(data);
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer { from: ctx.accounts.player.to_account_info(), to: ctx.accounts.bank.to_account_info() },
            ),
            stake,
        )?;
        let t = &mut ctx.accounts.ticket;
        t.room_id = room_id;
        t.match_no = match_no;
        t.player = ctx.accounts.player.key();
        t.payout = payout;
        t.amount = stake;
        Ok(())
    }

    /// Magic Action: runs on Solana right after the ER commits the finished
    /// room. Pays the pot and updates the global leaderboard.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        // Only the delegation program can sign for the room's escrow PDA, which
        // restricts settle to the post-commit Magic Action path.
        let expected_escrow = ephemeral_rollups_sdk::pda::ephemeral_balance_pda_from_payer(&ctx.accounts.room.key(), ACTION_ESCROW_INDEX);
        let a = &ctx.accounts.escrow_auth;
        let e = &ctx.accounts.escrow;
        // The executor appends [destination program, escrow_auth, escrow] after the
        // action accounts, so look for the signed escrow wherever it landed.
        let mut ok = (a.key() == expected_escrow && a.is_signer) || (e.key() == expected_escrow && e.is_signer);
        for ai in ctx.remaining_accounts.iter() {
            if ai.key() == expected_escrow && ai.is_signer {
                ok = true;
            }
        }
        require!(ok, BlackoutError::BadAccount);
        let data = ctx.accounts.room.try_borrow_data()?;
        require!(data.len() >= 8 + core::mem::size_of::<Room>(), BlackoutError::BadAccount);
        let room: Room = *bytemuck::from_bytes::<Room>(&data[8..8 + core::mem::size_of::<Room>()]);
        drop(data);
        let bank = &mut ctx.accounts.bank;
        require!(bank.room_id == room.room_id, BlackoutError::BadAccount);
        if room.match_no <= bank.paid_match || room.status != ST_REVEALED {
            return Ok(());
        }
        bank.paid_match = room.match_no;

        // leaderboard
        let mut board = ctx.accounts.board.load_mut()?;
        board.matches += 1;
        for s in 0..MAXP {
            if room.is_bot[s] == 1 || room.players[s] == Pubkey::default() {
                continue;
            }
            let key = room.payout[s];
            let won = room.winner == s as u32;
            let n = board.count as usize;
            let idx = match board.entries[..n].iter().position(|e| e.key == key) {
                Some(i) => Some(i),
                None if n < 32 => {
                    board.entries[n] = BoardEntry { key, wins: 0, kills: 0, games: 0, best_place: 99 };
                    board.count += 1;
                    Some(n)
                }
                None if won => {
                    let (i, _) = board.entries.iter().enumerate().min_by_key(|(_, e)| (e.wins, e.kills)).unwrap();
                    board.entries[i] = BoardEntry { key, wins: 0, kills: 0, games: 0, best_place: 99 };
                    Some(i)
                }
                None => None,
            };
            if let Some(i) = idx {
                let e = &mut board.entries[i];
                e.games += 1;
                e.kills += room.kills[s];
                if won {
                    e.wins += 1;
                }
                if room.place[s] > 0 && room.place[s] < e.best_place {
                    e.best_place = room.place[s];
                }
            }
        }
        drop(board);

        // pot
        if room.stake > 0 && room.winner != NO_SEAT && room.is_bot[room.winner as usize] == 0 {
            let w = room.winner as usize;
            require_keys_eq!(ctx.accounts.winner.key(), room.payout[w], BlackoutError::BadAccount);
            let bank_ai = ctx.accounts.bank.to_account_info();
            let rent = Rent::get()?.minimum_balance(bank_ai.data_len());
            let avail = bank_ai.lamports().saturating_sub(rent);
            let pay = room.pot.min(avail);
            if pay > 0 {
                **bank_ai.try_borrow_mut_lamports()? -= pay;
                **ctx.accounts.winner.to_account_info().try_borrow_mut_lamports()? += pay;
            }
            msg!("settled match {}: paid {} lamports to seat {}", room.match_no, pay, w);
        } else {
            msg!("settled match {}", room.match_no);
        }
        Ok(())
    }

    // ======================================================== ER: setup

    /// Create the sealed World and set the World/Room permissions.
    pub fn setup_core(ctx: Context<SetupCore>) -> Result<()> {
        if ctx.accounts.room.load()?.ready_mask & 1 != 0 {
            return Ok(());
        }
        let room_id = ctx.accounts.room.load()?.room_id;
        let rid = room_id.to_le_bytes();
        let (lo, hi) = room_key_parts(room_id);
        let room_seeds: &[&[u8]] = &[ROOM_SEED, &rid, &[ctx.bumps.room]];
        let world_seeds: &[&[u8]] = &[WORLD_SEED, &rid, &[ctx.bumps.world]];
        let room_ai = ctx.accounts.room.to_account_info();
        let world_ai = ctx.accounts.world.to_account_info();
        let vault_ai = ctx.accounts.ephemeral_vault.to_account_info();
        if world_ai.data_is_empty() {
            EphemeralAccount::new(&room_ai, &world_ai, &vault_ai)
                .with_signer_seeds(&[room_seeds, world_seeds])
                .create(WORLD_LEN as u32)?;
            let mut d = world_ai.try_borrow_mut_data()?;
            let w: &mut World = bytemuck::from_bytes_mut(&mut d[..WORLD_LEN]);
            w.magic = WORLD_MAGIC;
            w.room_lo = lo;
            w.room_hi = hi;
        }
        let jobs: [(AccountInfo, AccountInfo, bool, &[&[u8]]); 2] = [
            (world_ai.clone(), ctx.accounts.world_permission.to_account_info(), true, world_seeds),
            (room_ai.clone(), ctx.accounts.room_permission.to_account_info(), false, room_seeds),
        ];
        for (acc, perm, private, seeds) in jobs.into_iter() {
            if !perm.data_is_empty() {
                continue;
            }
            CreateEphemeralPermissionCpi {
                payer: room_ai.clone(),
                permissioned_account: acc,
                permission: perm,
                vault: vault_ai.clone(),
                magic_program: ctx.accounts.magic_program.to_account_info(),
                permission_program: ctx.accounts.permission_program.to_account_info(),
                args: EphemeralMembersArgs { is_private: private, members: vec![] },
            }
            .invoke_signed(&[room_seeds, seeds])?;
        }
        ctx.accounts.room.load_mut()?.ready_mask |= 1;
        Ok(())
    }

    /// Create one sealed flight-recorder chunk (10 KiB each, five per room).
    pub fn setup_rec(ctx: Context<SetupRec>, chunk: u8) -> Result<()> {
        require!((chunk as usize) < REC_CHUNKS, BlackoutError::BadSeat);
        let bit = 1u32 << (1 + chunk as u32);
        if ctx.accounts.room.load()?.ready_mask & bit != 0 {
            return Ok(());
        }
        let room_id = ctx.accounts.room.load()?.room_id;
        let rid = room_id.to_le_bytes();
        let (lo, hi) = room_key_parts(room_id);
        let room_seeds: &[&[u8]] = &[ROOM_SEED, &rid, &[ctx.bumps.room]];
        let rec_seeds: &[&[u8]] = &[REC_SEED, &rid, &[chunk], &[ctx.bumps.rec]];
        let room_ai = ctx.accounts.room.to_account_info();
        let rec_ai = ctx.accounts.rec.to_account_info();
        let vault_ai = ctx.accounts.ephemeral_vault.to_account_info();
        if rec_ai.data_is_empty() {
            EphemeralAccount::new(&room_ai, &rec_ai, &vault_ai)
                .with_signer_seeds(&[room_seeds, rec_seeds])
                .create(REC_LEN as u32)?;
            let mut d = rec_ai.try_borrow_mut_data()?;
            let h: &mut RecHeader = bytemuck::from_bytes_mut(&mut d[..core::mem::size_of::<RecHeader>()]);
            h.magic = REC_MAGIC;
            h.room_lo = lo;
            h.room_hi = hi;
            h.chunk = chunk as u32;
        }
        let perm = ctx.accounts.rec_permission.to_account_info();
        if perm.data_is_empty() {
            CreateEphemeralPermissionCpi {
                payer: room_ai.clone(),
                permissioned_account: rec_ai.clone(),
                permission: perm,
                vault: vault_ai.clone(),
                magic_program: ctx.accounts.magic_program.to_account_info(),
                permission_program: ctx.accounts.permission_program.to_account_info(),
                args: EphemeralMembersArgs { is_private: true, members: vec![] },
            }
            .invoke_signed(&[room_seeds, rec_seeds])?;
        }
        ctx.accounts.room.load_mut()?.ready_mask |= bit;
        Ok(())
    }

    /// Create the private view for one seat (no members until someone sits).
    pub fn setup_view(ctx: Context<SetupView>, seat: u8) -> Result<()> {
        require!((seat as usize) < MAXP, BlackoutError::BadSeat);
        let bit = 1u32 << (8 + seat as u32);
        if ctx.accounts.room.load()?.ready_mask & bit != 0 {
            return Ok(());
        }
        let room_id = ctx.accounts.room.load()?.room_id;
        let rid = room_id.to_le_bytes();
        let (lo, hi) = room_key_parts(room_id);
        let room_seeds: &[&[u8]] = &[ROOM_SEED, &rid, &[ctx.bumps.room]];
        let view_seeds: &[&[u8]] = &[VIEW_SEED, &rid, &[seat], &[ctx.bumps.view]];
        let room_ai = ctx.accounts.room.to_account_info();
        let view_ai = ctx.accounts.view.to_account_info();
        let vault_ai = ctx.accounts.ephemeral_vault.to_account_info();
        if view_ai.data_is_empty() {
            EphemeralAccount::new(&room_ai, &view_ai, &vault_ai)
                .with_signer_seeds(&[room_seeds, view_seeds])
                .create(VIEW_LEN as u32)?;
            let mut d = view_ai.try_borrow_mut_data()?;
            let v: &mut View = bytemuck::from_bytes_mut(&mut d[..VIEW_LEN]);
            v.magic = VIEW_MAGIC;
            v.room_lo = lo;
            v.room_hi = hi;
            v.seat = seat as u32;
        }
        let perm = ctx.accounts.view_permission.to_account_info();
        if perm.data_is_empty() {
            CreateEphemeralPermissionCpi {
                payer: room_ai.clone(),
                permissioned_account: view_ai.clone(),
                permission: perm,
                vault: vault_ai.clone(),
                magic_program: ctx.accounts.magic_program.to_account_info(),
                permission_program: ctx.accounts.permission_program.to_account_info(),
                args: EphemeralMembersArgs { is_private: true, members: vec![] },
            }
            .invoke_signed(&[room_seeds, view_seeds])?;
        }
        ctx.accounts.room.load_mut()?.ready_mask |= bit;
        Ok(())
    }

    // ======================================================== ER: lobby

    /// Take a seat. The seat's view permission is rewritten so that only
    /// `player` (your in-browser session key) can read it.
    pub fn join(ctx: Context<Join>, seat: u8, name: [u8; 16], payout: Pubkey, code: u32) -> Result<()> {
        let s = seat as usize;
        require!(s < MAXP, BlackoutError::BadSeat);
        let player = ctx.accounts.player.key();
        let slot = Clock::get()?.slot;
        let rid_bytes = {
            let mut room = ctx.accounts.room.load_mut()?;
            require!(room.status == ST_LOBBY, BlackoutError::NotInLobby);
            require!(room.ready_mask == READY_ALL, BlackoutError::NotReady);
            require!(room.private_code == 0 || room.private_code == code, BlackoutError::WrongCode);
            require!(room.seat_of(&player).is_none(), BlackoutError::AlreadySeated);
            if room.is_stale(s, slot) && room.stake == 0 {
                room.clear_seat(s);
            }
            require!(room.players[s] == Pubkey::default() && room.is_bot[s] == 0, BlackoutError::SeatTaken);
            if room.stake > 0 {
                let t = ctx.accounts.ticket.as_ref().ok_or(BlackoutError::NeedTicket)?;
                require_keys_eq!(*t.owner, crate::ID, BlackoutError::NeedTicket);
                let data = t.try_borrow_data()?;
                let ticket = Ticket::try_deserialize(&mut &data[..])?;
                require!(ticket.room_id == room.room_id && ticket.player == player, BlackoutError::NeedTicket);
                require!(ticket.match_no == room.match_no + 1, BlackoutError::NeedTicket);
                room.pot += ticket.amount;
            }
            room.players[s] = player;
            room.payout[s] = if payout == Pubkey::default() { player } else { payout };
            room.names[s] = name;
            room.last_seen[s] = slot as u32;
            room.n_players += 1;
            room.fix_host(slot);
            room.room_id.to_le_bytes()
        };
        let room_seeds: &[&[u8]] = &[ROOM_SEED, &rid_bytes, &[ctx.bumps.room]];
        let view_seeds: &[&[u8]] = &[VIEW_SEED, &rid_bytes, &[seat], &[ctx.bumps.view]];
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.room.to_account_info(),
            permissioned_account: ctx.accounts.view.to_account_info(),
            permission: ctx.accounts.view_permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.view.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs { is_private: true, members: members_for(player) },
        }
        .invoke_signed(&[room_seeds, view_seeds])?;
        Ok(())
    }

    /// Lobby presence: seated browsers ping every few seconds so abandoned
    /// seats can be reclaimed and an absent host replaced.
    pub fn heartbeat(ctx: Context<Heartbeat>) -> Result<()> {
        let slot = Clock::get()?.slot;
        let mut room = ctx.accounts.room.load_mut()?;
        let seat = room.seat_of(&ctx.accounts.player.key()).ok_or(BlackoutError::NotSeated)?;
        room.last_seen[seat] = slot as u32;
        room.fix_host(slot);
        Ok(())
    }

    pub fn leave(ctx: Context<Leave>, seat: u8) -> Result<()> {
        let s = seat as usize;
        let player = ctx.accounts.player.key();
        let rid_bytes = {
            let mut room = ctx.accounts.room.load_mut()?;
            require!(room.status == ST_LOBBY, BlackoutError::NotInLobby);
            require!(s < MAXP && room.players[s] == player, BlackoutError::BadSeat);
            room.clear_seat(s);
            let slot = Clock::get()?.slot;
            room.fix_host(slot);
            room.room_id.to_le_bytes()
        };
        let room_seeds: &[&[u8]] = &[ROOM_SEED, &rid_bytes, &[ctx.bumps.room]];
        let view_seeds: &[&[u8]] = &[VIEW_SEED, &rid_bytes, &[seat], &[ctx.bumps.view]];
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.room.to_account_info(),
            permissioned_account: ctx.accounts.view.to_account_info(),
            permission: ctx.accounts.view_permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.view.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs { is_private: true, members: vec![] },
        }
        .invoke_signed(&[room_seeds, view_seeds])?;
        Ok(())
    }

    /// Fill empty seats with bots, request the VRF seed and start the 20 Hz crank.
    pub fn start_match<'info>(ctx: Context<'info, StartMatch<'info>>, fill_to: u8, client_seed: u8) -> Result<()> {
        let player = ctx.accounts.payer.key();
        let slot = Clock::get()?.slot;
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
            room.fix_host(slot);
            require!(room.host == player, BlackoutError::NotHost);
            // bots fill free seats (free rooms only)
            let humans = (0..MAXP).filter(|&i| room.players[i] != Pubkey::default() && room.is_bot[i] == 0).count();
            let mut total = humans;
            if room.stake == 0 {
                let want = (fill_to as usize).min(MAXP);
                for i in 0..MAXP {
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
            }
            require!(total >= 2, BlackoutError::NotEnoughPlayers);
            room.n_bots = (0..MAXP).filter(|&i| room.is_bot[i] == 1).count() as u32;
            room.match_no += 1;
            room.status = ST_STARTING;
            room.start_slot = slot;
            room.last_tick_slot = 0;
            room.seed_revealed = 0;
            room.task_id = (room.room_id % 1_000_000) * 10_000 + (room.match_no as u64 % 10_000);
            room.task_id
        };

        // 1. VRF: every random roll of the match comes from this seed
        let ix = create_request_high_priority_scoped_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: crate::ID,
            callback_discriminator: instruction::OnSeed::DISCRIMINATOR.to_vec(),
            caller_seed: [client_seed; 32],
            accounts_metas: Some(vec![
                SerializableAccountMeta { pubkey: ctx.accounts.room.key(), is_signer: false, is_writable: true },
                SerializableAccountMeta { pubkey: ctx.accounts.world.key(), is_signer: false, is_writable: true },
            ]),
            ..Default::default()
        });
        ctx.accounts.invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;

        // 2. crank: tick every 50 ms inside the TEE, no server anywhere
        let mut metas = vec![
            AccountMeta::new(ctx.accounts.room.key(), false),
            AccountMeta::new(ctx.accounts.world.key(), false),
        ];
        require!(ctx.remaining_accounts.len() >= MAXP + REC_CHUNKS, BlackoutError::BadAccount);
        for v in ctx.remaining_accounts.iter().take(MAXP + REC_CHUNKS) {
            metas.push(AccountMeta::new(v.key(), false));
        }
        let mut cu = vec![2u8];
        cu.extend_from_slice(&1_400_000u32.to_le_bytes());
        let budget_ix = Instruction { program_id: COMPUTE_BUDGET_PROGRAM, accounts: vec![], data: cu };
        let tick_ix = Instruction {
            program_id: crate::ID,
            accounts: metas,
            data: anchor_lang::InstructionData::data(&crate::instruction::Tick {}),
        };
        let mut accs = vec![ctx.accounts.room.to_account_info(), ctx.accounts.world.to_account_info()];
        for v in ctx.remaining_accounts.iter().take(MAXP + REC_CHUNKS) {
            accs.push(v.clone());
        }
        ScheduleCrankCpi {
            payer: &ctx.accounts.payer,
            magic_program: &ctx.accounts.magic_program,
            instruction_accounts: &accs,
            args: ScheduleTaskArgs {
                task_id: task_id as i64,
                execution_interval_millis: TICK_MS,
                iterations: TICK_ITERATIONS,
                instructions: vec![budget_ix, tick_ix],
            },
        }
        .invoke()?;
        Ok(())
    }

    /// VRF callback — seeds spawns, loot and the zone, sealed inside World.
    pub fn on_seed(ctx: Context<OnSeed>, randomness: [u8; 32]) -> Result<()> {
        let mut room = ctx.accounts.room.load_mut()?;
        if room.status != ST_STARTING {
            return Ok(());
        }
        let rid = room.room_id;
        let mut d = ctx.accounts.world.try_borrow_mut_data()?;
        let w: &mut World = world_mut(&mut d, rid)?;
        sim::seed_match(&mut room, w, randomness);
        room.seed_revealed = 0;
        Ok(())
    }

    /// If the VRF oracle doesn't answer within ~5 s, any seated player can
    /// seed from ER state instead (flagged in the room so the UI can say so).
    pub fn fallback_seed(ctx: Context<FallbackSeed>) -> Result<()> {
        let slot = Clock::get()?.slot;
        let mut room = ctx.accounts.room.load_mut()?;
        require!(room.status == ST_STARTING, BlackoutError::NotStarting);
        require!(slot > room.start_slot + 500, BlackoutError::TooEarly);
        require!(room.seat_of(&ctx.accounts.payer.key()).is_some(), BlackoutError::NotSeated);
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

    // ======================================================== ER: play

    /// Player input. Hidden: it only touches the private World.
    pub fn input(ctx: Context<Input>, dx: i8, dy: i8, aim: u16, buttons: u8, seq: u32) -> Result<()> {
        let room = ctx.accounts.room.load()?;
        let seat = room.seat_of(&ctx.accounts.player.key()).ok_or(BlackoutError::NotSeated)?;
        let rid = room.room_id;
        drop(room);
        let mut d = ctx.accounts.world.try_borrow_mut_data()?;
        let w: &mut World = world_mut(&mut d, rid)?;
        let tick = w.tick;
        let p = &mut w.players[seat];
        p.in_dx = dx as i32;
        p.in_dy = dy as i32;
        p.aim = aim as u32;
        p.buttons = buttons as u32;
        p.in_seq = seq;
        p.last_input_tick = tick;
        Ok(())
    }

    /// One 50 ms simulation step. Called by the crank (or any client as a
    /// fallback — the slot gate stops double-ticking).
    pub fn tick<'info>(ctx: Context<'info, Tick<'info>>) -> Result<()> {
        let slot = Clock::get()?.slot;
        let mut room = ctx.accounts.room.load_mut()?;
        if room.status != ST_COUNTDOWN && room.status != ST_LIVE {
            return Ok(());
        }
        if room.last_tick_slot != 0 && slot < room.last_tick_slot + MIN_TICK_SLOTS {
            return Ok(());
        }
        room.last_tick_slot = slot;
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

    /// Lights on. Flip World + Recorder to public, then commit the room to
    /// Solana with a Magic Action that pays the pot and updates the board.
    pub fn finish<'info>(ctx: Context<'info, Finish<'info>>) -> Result<()> {
        let (rid_bytes, winner_key) = {
            let mut room = ctx.accounts.room.load_mut()?;
            require!(room.status == ST_ENDED, BlackoutError::NotEnded);
            room.status = ST_REVEALED;
            room.seed_revealed = if room.seed_revealed == 2 { 2 } else { 1 };
            let wk = if room.winner != NO_SEAT { room.payout[room.winner as usize] } else { Pubkey::default() };
            (room.room_id.to_le_bytes(), wk)
        };
        let room_seeds: &[&[u8]] = &[ROOM_SEED, &rid_bytes, &[ctx.bumps.room]];
        let world_seeds: &[&[u8]] = &[WORLD_SEED, &rid_bytes, &[ctx.bumps.world]];
        let room_ai = ctx.accounts.room.to_account_info();
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
        )?;
        let _ = world_seeds;
        if winner_key != Pubkey::default() {
            require_keys_eq!(ctx.accounts.winner.key(), winner_key, BlackoutError::BadAccount);
        }

        // commit + post-commit settle action on Solana
        let action = CallHandler {
            destination_program: crate::ID,
            accounts: vec![
                ShortAccountMeta { pubkey: ctx.accounts.board.key().to_bytes().into(), is_writable: true },
                ShortAccountMeta { pubkey: ctx.accounts.bank.key().to_bytes().into(), is_writable: true },
                ShortAccountMeta { pubkey: ctx.accounts.room.key().to_bytes().into(), is_writable: false },
                ShortAccountMeta { pubkey: ctx.accounts.winner.key().to_bytes().into(), is_writable: true },
            ],
            args: ActionArgs::new(anchor_lang::InstructionData::data(&crate::instruction::Settle {})),
            escrow_authority: room_ai.clone(),
            compute_units: 200_000,
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
    pub fn reset<'info>(ctx: Context<'info, Reset<'info>>) -> Result<()> {
        let (rid_bytes, staked) = {
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
            let staked = room.stake > 0;
            if staked {
                // staked seats must buy a new ticket for the next match
                for i in 0..MAXP {
                    room.players[i] = Pubkey::default();
                    room.payout[i] = Pubkey::default();
                    room.names[i] = [0; 16];
                }
                room.n_players = 0;
                room.host = Pubkey::default();
            }
            (room.room_id.to_le_bytes(), staked)
        };
        let _ = staked;
        let room_seeds: &[&[u8]] = &[ROOM_SEED, &rid_bytes, &[ctx.bumps.room]];
        let world_seeds: &[&[u8]] = &[WORLD_SEED, &rid_bytes, &[ctx.bumps.world]];
        let room_ai = ctx.accounts.room.to_account_info();
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
        )?;
        let _ = world_seeds;
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
                room.fix_host(slot);
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
}

/// Flip World + all recorder chunks between sealed (private, no members) and public.
/// `rest` = [rec0, perm0, rec1, perm1, ... rec4, perm4].
#[allow(clippy::too_many_arguments)]
fn set_sealed<'info>(
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
    flip(world, world_perm, &[WORLD_SEED, rid, &[world_bump]])?;
    for c in 0..REC_CHUNKS {
        let acc = &rest[c * 2];
        let perm = &rest[c * 2 + 1];
        let (key, bump) = Pubkey::find_program_address(&[REC_SEED, rid, &[c as u8]], &crate::ID);
        require_keys_eq!(acc.key(), key, BlackoutError::BadAccount);
        flip(acc, perm, &[REC_SEED, rid, &[c as u8], &[bump]])?;
    }
    Ok(())
}

pub const BOT_NAMES: [&str; 8] = ["SHADE", "NYX", "WRAITH", "UMBRA", "HUSH", "GLOOM", "VESPER", "DUSK"];

fn world_mut(d: &mut [u8], room_id: u64) -> Result<&mut World> {
    require!(d.len() >= WORLD_LEN, BlackoutError::BadAccount);
    let w: &mut World = bytemuck::from_bytes_mut(&mut d[..WORLD_LEN]);
    let (lo, hi) = room_key_parts(room_id);
    require!(w.magic == WORLD_MAGIC && w.room_lo == lo && w.room_hi == hi, BlackoutError::BadAccount);
    Ok(w)
}

// ============================================================ contexts

#[derive(Accounts)]
pub struct InitBoard<'info> {
    #[account(init, payer = payer, space = 8 + core::mem::size_of::<Board>(), seeds = [BOARD_SEED], bump)]
    pub board: AccountLoader<'info, Board>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(room_id: u64)]
pub struct CreateRoom<'info> {
    #[account(init, payer = payer, space = 8 + core::mem::size_of::<Room>(), seeds = [ROOM_SEED, &room_id.to_le_bytes()], bump)]
    pub room: AccountLoader<'info, Room>,
    #[account(init, payer = payer, space = 8 + 8 + 4 + 1, seeds = [BANK_SEED, &room_id.to_le_bytes()], bump)]
    pub bank: Account<'info, Bank>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(room_id: u64)]
pub struct DelegateRoom<'info> {
    /// CHECK: the room PDA
    #[account(mut, del, seeds = [ROOM_SEED, &room_id.to_le_bytes()], bump)]
    pub pda: UncheckedAccount<'info>,
    pub payer: Signer<'info>,
    /// CHECK: TEE validator identity
    pub validator: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
#[instruction(room_id: u64, match_no: u32)]
pub struct BuyTicket<'info> {
    /// CHECK: room PDA (delegated: owned by the delegation program on base)
    #[account(seeds = [ROOM_SEED, &room_id.to_le_bytes()], bump)]
    pub room: UncheckedAccount<'info>,
    #[account(mut, seeds = [BANK_SEED, &room_id.to_le_bytes()], bump = bank.bump)]
    pub bank: Account<'info, Bank>,
    #[account(
        init,
        payer = player,
        space = 8 + 8 + 4 + 32 + 32 + 8,
        seeds = [TICKET_SEED, &room_id.to_le_bytes(), &match_no.to_le_bytes(), player.key().as_ref()],
        bump
    )]
    pub ticket: Account<'info, Ticket>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[action]
#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut, seeds = [BOARD_SEED], bump)]
    pub board: AccountLoader<'info, Board>,
    #[account(mut)]
    pub bank: Account<'info, Bank>,
    /// CHECK: room as committed by the ER; must be the bank's room PDA
    #[account(seeds = [ROOM_SEED, &bank.room_id.to_le_bytes()], bump)]
    pub room: UncheckedAccount<'info>,
    /// CHECK: verified against room.payout[winner]
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,
    /// CHECK: escrow authority / escrow pair, verified in the handler (order-agnostic)
    pub escrow_auth: UncheckedAccount<'info>,
    /// CHECK: see above
    pub escrow: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SetupCore<'info> {
    #[account(mut, seeds = [ROOM_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: ephemeral World PDA
    #[account(mut, seeds = [WORLD_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub world: UncheckedAccount<'info>,
    /// CHECK: permission program checks
    #[account(mut)]
    pub world_permission: UncheckedAccount<'info>,
    /// CHECK: permission program checks
    #[account(mut)]
    pub room_permission: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
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

#[derive(Accounts)]
#[instruction(chunk: u8)]
pub struct SetupRec<'info> {
    #[account(mut, seeds = [ROOM_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: ephemeral recorder chunk PDA
    #[account(mut, seeds = [REC_SEED, &room.load()?.room_id.to_le_bytes(), &[chunk]], bump)]
    pub rec: UncheckedAccount<'info>,
    /// CHECK: permission program checks
    #[account(mut)]
    pub rec_permission: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
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

#[derive(Accounts)]
#[instruction(seat: u8)]
pub struct SetupView<'info> {
    #[account(mut, seeds = [ROOM_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: ephemeral View PDA
    #[account(mut, seeds = [VIEW_SEED, &room.load()?.room_id.to_le_bytes(), &[seat]], bump)]
    pub view: UncheckedAccount<'info>,
    /// CHECK: permission program checks
    #[account(mut)]
    pub view_permission: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
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

#[derive(Accounts)]
#[instruction(seat: u8)]
pub struct Join<'info> {
    #[account(mut, seeds = [ROOM_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: ephemeral View PDA
    #[account(mut, seeds = [VIEW_SEED, &room.load()?.room_id.to_le_bytes(), &[seat]], bump)]
    pub view: UncheckedAccount<'info>,
    /// CHECK: permission program checks
    #[account(mut)]
    pub view_permission: UncheckedAccount<'info>,
    #[account(mut)]
    pub player: Signer<'info>,
    /// CHECK: staked rooms only — verified in the handler
    pub ticket: Option<UncheckedAccount<'info>>,
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

#[derive(Accounts)]
pub struct Heartbeat<'info> {
    pub player: Signer<'info>,
    #[account(mut)]
    pub room: AccountLoader<'info, Room>,
}

#[derive(Accounts)]
#[instruction(seat: u8)]
pub struct Leave<'info> {
    #[account(mut, seeds = [ROOM_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: ephemeral View PDA
    #[account(mut, seeds = [VIEW_SEED, &room.load()?.room_id.to_le_bytes(), &[seat]], bump)]
    pub view: UncheckedAccount<'info>,
    /// CHECK: permission program checks
    #[account(mut)]
    pub view_permission: UncheckedAccount<'info>,
    #[account(mut)]
    pub player: Signer<'info>,
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
    /// CHECK: validator fee vault, pays commits for the delegated room PDA
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

#[error_code]
pub enum BlackoutError {
    #[msg("Bad account")]
    BadAccount,
    #[msg("Bad seat")]
    BadSeat,
    #[msg("Room is not in the lobby")]
    NotInLobby,
    #[msg("Wrong room code")]
    WrongCode,
    #[msg("Already seated")]
    AlreadySeated,
    #[msg("Seat taken")]
    SeatTaken,
    #[msg("This room needs a ticket")]
    NeedTicket,
    #[msg("Room is not staked")]
    NotStaked,
    #[msg("Not seated in this room")]
    NotSeated,
    #[msg("Only the host can start")]
    NotHost,
    #[msg("Need at least 2 players")]
    NotEnoughPlayers,
    #[msg("Match is not waiting for a seed")]
    NotStarting,
    #[msg("Too early")]
    TooEarly,
    #[msg("Match has not ended")]
    NotEnded,
    #[msg("Room setup is not finished")]
    NotReady,
}
