use anchor_lang::prelude::*;
use bytemuck::{Pod, Zeroable};

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
/// v2: entries carry the callsign, so a wallet's profile lives on Solana
pub const BOT_MEDIUM: u32 = 0;
pub const BOT_EASY: u32 = 1;
pub const BOT_HARD: u32 = 2;
pub const BOARD_SEED: &[u8] = b"board3"; // staked nights only
pub const BOARD_SLOTS: usize = 64;

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
    pub start_slot: u64,     // ER slot when the match went live
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
    /// room config set by its creator: bits 0-7 = seats (2..8, 0 = 8), bit 8 = unlisted, bits 9-10 = bot level
    pub cfg: u32,
    pub ready_mask: u32,
    pub last_seen: [u32; MAXP], // ER slot (truncated) of each seat's last lobby heartbeat
}

impl Room {
    pub fn seat_of(&self, key: &Pubkey) -> Option<usize> {
        if *key == Pubkey::default() {
            return None;
        }
        (0..MAXP).find(|&i| self.players[i] == *key && self.is_bot[i] == 0)
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

    /// The host is whoever created the room. No hand-offs: if they're gone, the room is closed.
    pub fn fix_host(&mut self, _slot: u64) {}

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

/// Base-layer escrow for staked rooms. Program-owned so it can pay out directly.
#[account]
pub struct Bank {
    pub room_id: u64,
    pub paid_match: u32,
    pub bump: u8,
}

/// Base-layer proof that a seat paid the stake for a given match.
#[account]
pub struct Ticket {
    pub room_id: u64,
    pub match_no: u32,
    pub player: Pubkey,
    pub payout: Pubkey,
    pub amount: u64,
}

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
    pub _pad: [u32; 3],
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
