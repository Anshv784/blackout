use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

use crate::config::{STAKED_MAX_WAIT_SECS, STAKED_START_WAIT_SECS};

pub const MAXP: usize = 8;
pub const MAXB: usize = 32;
pub const MAXL: usize = 12;
pub const VIS_P: usize = 7;
pub const VIS_B: usize = 16;
pub const VIS_L: usize = 12;
pub const PINGS: usize = 12;
pub const FEED: usize = 16;
pub const REC_CHUNKS: usize = 5;
pub const REC_CHUNK_LEN: usize = 10_240;
pub const REC_PER_CHUNK: usize = (REC_CHUNK_LEN - 32) / (MAXP * 4); // 319 frames
pub const REC_FRAMES: usize = REC_PER_CHUNK * REC_CHUNKS;

pub const ROOM_SEED: &[u8] = b"room";
pub const WORLD_SEED: &[u8] = b"world";
pub const VIEW_SEED: &[u8] = b"view";
pub const REC_SEED: &[u8] = b"rec";
pub const BANK_SEED: &[u8] = b"bank";
pub const TICKET_SEED: &[u8] = b"ticket";
pub const BOARD_SEED: &[u8] = b"board3"; // staked nights only
pub const DAILY_SEED: &[u8] = b"daily";
pub const PRIZE_SEED: &[u8] = b"prize";
pub const DAILY_SECRET_SEED: &[u8] = b"daily-seed";
pub const DAILY_SLOTS: usize = 32;
/// One-try-per-wallet filter: 4096 bits, 3 hashes. Wrongly says "already played" for about
/// 1 in 400 players at 200 players a day.
pub const DAILY_BLOOM_WORDS: usize = 128;
/// Daily nights are 4 seats: you and three bots.
pub const DAILY_SEATS: usize = 4;
pub const BOARD_SLOTS: usize = 64;
/// wallets the daily prize can track in one day (more than that and late arrivals aren't counted)
pub const PRIZE_SLOTS: usize = 100;

pub const BOT_EASY: u32 = 1;
pub const BOT_HARD: u32 = 2;

// Room status
pub const ST_LOBBY: u32 = 0;
pub const ST_STARTING: u32 = 1; // waiting for VRF seed
pub const ST_COUNTDOWN: u32 = 2;
pub const ST_LIVE: u32 = 3;
pub const ST_ENDED: u32 = 4;
pub const ST_REVEALED: u32 = 5;

pub const NO_SEAT: u32 = 255;
/// ~45 s of ER slots (10 ms each) without a heartbeat = abandoned seat
pub const STALE_SLOTS: u32 = 4500;

/// Public lobby + scoreboard. Readable by anyone holding a TEE auth token.
/// Holds nothing that would leak a hidden position.
#[account(zero_copy)]
#[repr(C)]
pub struct Room {
    pub room_id: u64,
    pub stake: u64,          // lamports per seat (0 = free)
    pub pot: u64,            // lamports in the pot for the current match
    /// ER slot when the match went live. In a staked lobby (where it is otherwise unused) it holds
    /// the unix time after which the table may start: 0 until two stakers are seated, pushed back
    /// by every new staker. See `arm_staked_start` / `staked_start_ok`.
    pub start_slot: u64,
    pub last_tick_slot: u64, // ER slot of the last simulation step
    pub task_id: u64,        // crank task driving this match
    pub host: Pubkey,
    pub players: [Pubkey; MAXP], // in-game identity (session key), default = empty
    pub payout: [Pubkey; MAXP],  // wallet credited on the leaderboard / paid the pot
    pub names: [[u8; 16]; MAXP],
    pub status: u32,
    pub match_no: u32,
    pub tick: u32,
    pub end_tick: u32,
    pub n_players: u32,
    pub n_bots: u32,
    pub is_bot: [u32; MAXP],
    pub alive: [u32; MAXP],
    pub kills: [u32; MAXP],
    pub place: [u32; MAXP], // 1 = winner
    pub winner: u32,
    pub alive_count: u32,
    pub feed_head: u32,
    pub feed: [KillEvent; FEED],
    // zone (public by design — everybody sees the circle)
    pub zone_x: i32,
    pub zone_y: i32,
    pub zone_r: i32,
    pub next_x: i32,
    pub next_y: i32,
    pub next_r: i32,
    pub zone_phase: u32,
    pub private_code: u32, // 0 = public room
    pub seed_revealed: u32,
    /// room config set by its creator: bits 0-7 = seats (2..8, 0 = 8), bit 8 = unlisted, bits 9-10 = bot level, bits 13-15 = night modifier, bit 16 = duos
    pub cfg: u32,
    pub ready_mask: u32,
    pub last_seen: [u32; MAXP], // ER slot (truncated) of each seat's last lobby heartbeat
    pub stake_deadline: i64,    // earliest ticket expiry among those seated (staked rooms)
}

