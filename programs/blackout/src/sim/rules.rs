//! The game's numbers: weapons, ranges, timings, loot odds, night modifiers.
use super::*;

pub const UNIT: i32 = 256; // fixed-point units per tile
pub const PLAYER_R: i32 = 90;
pub const SPEED: i32 = 56; // units per tick (~4.4 tiles/s at 20 tps)
pub const COUNTDOWN_TICKS: u32 = 60;
pub const MATCH_TICKS: u32 = 6000; // every night is 5:00
/// the zone schedule below is written for a 2:15 night and stretched to MATCH_TICKS
pub const ZONE_BASE: u32 = 2700;
pub const VISION_R: i32 = 10 * UNIT;
pub const AMBIENT_R: i32 = 2 * UNIT + 64;
pub const CONE_HALF: u32 = 7000; // ~38 degrees
pub const FLASH_R: i32 = 16 * UNIT;
pub const STEP_R: i32 = 8 * UNIT;
pub const SHOT_R: i32 = 26 * UNIT;
pub const RELOAD_R: i32 = 6 * UNIT;
pub const LOOT_R: i32 = 9 * UNIT;
pub const PICK_R: i32 = 180;
pub const FLARE_TICKS: u32 = 100;
/// 10 s without input from any living human = the room is abandoned; end the night
pub const IDLE_TICKS: u32 = 200;

pub const PING_STEP: u32 = 1;
pub const PING_SHOT: u32 = 2;
pub const PING_LOOT: u32 = 3;
pub const PING_RELOAD: u32 = 4;
/// a supply drop is down: everyone hears where (until someone opens it)
pub const PING_DROP: u32 = 5;
/// direction to the kill leader, sent to everyone else every 5 s
pub const PING_BOUNTY: u32 = 6;
pub const LOOT_DROP: u32 = 8;
pub const BLACKOUT_TICKS: u32 = 200;
pub const KILL_HEAL: u32 = 25;

// ---- gadgets, second gun, night modifiers, duos (no account layout changes:
// thrown things live in spare bullet slots, a human's inventory in their unused bot brain,
// and the client gets it packed into View._pad)
pub const LOOT_FRAG: u32 = 9;
pub const LOOT_SMOKE: u32 = 10;
pub const LOOT_FLASH: u32 = 11;
pub const LOOT_DECOY: u32 = 12;
pub const LOOT_SENSOR: u32 = 13;
pub const LOOT_NVG: u32 = 14;
pub const G_FRAG: u32 = 1;
pub const G_SMOKE: u32 = 2;
pub const G_FLASH: u32 = 3;
pub const G_DECOY: u32 = 4;
pub const G_SENSOR: u32 = 5;
pub const G_NVG: u32 = 6;
pub const BTN_GADGET: u32 = 8;
pub const BTN_SWAP: u32 = 16;
/// bullet.weapon >= EFF_FLY marks a gadget, not a round: EFF_FLY + kind while flying
pub const EFF_FLY: u32 = 16;
pub const EFF_SMOKE: u32 = 32;
/// VisBullet tag for a gadget in flight (velocities are far below this)
pub const GADGET_TAG: i32 = 1 << 20;
pub const EFF_DECOY: u32 = 33;
pub const EFF_SENSOR: u32 = 34;
pub const SMOKE_R: i32 = 5 * UNIT / 2;
pub const SMOKE_TICKS: u32 = 180;
pub const DECOY_TICKS: u32 = 120;
pub const SENSOR_TICKS: u32 = 2400;
pub const SENSOR_R: i32 = 4 * UNIT;
pub const NVG_TICKS: u32 = 300;
pub const BLIND_TICKS: u32 = 60;
pub const FRAG_R: i32 = 3 * UNIT;
pub const FRAG_DMG: u32 = 70;
pub const FLASHBANG_R: i32 = 7 * UNIT;
pub const PING_SMOKE: u32 = 7;
pub const PING_SENSOR: u32 = 8;
pub const PING_BOOM: u32 = 9;
pub const CRAWL_SPEED: i32 = 18;
pub const BLEED_TICKS: u32 = 300;
pub const REVIVE_TICKS: u32 = 60;
pub const REVIVE_R: i32 = 5 * UNIT / 4;
/// alive == DOWNED: on the floor in duos, crawling, waiting for a revive
pub const DOWNED: u32 = 2;

pub const MOD_NONE: u32 = 0;
pub const MOD_FOG: u32 = 1;
pub const MOD_HUNTER: u32 = 2;
pub const MOD_SNIPER: u32 = 3;
pub const MOD_NO_LAMPS: u32 = 4;
pub const MOD_GADGETS: u32 = 5;
/// The night's modifier, rolled from the VRF seed (Room.cfg bits 13-15).
pub fn night_mod(room: &Room) -> u32 {
    (room.cfg >> 13) & 7
}
pub const CFG_DUOS: u32 = 1 << 16;
pub fn duos(room: &Room) -> bool {
    room.cfg & CFG_DUOS != 0
}
pub fn same_team(room: &Room, a: usize, b: usize) -> bool {
    duos(room) && a != b && a / 2 == b / 2
}

