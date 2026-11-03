//! The daily challenge. Once a day anyone can roll a VRF seed into a sealed account; every
//! daily night that day is played on it (same map, loot, zone, modifier and bots), solo
//! against three bots, one try per wallet. The board lives in the rollup, so it costs nothing.
use anchor_lang::prelude::*;

use crate::error::BlackoutError;
use crate::sim;
use crate::state::*;
use ephemeral_rollups_sdk::access_control::instructions::CreateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::EphemeralMembersArgs;
use ephemeral_rollups_sdk::anchor::{vrf, vrf_callback};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::ephemeral_accounts::EphemeralAccount;
use ephemeral_rollups_sdk::vrf::instructions::{create_request_high_priority_scoped_randomness_ix, RequestRandomnessParams};
use ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta;

use super::night::{begin_match, fill_bots, schedule_ticks, world_mut};

/// Days since 1970, UTC.
fn today() -> Result<u32> {
    Ok((Clock::get()?.unix_timestamp / 86_400) as u32)
}

fn secret_mut(d: &mut [u8]) -> Result<&mut DailySecret> {
    require!(d.len() >= DAILY_SECRET_LEN, BlackoutError::BadAccount);
    let s: &mut DailySecret = bytemuck::from_bytes_mut(&mut d[..DAILY_SECRET_LEN]);
    require!(s.magic == DAILY_SECRET_MAGIC, BlackoutError::BadAccount);
    Ok(s)
}

/// The three filter bits for a wallet on a day (splitmix64 over the key and the day).
fn bloom_bits(wallet: &Pubkey, day: u32) -> [usize; 3] {
    let mix = |mut x: u64| {
        x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        x ^ (x >> 31)
    };
    let mut h = mix(day as u64 ^ 0x9E37_79B9_7F4A_7C15);
    for c in wallet.as_ref().chunks(8) {
        h = mix(h ^ u64::from_le_bytes(c.try_into().unwrap_or([0; 8])));
    }
    let bit = |k: u32| ((h >> (k * 21)) as usize) % (DAILY_BLOOM_WORDS * 32);
    [bit(0), bit(1), bit(2)]
}

// ---------------------------------------------------------------- rollup

/// Anyone, once a day: ask the VRF oracle for today's seed.
/// Create the sealed seed account and the board's public permission (first roll only).
fn setup(ctx: &Context<RollDaily>) -> Result<()> {
    let a = &ctx.accounts;
    let daily_seeds: &[&[u8]] = &[DAILY_SEED, &[ctx.bumps.daily]];
    let secret_seeds: &[&[u8]] = &[DAILY_SECRET_SEED, &[ctx.bumps.secret]];
    let daily_ai = a.daily.to_account_info();
    let secret = a.secret.to_account_info();
    let vault = a.ephemeral_vault.to_account_info();
    if secret.data_is_empty() {
        EphemeralAccount::new(&daily_ai, &secret, &vault)
            .with_signer_seeds(&[daily_seeds, secret_seeds])
            .create(DAILY_SECRET_LEN as u32)?;
        let mut d = secret.try_borrow_mut_data()?;
        let s: &mut DailySecret = bytemuck::from_bytes_mut(&mut d[..DAILY_SECRET_LEN]);
        s.magic = DAILY_SECRET_MAGIC;
    }
    let perms: [(AccountInfo, AccountInfo, bool, &[&[u8]]); 2] = [
        (secret.clone(), a.secret_permission.to_account_info(), true, secret_seeds),
        (daily_ai.clone(), a.daily_permission.to_account_info(), false, daily_seeds),
    ];
    for (acc, perm, private, seeds) in perms {
        if perm.data_is_empty() {
            CreateEphemeralPermissionCpi {
                payer: daily_ai.clone(),
                permissioned_account: acc,
                permission: perm,
                vault: vault.clone(),
                magic_program: a.magic_program.to_account_info(),
                permission_program: a.permission_program.to_account_info(),
                args: EphemeralMembersArgs { is_private: private, members: vec![] },
            }
            .invoke_signed(&[daily_seeds, seeds])?;
        }
    }
    a.daily.load_mut()?.ready = 3;
    Ok(())
}

/// Anyone, once a day: ask the VRF oracle for today's seed.
/// The first call also creates the sealed seed account and the board's public permission.
pub fn handle_roll_daily(ctx: Context<RollDaily>, client_seed: u8) -> Result<()> {
    let day = today()?;
    let slot = Clock::get()?.slot;
    if ctx.accounts.daily.load()?.ready != 3 {
        setup(&ctx)?;
    }
    {
        let mut daily = ctx.accounts.daily.load_mut()?;
        require!(daily.day != day, BlackoutError::NotStarting);
        // one roll in flight at a time; a lost one can be retried after ~30 s
        require!(daily.pending_day != day || slot > daily.pending_slot + 3000, BlackoutError::TooEarly);
        daily.pending_day = day;
        daily.pending_slot = slot;
    }
    let ix = create_request_high_priority_scoped_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.payer.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::OnDailySeed::DISCRIMINATOR.to_vec(),
        caller_seed: [client_seed; 32],
        accounts_metas: Some(vec![
            SerializableAccountMeta { pubkey: ctx.accounts.daily.key(), is_signer: false, is_writable: true },
            SerializableAccountMeta { pubkey: ctx.accounts.secret.key(), is_signer: false, is_writable: true },
        ]),
        ..Default::default()
    });
    ctx.accounts.invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
    Ok(())
}