impl Room {
    pub fn seat_of(&self, key: &Pubkey) -> Option<usize> {
        if *key == Pubkey::default() {
            return None;
        }
        (0..MAXP).find(|&i| self.players[i] == *key && self.is_bot[i] == 0)
    }

    /// Humans in seats (a staked table never seats bots).
    pub fn humans(&self) -> usize {
        (0..MAXP).filter(|&i| self.players[i] != Pubkey::default() && self.is_bot[i] == 0).count()
    }

    /// A staked lobby has no host: once two stakers are seated a countdown runs. Only a seat count
    /// the lobby hasn't reached before (`joined`) starts it again, so leaving and sitting back down
    /// doesn't, and it never runs past STAKED_MAX_WAIT_SECS from the first countdown. Fewer than two
    /// seated: no countdown, and the cap starts over (so whoever sits down next still gets the full
    /// wait). With three or more seated, nobody can stall it by leaving and coming back.
    ///
    /// In a staked lobby `last_tick_slot` (unused until the night begins, which clears it) holds the
    /// first countdown's unix time (low 32 bits) and the most stakers seated so far (bits 32-39).
    pub fn arm_staked_start(&mut self, now: i64, joined: bool) {
        if self.stake == 0 || self.status != ST_LOBBY {
            return;
        }
        let n = self.humans();
        if n == 0 {
            self.start_slot = 0;
            self.last_tick_slot = 0;
            return;
        }
        let mut first = (self.last_tick_slot & 0xffff_ffff) as i64;
        let high = ((self.last_tick_slot >> 32) & 0xff) as usize;
        if n < 2 {
            self.start_slot = 0;
            self.last_tick_slot = (n as u64) << 32;
            return;
        } else {
            if first == 0 {
                first = now;
            }
            if (joined && n > high) || self.start_slot == 0 {
                let at = now.saturating_add(STAKED_START_WAIT_SECS).min(first.saturating_add(STAKED_MAX_WAIT_SECS));
                self.start_slot = at.max(0) as u64;
            }
        }
        self.last_tick_slot = (first.max(0) as u64 & 0xffff_ffff) | ((high.max(n) as u64 & 0xff) << 32);
    }

    /// May this staked table start now? A full table at once; otherwise two or more stakers and
    /// the countdown has run out.
    pub fn staked_start_ok(&self, now: i64) -> bool {
        let n = self.humans();
        n >= 2 && (n >= self.max_players() || (self.start_slot != 0 && now >= self.start_slot as i64))
    }

    pub fn max_players(&self) -> usize {
        let m = (self.cfg & 0xff) as usize;
        if m == 0 { MAXP } else { m.clamp(2, MAXP) }
    }

    pub fn live_humans(&self, slot: u64) -> usize {
        (0..MAXP).filter(|&i| self.is_bot[i] == 0 && self.players[i] != Pubkey::default() && !self.is_stale(i, slot)).count()
    }