// a human's inventory, kept in their (otherwise unused) bot brain
pub fn inv_sec(b: &BotBrain) -> (u32, u32) {
    let v = b.wx as u32;
    ((v & 0xff), (v >> 8) & 0xff) // (second gun + 1, its mag)
}
pub fn inv_gadget(b: &BotBrain) -> (u32, u32) {
    let v = b.wx as u32;
    ((v >> 16) & 0xff, (v >> 24) & 0xff)
}
pub fn inv_set(b: &mut BotBrain, sec: u32, sec_mag: u32, g: u32, n: u32) {
    b.wx = (sec | sec_mag << 8 | g << 16 | n << 24) as i32;
}
pub fn blind_of(p: &PlayerState) -> u32 {
    p.hit_angle >> 16
}

/// Loot roll (mirrored in verify.ts): what a 0..99 roll becomes under the night's modifier.
pub fn loot_for_roll(roll: u32, m: u32) -> u32 {
    let k = match roll {
        0..=15 => LOOT_MEDKIT,
        16..=27 => LOOT_ARMOR,
        28..=37 => LOOT_SMG,
        38..=45 => LOOT_SHOTGUN,
        46..=57 => LOOT_AR,
        58..=63 => LOOT_SNIPER,
        64..=69 => LOOT_FLARE,
        70..=77 => LOOT_FRAG,
        78..=83 => LOOT_SMOKE,
        84..=88 => LOOT_FLASH,
        89..=92 => LOOT_DECOY,
        93..=95 => LOOT_SENSOR,
        _ => LOOT_NVG,
    };
    match (m, k) {
        (MOD_SNIPER, LOOT_SMG | LOOT_SHOTGUN | LOOT_AR) => LOOT_SNIPER,
        (MOD_GADGETS, LOOT_SMG) => LOOT_FRAG,
        (MOD_GADGETS, LOOT_SHOTGUN) => LOOT_SMOKE,
        (MOD_GADGETS, LOOT_AR) => LOOT_DECOY,
        (MOD_GADGETS, LOOT_SNIPER) => LOOT_FLASH,
        (MOD_GADGETS, LOOT_FLARE) => LOOT_NVG,
        _ => k,
    }
}

/// Room.end_tick set to this while live = the host asked to end the night now
pub const END_REQUEST: u32 = 1;
/// a street lamp lights a circle this wide; anyone in it is visible this far away
pub const LAMP_R: i32 = 5 * UNIT / 2;
pub const LAMP_SEE_R: i32 = 16 * UNIT;

/// Night events, as fractions of the night: two supply drops and one blackout.
pub fn drop_ticks(room: &Room) -> [u32; 2] {
    let m = room.match_ticks();
    [m * 3 / 10, m * 62 / 100]
}
pub fn blackout_tick(room: &Room) -> u32 {
    room.match_ticks() / 2
}

pub const LOOT_MEDKIT: u32 = 1;
pub const LOOT_ARMOR: u32 = 2;
pub const LOOT_SMG: u32 = 3;
pub const LOOT_SHOTGUN: u32 = 4;
pub const LOOT_FLARE: u32 = 5;
pub const LOOT_AR: u32 = 6;
pub const LOOT_SNIPER: u32 = 7;

pub const W_PISTOL: u32 = 0;
pub const W_SMG: u32 = 1;
pub const W_SHOTGUN: u32 = 2;
pub const W_AR: u32 = 3;
pub const W_SNIPER: u32 = 4;

/// Loot kind for a gun (dropped on death), and the gun a loot kind gives.
pub fn gun_loot(weapon: u32) -> u32 {
    match weapon {
        W_SMG => LOOT_SMG,
        W_SHOTGUN => LOOT_SHOTGUN,
        W_AR => LOOT_AR,
        _ => LOOT_SNIPER,
    }
}
pub const W_ZONE: u32 = 9;

pub struct Weapon {
    pub dmg: u32,
    pub cooldown: u32,
    pub mag: u32,
    pub reload: u32,
    pub speed: i32,
    pub ttl: u32,
    pub pellets: u32,
    pub spread: u32,
}

pub const WEAPONS: [Weapon; 5] = [
    // P92 pistol
    Weapon { dmg: 22, cooldown: 7, mag: 10, reload: 28, speed: 280, ttl: 16, pellets: 1, spread: 0 },
    // UMP SMG: fast, short, sprays
    Weapon { dmg: 11, cooldown: 2, mag: 30, reload: 40, speed: 300, ttl: 14, pellets: 1, spread: 900 },
    // S12K shotgun: five pellets, close only
    Weapon { dmg: 13, cooldown: 16, mag: 5, reload: 44, speed: 260, ttl: 8, pellets: 5, spread: 2600 },
    // M416 assault rifle: the all-rounder
    Weapon { dmg: 15, cooldown: 3, mag: 30, reload: 42, speed: 340, ttl: 20, pellets: 1, spread: 260 },
    // Kar98k sniper: two body shots, slow bolt, long and loud
    Weapon { dmg: 80, cooldown: 30, mag: 5, reload: 56, speed: 460, ttl: 26, pellets: 1, spread: 0 },
];