/// VRF callback: today's seed goes into the sealed account, yesterday's is published.
pub fn handle_on_daily_seed(ctx: Context<OnDailySeed>, randomness: [u8; 32]) -> Result<()> {
    let mut daily = ctx.accounts.daily.load_mut()?;
    let day = daily.pending_day;
    if day == 0 || day == daily.day {
        return Ok(());
    }
    let mut d = ctx.accounts.secret.try_borrow_mut_data()?;
    let s = secret_mut(&mut d)?;
    if s.day != 0 {
        daily.prev_day = s.day;
        daily.prev_seed = s.seed;
    }
    s.day = day;
    s.seed = randomness;
    daily.day = day;
    daily.pending_day = 0;
    daily.count = 0;
    daily.tried = [0; DAILY_BLOOM_WORDS];
    daily.entries = [DailyEntry { key: Pubkey::default(), name: [0; 16], score: 0, kills: 0, place: 0, survived: 0 }; DAILY_SLOTS];
    Ok(())
}

/// Start today's daily in a room you just claimed: you in seat 0, three bots, today's seed.
/// The wallet signs too: it's who the score belongs to, and it gets one try a day.
pub fn handle_start_daily<'info>(ctx: Context<'info, StartDaily<'info>>) -> Result<()> {
    let player = ctx.accounts.payer.key();
    let wallet = ctx.accounts.wallet.key();
    let slot = Clock::get()?.slot;
    let day = today()?;
    // a real wallet, not the in-browser session key (which anyone can mint for free)
    require_keys_neq!(wallet, player, BlackoutError::BadAccount);
    let seed = {
        let mut daily = ctx.accounts.daily.load_mut()?;
        let mut d = ctx.accounts.secret.try_borrow_mut_data()?;
        let s = secret_mut(&mut d)?;
        require!(daily.day == day && s.day == day, BlackoutError::DailyNotReady);
        let bits = bloom_bits(&wallet, day);
        require!(!bits.iter().all(|&b| daily.tried[b / 32] & (1 << (b % 32)) != 0), BlackoutError::DailyPlayed);
        for b in bits {
            daily.tried[b / 32] |= 1 << (b % 32);
        }
        s.seed
    };
    let (task_id, rid) = {
        let mut room = ctx.accounts.room.load_mut()?;
        require!(room.status == ST_LOBBY && room.stake == 0, BlackoutError::NotInLobby);
        require!(room.host == player && room.host_present(slot), BlackoutError::NotHost);
        // solo: you in seat 0 and nobody else
        let humans = (0..MAXP).filter(|&i| room.players[i] != Pubkey::default() && room.is_bot[i] == 0).count();
        require!(room.seat_of(&player) == Some(0) && humans == 1, BlackoutError::BadSeat);
        // the same table for everyone: 4 seats, medium bots, solo, no host controls mid-night
        room.cfg = DAILY_SEATS as u32 | (room.cfg & (1 << 8)) | sim::CFG_DAILY;
        room.payout[0] = wallet;
        room.stake_deadline = day as i64; // free rooms don't use it: the day this night counts for
        fill_bots(&mut room, DAILY_SEATS);
        (begin_match(&mut room, slot, ST_STARTING), room.room_id)
    };
    {
        let mut room = ctx.accounts.room.load_mut()?;
        let mut wd = ctx.accounts.world.try_borrow_mut_data()?;
        let w = world_mut(&mut wd, rid)?;
        sim::seed_match(&mut room, w, seed);
    }
    schedule_ticks(&ctx.accounts.payer, &ctx.accounts.magic_program, &ctx.accounts.room.to_account_info(), &ctx.accounts.world.to_account_info(), ctx.remaining_accounts, task_id)
}

/// Called by `finish` for a daily night: put seat 0's score on the board.
pub fn post_score<'info>(daily_ai: &'info AccountInfo<'info>, room: &Room) -> Result<()> {
    let (key, _) = Pubkey::find_program_address(&[DAILY_SEED], &crate::ID);
    require_keys_eq!(*daily_ai.key, key, BlackoutError::BadAccount);
    let loader = AccountLoader::<Daily>::try_from(daily_ai)?;
    let mut daily = loader.load_mut()?;
    // a night that ran past midnight counts for the day it was played, which has no board any more
    if daily.day as i64 != room.stake_deadline {
        return Ok(());
    }
    let s = daily_score(room);
    let entry = DailyEntry { key: room.payout[0], name: room.names[0], score: s.0, kills: room.kills[0], place: s.1, survived: s.2 };
    let n = daily.count as usize;
    if n < DAILY_SLOTS {
        daily.entries[n] = entry;
        daily.count += 1;
    } else if let Some((i, low)) = daily.entries.iter().enumerate().min_by_key(|(_, e)| e.score).map(|(i, e)| (i, e.score)) {
        if s.0 > low {
            daily.entries[i] = entry;
        }
    }
    Ok(())
}