    /// A human seat whose browser stopped sending lobby heartbeats.
    pub fn is_stale(&self, i: usize, slot: u64) -> bool {
        self.is_bot[i] == 0
            && self.players[i] != Pubkey::default()
            && (slot as u32).wrapping_sub(self.last_seen[i]) > STALE_SLOTS
    }

    pub fn clear_seat(&mut self, i: usize) {
        self.players[i] = Pubkey::default();
        self.payout[i] = Pubkey::default();
        self.names[i] = [0; 16];
        self.last_seen[i] = 0;
        self.n_players = self.n_players.saturating_sub(1);
    }

    /// Unseat every human and drop the host. Bots are handled separately by `reset`.
    pub fn clear_humans(&mut self) {
        for i in 0..MAXP {
            if self.players[i] != Pubkey::default() && self.is_bot[i] == 0 {
                self.clear_seat(i);
            }
        }
        self.host = Pubkey::default();
        self.sync_pot();
    }

    /// The pot on show: one stake per seated human, recounted rather than added up,
    /// so sitting down and standing up repeatedly can't inflate it.
    pub fn sync_pot(&mut self) {
        let seated = (0..MAXP).filter(|&i| self.players[i] != Pubkey::default() && self.is_bot[i] == 0).count();
        self.pot = self.stake.saturating_mul(seated as u64);
        if seated == 0 {
            self.stake_deadline = 0;
        }
    }

    /// Every night is 5:00.
    pub fn match_ticks(&self) -> u32 {
        6000
    }

    /// Recorder stride: as often as the fixed buffer allows for a full night.
    pub fn rec_every(&self) -> u32 {
        ((self.match_ticks() + 40) / REC_FRAMES as u32 + 1).max(2)
    }

    /// cfg bits 9-10: 0 = medium (default), 1 = easy, 2 = hard
    pub fn bot_level(&self) -> u32 {
        (self.cfg >> 9) & 3
    }

    pub fn host_present(&self, slot: u64) -> bool {
        self.seat_of(&self.host).map(|i| !self.is_stale(i, slot)).unwrap_or(false)
    }
}

#[zero_copy]
#[repr(C)]
pub struct KillEvent {
    pub tick: u32,
    pub killer: u32, // NO_SEAT = the zone
    pub victim: u32,
    pub weapon: u32,
}

/// The daily prize, on the base layer (never delegated). Settle of every night at a PRIZE_STAKE
/// table adds 2% of the pot and each staker's games, stake and winnings for the UTC day. When a
/// new day starts (the first settle or claim after midnight UTC), the day closes: the wallet with
/// the highest net profit (won - staked) among those with PRIZE_MIN_GAMES nights wins the pot and
/// can claim it until the next day closes. No winner, or not claimed by then: it goes to the
/// treasury. The account's lamports are its rent + `pot` + `last_prize` (while unclaimed).
#[account(zero_copy)]
#[repr(C)]
pub struct Prize {
    /// UTC day being counted (unix seconds / 86400); 0 before the first night
    pub day: u32,
    pub count: u32,
    /// lamports set aside for today so far
    pub pot: u64,
    pub last_day: u32,
    /// 1 once the last day's prize is paid (or there was none)
    pub last_claimed: u32,
    pub last_winner: Pubkey,
    pub last_prize: u64,
    pub entries: [PrizeEntry; PRIZE_SLOTS],
}

#[zero_copy]
#[repr(C)]
pub struct PrizeEntry {
    /// the staker's payout wallet (the same key the leaderboard uses)
    pub key: Pubkey,
    pub staked: u64,
    pub won: u64,
    pub games: u32,
    pub _pad: u32,
}

impl Prize {
    /// Net profit of an entry, in lamports.
    pub fn profit(e: &PrizeEntry) -> i128 {
        e.won as i128 - e.staked as i128
    }

    /// Today's leader among those who played enough nights: highest net profit, the earlier
    /// entry on a tie. None if nobody qualifies.
    pub fn leader(&self) -> Option<usize> {
        let mut best: Option<usize> = None;
        for i in 0..(self.count as usize).min(PRIZE_SLOTS) {
            let e = &self.entries[i];
            if e.games < crate::config::PRIZE_MIN_GAMES {
                continue;
            }
            if best.map_or(true, |b| Self::profit(e) > Self::profit(&self.entries[b])) {
                best = Some(i);
            }
        }
        best
    }

    /// Close the day if `today` is a new one. Returns the lamports that leave for the treasury:
    /// an unclaimed earlier prize, and today's pot if nobody qualified. The caller moves them.
    pub fn roll(&mut self, today: u32) -> u64 {
        if self.day == today {
            return 0;
        }
        let mut to_treasury = 0u64;
        if self.last_claimed == 0 {
            to_treasury = to_treasury.saturating_add(self.last_prize);
        }
        match self.leader() {
            Some(i) if self.day != 0 && self.pot > 0 => {
                self.last_winner = self.entries[i].key;
                self.last_prize = self.pot;
                self.last_claimed = 0;
            }
            _ => {
                to_treasury = to_treasury.saturating_add(self.pot);
                self.last_winner = Pubkey::default();
                self.last_prize = 0;
                self.last_claimed = 1;
            }
        }
        self.last_day = self.day;
        self.day = today;
        self.pot = 0;
        self.count = 0;
        self.entries = [PrizeEntry::zeroed(); PRIZE_SLOTS];
        to_treasury
    }

    /// The entry for `key`, added if there's room. None once the day's slots are full.
    pub fn entry_mut(&mut self, key: &Pubkey) -> Option<&mut PrizeEntry> {
        let n = (self.count as usize).min(PRIZE_SLOTS);
        if let Some(i) = self.entries[..n].iter().position(|e| e.key == *key) {
            return Some(&mut self.entries[i]);
        }
        if n < PRIZE_SLOTS {
            self.entries[n] = PrizeEntry { key: *key, ..PrizeEntry::zeroed() };
            self.count += 1;
            return Some(&mut self.entries[n]);
        }
        None
    }
}

/// Global leaderboard on the base layer: staked nights only, updated by a Magic Action after each one.
#[account(zero_copy)]
#[repr(C)]
pub struct Board {
    pub matches: u64,
    pub count: u32,
    pub _pad: u32,
    pub entries: [BoardEntry; BOARD_SLOTS],
}

#[zero_copy]
#[repr(C)]
pub struct BoardEntry {
    pub key: Pubkey,
    pub name: [u8; 16],
    pub wins: u32,
    pub kills: u32,
    pub games: u32,
    pub best_place: u32,
    /// lamports won from staked pots
    pub earned: u64,
}

/// The daily challenge's public board, delegated to the rollup so it costs nothing to update.
/// Today's seed lives in a separate sealed account; yesterday's is published here.
#[account(zero_copy)]
#[repr(C)]
pub struct Daily {
    pub day: u32, // days since 1970 (UTC) this board is for
    pub count: u32,
    pub pending_day: u32, // a seed roll in flight for this day
    pub ready: u32,       // setup done: bit 0 secret, bit 1 permission
    pub pending_slot: u64,
    pub prev_day: u32,
    pub _pad: u32,
    pub prev_seed: [u8; 32], // yesterday's seed, so anyone can re-derive yesterday's nights
    pub tried: [u32; DAILY_BLOOM_WORDS],
    pub entries: [DailyEntry; DAILY_SLOTS],
}

#[zero_copy]
#[repr(C)]
pub struct DailyEntry {
    pub key: Pubkey, // the wallet that signed the attempt
    pub name: [u8; 16],
    pub score: u32,
    pub kills: u32,
    pub place: u32,
    pub survived: u32, // seconds
}

pub const DAILY_SECRET_MAGIC: u32 = 0xB1AC_0004;

/// Today's seed. Ephemeral, private permission with no members: nobody can read it.
#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct DailySecret {
    pub magic: u32,
    pub day: u32,
    pub seed: [u8; 32],
}
pub const DAILY_SECRET_LEN: usize = core::mem::size_of::<DailySecret>();