/// (score, place, seconds survived) for seat 0. If the night ended because you went idle,
/// surviving doesn't win the tie-break: you rank last among the survivors.
pub fn daily_score(room: &Room) -> (u32, u32, u32) {
    let t_end = room.end_tick.saturating_sub(sim::COUNTDOWN_TICKS);
    let fair_end = room.alive_count <= 1 || t_end >= room.match_ticks();
    let place = if room.alive[0] != 0 && !fair_end { room.alive_count.max(1) } else { room.place[0].max(1) };
    let died = (0..(room.feed_head as usize).min(FEED)).map(|i| room.feed[i]).find(|e| e.victim == 0).map(|e| e.tick);
    let survived = died.unwrap_or(room.end_tick).saturating_sub(sim::COUNTDOWN_TICKS) / 20;
    let place_pts = (DAILY_SEATS as u32 + 1).saturating_sub(place) * 250;
    (place_pts + room.kills[0] * 300 + survived.min(300) * 2, place, survived)
}

// ---------------------------------------------------------------- accounts

#[vrf]
#[derive(Accounts)]
pub struct RollDaily<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [DAILY_SEED], bump)]
    pub daily: AccountLoader<'info, Daily>,
    /// CHECK: the sealed seed PDA (created by the first roll)
    #[account(mut, seeds = [DAILY_SECRET_SEED], bump)]
    pub secret: UncheckedAccount<'info>,
    /// CHECK: VRF ephemeral queue
    #[account(mut, address = ephemeral_rollups_sdk::vrf::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
    /// CHECK: permission program checks
    #[account(mut)]
    pub secret_permission: UncheckedAccount<'info>,
    /// CHECK: permission program checks
    #[account(mut)]
    pub daily_permission: UncheckedAccount<'info>,
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

#[vrf_callback]
#[derive(Accounts)]
pub struct OnDailySeed<'info> {
    #[account(mut, seeds = [DAILY_SEED], bump)]
    pub daily: AccountLoader<'info, Daily>,
    /// CHECK: the sealed seed PDA, checked by its magic
    #[account(mut, seeds = [DAILY_SECRET_SEED], bump)]
    pub secret: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct StartDaily<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// the wallet this try (and its score) belongs to
    pub wallet: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub room: AccountLoader<'info, Room>,
    /// CHECK: ephemeral World PDA
    #[account(mut, seeds = [WORLD_SEED, &room.load()?.room_id.to_le_bytes()], bump)]
    pub world: UncheckedAccount<'info>,
    #[account(mut, seeds = [DAILY_SEED], bump)]
    pub daily: AccountLoader<'info, Daily>,
    /// CHECK: the sealed seed PDA, checked by its magic
    #[account(mut, seeds = [DAILY_SECRET_SEED], bump)]
    pub secret: UncheckedAccount<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    // remaining accounts: view0..view7, rec0..rec4 (writable)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ended(alive0: u32, alive_count: u32, end_tick: u32, place0: u32, kills0: u32) -> Room {
        let mut r: Room = bytemuck::Zeroable::zeroed();
        r.alive[0] = alive0;
        r.alive_count = alive_count;
        r.end_tick = end_tick;
        r.place[0] = place0;
        r.kills[0] = kills0;
        r
    }

    #[test]
    fn going_idle_never_wins_the_daily() {
        // everyone still standing after 15 s, the night ended because you stopped playing
        let (_, place, _) = daily_score(&ended(1, 4, 360, 1, 0));
        assert_eq!(place, 4, "idle survivor ranks last of the survivors, not first");
    }

    #[test]
    fn a_real_win_scores_highest() {
        let (win, p1, _) = daily_score(&ended(1, 1, 3000, 1, 3));
        assert_eq!(p1, 1);
        let mut died = ended(0, 2, 3000, 3, 1);
        died.feed[0] = KillEvent { tick: 1260, killer: 1, victim: 0, weapon: 0 };
        died.feed_head = 1;
        let (lost, p3, secs) = daily_score(&died);
        assert_eq!((p3, secs), (3, 60));
        assert!(win > lost);
        assert_eq!(win, 4 * 250 + 3 * 300 + (3000 - 60) / 20 * 2);
    }

    #[test]
    fn one_try_per_wallet_per_day() {
        let w = Pubkey::new_from_array([9; 32]);
        assert_eq!(bloom_bits(&w, 20000), bloom_bits(&w, 20000));
        assert_ne!(bloom_bits(&w, 20000), bloom_bits(&w, 20001), "a new day is a new try");
        assert!(bloom_bits(&w, 20000).iter().all(|&b| b < DAILY_BLOOM_WORDS * 32));
    }
}