/// Base-layer escrow for staked rooms. Program-owned so it can pay out directly.
#[account]
pub struct Bank {
    pub room_id: u64,
    pub paid_match: u32,
    pub bump: u8,
    /// Stakes held for tickets not yet used or refunded. Counted, not read from the balance,
    /// because anyone can send SOL to any account.
    pub outstanding: u64,
    /// Ticket accounts that still exist. A room can only close once all are gone, or the
    /// used ones could never hand their rent back (closing a ticket needs its bank).
    pub tickets: u32,
}

/// Base-layer proof that a seat paid the stake for a given match.
#[account]
pub struct Ticket {
    pub room_id: u64,
    pub match_no: u32,
    pub player: Pubkey,
    pub payout: Pubkey,
    pub amount: u64,
    /// After this the stake can be refunded even if the room never settled.
    pub expires_at: i64,
    /// Set by settle: this stake went into a pot. Must stay the last field (see `use_ticket`).
    pub consumed: bool,
}

pub const BANK_LEN: usize = 8 + 8 + 4 + 1 + 8 + 4;
pub const TICKET_LEN: usize = 8 + 8 + 4 + 32 + 32 + 8 + 8 + 1;

// ---------------------------------------------------------------------------
// Ephemeral accounts (live only inside the Private ER). Raw bytemuck layouts,
// all 4-byte fields so the TS client can decode them with a DataView.
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct PlayerState {
    pub x: i32,
    pub y: i32,
    pub aim: u32, // 0..65535
    pub in_dx: i32,
    pub in_dy: i32,
    pub buttons: u32,
    pub in_seq: u32,
    pub alive: u32,
    pub hp: u32,
    pub armor: u32,
    pub weapon: u32,
    pub mag: u32,
    pub reload: u32,
    pub cooldown: u32,
    pub flare: u32,
    pub last_shot: u32, // tick + 1 of last shot (0 = never)
    pub hit_angle: u32,
    pub hit_tick: u32,
    pub moved: u32,
    pub last_input_tick: u32,
}

#[derive(Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct Bullet {
    pub x: i32,
    pub y: i32,
    pub vx: i32,
    pub vy: i32,
    pub owner: u32,
    pub ttl: u32,
    pub dmg: u32,
    pub weapon: u32,
}

#[derive(Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct Loot {
    pub x: i32,
    pub y: i32,
    pub kind: u32,
    pub active: u32,
}

#[derive(Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct BotBrain {
    pub wx: i32,
    pub wy: i32,
    pub has_wp: u32,
    pub stuck: u32,
    pub react_at: u32,
    pub target: u32,
    pub strafe: i32,
    pub ping_angle: u32,
    pub ping_tick: u32,
    pub last_x: i32,
    pub last_y: i32,
    pub sweep: i32,
}

#[derive(Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct ZonePhase {
    pub start: u32, // tick the shrink starts
    pub end: u32,   // tick the shrink ends
    pub reveal: u32,
    pub dmg: u32, // hp lost every 10 ticks outside, from this phase on
    pub x: i32,
    pub y: i32,
    pub r: i32,
    pub _pad: u32,
}

pub const WORLD_MAGIC: u32 = 0xB1AC_0001;

#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct World {
    pub magic: u32,
    pub room_lo: u32,
    pub room_hi: u32,
    pub tick: u32,
    pub seeded: u32,
    pub rng_lo: u32,
    pub rng_hi: u32,
    pub n_bullets_spawned: u32,
    pub seed: [u8; 32],
    pub players: [PlayerState; MAXP],
    pub bullets: [Bullet; MAXB],
    pub loot: [Loot; MAXL],
    pub bots: [BotBrain; MAXP],
    pub zone: [ZonePhase; 4],
    pub start_x: i32,
    pub start_y: i32,
    pub start_r: i32,
    /// One Light nights: seat + 1 of whoever carries the only flashlight (0 = nobody)
    pub light: u32,
    pub _pad: [u32; 2],
}

#[derive(Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct VisPlayer {
    pub seat: u32,
    pub x: i32,
    pub y: i32,
    pub aim: u32,
    pub hp: u32,
    pub weapon: u32,
    pub flags: u32, // 1 = seen by muzzle flash only, 2 = seen via flare, 4 = firing
}

#[derive(Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct VisBullet {
    pub x: i32,
    pub y: i32,
    pub vx: i32,
    pub vy: i32,
}

#[derive(Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct VisLoot {
    pub id: u32,
    pub x: i32,
    pub y: i32,
    pub kind: u32,
}

#[derive(Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct Ping {
    pub tick: u32,
    pub angle: u32,
    pub kind: u32, // 1 step, 2 shot, 3 loot, 4 reload
    pub dist: u32, // tiles, rounded
}

pub const VIEW_MAGIC: u32 = 0xB1AC_0002;

/// What one player is allowed to know this tick. Private to that player.
#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct View {
    pub magic: u32,
    pub room_lo: u32,
    pub room_hi: u32,
    pub tick: u32,
    pub status: u32,
    pub seat: u32,
    pub me: PlayerState,
    pub kills: u32,
    pub place: u32,
    pub n_players: u32,
    pub players: [VisPlayer; VIS_P],
    pub n_bullets: u32,
    pub bullets: [VisBullet; VIS_B],
    pub n_loot: u32,
    pub loot: [VisLoot; VIS_L],
    pub ping_head: u32,
    pub pings: [Ping; PINGS],
    pub _pad: u32,
}

pub const REC_MAGIC: u32 = 0xB1AC_0003;

/// Full-match flight recorder. Private during play, flipped public at the end
/// so anyone can replay the match with the lights on.
#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct RecHeader {
    pub magic: u32,
    pub room_lo: u32,
    pub room_hi: u32,
    pub frames: u32, // frames stored in this chunk
    pub match_no: u32,
    pub every: u32, // ticks per frame
    pub chunk: u32,
    pub _pad: u32,
}

pub const WORLD_LEN: usize = core::mem::size_of::<World>();
pub const VIEW_LEN: usize = core::mem::size_of::<View>();
pub const REC_LEN: usize = REC_CHUNK_LEN;

#[cfg(test)]
mod staked_start_tests {
    use super::*;

    fn table() -> Room {
        let mut r: Room = Zeroable::zeroed();
        r.stake = 10_000_000;
        r.status = ST_LOBBY;
        r
    }
    fn sit(r: &mut Room, i: usize, now: i64) {
        r.players[i] = Pubkey::new_unique();
        r.n_players += 1;
        r.arm_staked_start(now, true);
    }

    #[test]
    fn one_staker_never_starts() {
        let mut r = table();
        sit(&mut r, 0, 1_000);
        assert_eq!(r.start_slot, 0);
        assert!(!r.staked_start_ok(1_000_000));
    }

    #[test]
    fn two_stakers_start_after_the_countdown_only() {
        let mut r = table();
        sit(&mut r, 0, 1_000);
        sit(&mut r, 1, 1_010);
        assert!(!r.staked_start_ok(1_010));
        assert!(!r.staked_start_ok(1_010 + STAKED_START_WAIT_SECS - 1));
        assert!(r.staked_start_ok(1_010 + STAKED_START_WAIT_SECS));
    }

    fn stand(r: &mut Room, i: usize, now: i64) {
        r.players[i] = Pubkey::default();
        r.n_players -= 1;
        r.arm_staked_start(now, false);
    }
    fn rejoin(r: &mut Room, i: usize, now: i64) {
        r.players[i] = Pubkey::new_unique();
        r.n_players += 1;
        r.arm_staked_start(now, true);
    }

    #[test]
    fn leaving_and_sitting_back_down_doesnt_restart_the_countdown() {
        let mut r = table();
        sit(&mut r, 0, 1_000);
        sit(&mut r, 1, 1_000);
        sit(&mut r, 2, 1_000);
        let due = r.start_slot;
        stand(&mut r, 2, 1_050);
        rejoin(&mut r, 2, 1_055);
        assert_eq!(r.start_slot, due);
        assert!(r.staked_start_ok(1_000 + STAKED_START_WAIT_SECS));
    }

    #[test]
    fn a_staker_leaving_and_coming_back_cant_stall_three_or_more() {
        let mut r = table();
        sit(&mut r, 0, 1_000);
        sit(&mut r, 1, 1_000);
        sit(&mut r, 2, 1_000);
        // one of them leaves and comes back every 50 s
        let mut t = 1_000;
        for _ in 0..10 {
            t += 50;
            stand(&mut r, 1, t);
            rejoin(&mut r, 1, t + 1);
        }
        assert!(r.staked_start_ok(1_000 + STAKED_MAX_WAIT_SECS));
    }

    #[test]
    fn new_stakers_never_push_past_three_minutes() {
        let mut r = table();
        sit(&mut r, 0, 1_000);
        sit(&mut r, 1, 1_000); // first countdown: 1_000
        for i in 2..7 {
            sit(&mut r, i, 1_000 + 40 * i as i64);
        }
        assert!(r.start_slot as i64 <= 1_000 + STAKED_MAX_WAIT_SECS);
        assert!(r.staked_start_ok(1_000 + STAKED_MAX_WAIT_SECS));
    }

    #[test]
    fn an_emptied_lobby_starts_fresh() {
        let mut r = table();
        sit(&mut r, 0, 1_000);
        sit(&mut r, 1, 1_000);
        stand(&mut r, 0, 1_500);
        stand(&mut r, 1, 1_500);
        assert_eq!((r.start_slot, r.last_tick_slot), (0, 0));
        sit(&mut r, 0, 2_000);
        sit(&mut r, 1, 2_000);
        assert!(!r.staked_start_ok(2_000 + STAKED_START_WAIT_SECS - 1));
        assert!(r.staked_start_ok(2_000 + STAKED_START_WAIT_SECS));
    }

    #[test]
    fn every_new_staker_restarts_the_countdown() {
        let mut r = table();
        sit(&mut r, 0, 1_000);
        sit(&mut r, 1, 1_000);
        sit(&mut r, 2, 1_050); // 10 s before the first countdown would have ended
        assert!(!r.staked_start_ok(1_000 + STAKED_START_WAIT_SECS));
        assert!(r.staked_start_ok(1_050 + STAKED_START_WAIT_SECS));
    }

    #[test]
    fn a_full_table_starts_at_once() {
        let mut r = table();
        r.cfg = 3; // three seats
        sit(&mut r, 0, 1_000);
        sit(&mut r, 1, 1_000);
        assert!(!r.staked_start_ok(1_001));
        sit(&mut r, 2, 1_001);
        assert!(r.staked_start_ok(1_001));
    }

    #[test]
    fn dropping_below_two_stops_the_countdown() {
        let mut r = table();
        sit(&mut r, 0, 1_000);
        sit(&mut r, 1, 1_000);
        r.clear_seat(1);
        r.arm_staked_start(1_020, false);
        assert_eq!(r.start_slot, 0);
        assert!(!r.staked_start_ok(1_000_000));
        // a leaver with two still seated keeps the running countdown (it only restarts on a join)
        sit(&mut r, 1, 2_000);
        sit(&mut r, 2, 2_000);
        r.clear_seat(2);
        r.arm_staked_start(2_030, false);
        assert_eq!(r.start_slot as i64, 2_000 + STAKED_START_WAIT_SECS);
    }

    #[test]
    fn free_rooms_are_untouched() {
        let mut r = table();
        r.stake = 0;
        r.start_slot = 777;
        sit(&mut r, 0, 1_000);
        sit(&mut r, 1, 1_000);
        assert_eq!(r.start_slot, 777);
    }
}

#[cfg(test)]
mod prize_tests {
    use super::*;

    fn prize(day: u32) -> Box<Prize> {
        let mut p: Box<Prize> = Box::new(Zeroable::zeroed());
        p.day = day;
        p.last_claimed = 1;
        p
    }
    fn night(p: &mut Prize, key: &Pubkey, staked: u64, won: u64) {
        let e = p.entry_mut(key).unwrap();
        e.games += 1;
        e.staked += staked;
        e.won += won;
    }

    #[test]
    fn three_nights_needed_to_win() {
        let mut p = prize(10);
        let (a, b) = (Pubkey::new_unique(), Pubkey::new_unique());
        night(&mut p, &a, 50, 190); // a: one big win, only 2 nights
        night(&mut p, &a, 50, 0);
        for _ in 0..3 {
            night(&mut p, &b, 50, 60); // b: three nights, small profit
        }
        assert_eq!(p.leader(), Some(1), "only b has played three nights");
        night(&mut p, &a, 50, 0);
        assert_eq!(p.leader(), Some(0), "now a qualifies with the higher profit (90 vs 30)");
    }

    #[test]
    fn highest_net_profit_wins_and_ties_go_to_the_earlier() {
        let mut p = prize(10);
        let (a, b, c) = (Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique());
        for _ in 0..3 {
            night(&mut p, &a, 50, 50);
            night(&mut p, &b, 50, 50);
            night(&mut p, &c, 50, 0);
        }
        assert_eq!(p.leader(), Some(0), "a and b tie at 0: a was first");
        night(&mut p, &c, 50, 400);
        assert_eq!(p.leader(), Some(2), "c: -150 + 350 = +200");
    }

    #[test]
    fn the_day_closes_with_a_winner_and_resets_to_zero() {
        let mut p = prize(10);
        let a = Pubkey::new_unique();
        for _ in 0..3 {
            night(&mut p, &a, 50, 100);
        }
        p.pot = 7_000;
        assert_eq!(p.roll(10), 0, "same day: nothing happens");
        assert_eq!(p.roll(11), 0, "a winner: nothing leaves yet");
        assert_eq!((p.last_winner, p.last_prize, p.last_claimed, p.last_day), (a, 7_000, 0, 10));
        assert_eq!((p.day, p.pot, p.count), (11, 0, 0), "today starts from zero");
    }

    #[test]
    fn no_qualifier_sends_the_pot_to_the_treasury() {
        let mut p = prize(10);
        let a = Pubkey::new_unique();
        night(&mut p, &a, 50, 100); // only one night
        p.pot = 4_000;
        assert_eq!(p.roll(11), 4_000);
        assert_eq!((p.last_prize, p.last_claimed), (0, 1));
    }

    #[test]
    fn an_unclaimed_prize_goes_to_the_treasury_when_the_next_day_closes() {
        let mut p = prize(10);
        let a = Pubkey::new_unique();
        for _ in 0..3 {
            night(&mut p, &a, 50, 100);
        }
        p.pot = 5_000;
        p.roll(11); // a wins 5,000, doesn't claim
        p.pot = 2_000; // day 11: nobody qualifies
        assert_eq!(p.roll(12), 7_000, "a's unclaimed 5,000 and day 11's 2,000");
        assert_eq!(p.last_claimed, 1);
    }

    #[test]
    fn the_very_first_day_never_crowns_anyone() {
        let mut p = prize(0);
        p.pot = 0;
        assert_eq!(p.roll(20), 0);
        assert_eq!((p.day, p.last_claimed), (20, 1));
    }

    #[test]
    fn a_full_day_stops_tracking_newcomers() {
        let mut p = prize(10);
        for _ in 0..PRIZE_SLOTS {
            assert!(p.entry_mut(&Pubkey::new_unique()).is_some());
        }
        assert!(p.entry_mut(&Pubkey::new_unique()).is_none());
        let first = p.entries[0].key;
        assert!(p.entry_mut(&first).is_some(), "a known wallet is still found");
    }
}
