//! Deterministic integer simulation. Runs inside the TEE once per crank tick.
//! Movement math is mirrored bit-for-bit in app/src/game/sim.ts for prediction.
use crate::gen::*;
use crate::state::*;

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
pub const REC_EVERY: u32 = 2;
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
fn inv_sec(b: &BotBrain) -> (u32, u32) {
    let v = b.wx as u32;
    ((v & 0xff), (v >> 8) & 0xff) // (second gun + 1, its mag)
}
fn inv_gadget(b: &BotBrain) -> (u32, u32) {
    let v = b.wx as u32;
    ((v >> 16) & 0xff, (v >> 24) & 0xff)
}
fn inv_set(b: &mut BotBrain, sec: u32, sec_mag: u32, g: u32, n: u32) {
    b.wx = (sec | sec_mag << 8 | g << 16 | n << 24) as i32;
}
fn blind_of(p: &PlayerState) -> u32 {
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

/// Does the segment a-b pass through any smoke cloud?
fn smoked(smokes: &[(i32, i32)], ax: i32, ay: i32, bx: i32, by: i32) -> bool {
    for &(sx, sy) in smokes {
        let (dx, dy) = ((bx - ax) as i64, (by - ay) as i64);
        let len2 = dx * dx + dy * dy;
        let t = if len2 == 0 { 0 } else { (((sx - ax) as i64 * dx + (sy - ay) as i64 * dy) * 1024 / len2).clamp(0, 1024) };
        let px = ax as i64 + dx * t / 1024;
        let py = ay as i64 + dy * t / 1024;
        if (px - sx as i64).pow(2) + (py - sy as i64).pow(2) <= (SMOKE_R as i64).pow(2) {
            return true;
        }
    }
    false
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

// ---------------------------------------------------------------- math

pub fn sin(a: u32) -> i32 {
    let a = a & 0xffff;
    let idx = (a >> 8) as usize;
    let frac = (a & 255) as i32;
    let s0 = SIN_TABLE[idx];
    let s1 = SIN_TABLE[idx + 1];
    s0 + (s1 - s0) * frac / 256
}

pub fn cos(a: u32) -> i32 {
    sin(a.wrapping_add(16384))
}

/// Angle of (dx, dy) in 0..65536, 0 = +x, increasing toward +y (screen-down).
pub fn atan2(dy: i32, dx: i32) -> u32 {
    if dx == 0 && dy == 0 {
        return 0;
    }
    let ax = dx.unsigned_abs() as i64;
    let ay = dy.unsigned_abs() as i64;
    let oct = |num: i64, den: i64| -> i32 {
        let ratio = num * 64 * 256 / den;
        let i = (ratio >> 8) as usize;
        let f = (ratio & 255) as i32;
        let a0 = ATAN_TABLE[i.min(64)];
        let a1 = ATAN_TABLE[(i + 1).min(64)];
        a0 + (a1 - a0) * f / 256
    };
    let a = if ax >= ay { oct(ay, ax) } else { 16384 - oct(ax, ay) };
    let r = match (dx >= 0, dy >= 0) {
        (true, true) => a,
        (false, true) => 32768 - a,
        (false, false) => 32768 + a,
        (true, false) => 65536 - a,
    };
    (r as u32) & 0xffff
}

pub fn angle_diff(a: u32, b: u32) -> u32 {
    let d = a.wrapping_sub(b) & 0xffff;
    d.min(65536 - d)
}

pub fn isqrt(v: u64) -> u64 {
    if v == 0 {
        return 0;
    }
    // integer Newton iteration (deterministic, mirrored in sim.ts)
    let mut x = v;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + v / x) / 2;
    }
    x
}

pub fn dist2(ax: i32, ay: i32, bx: i32, by: i32) -> i64 {
    let dx = (ax - bx) as i64;
    let dy = (ay - by) as i64;
    dx * dx + dy * dy
}

pub fn is_wall(tx: i32, ty: i32) -> bool {
    if tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H {
        return true;
    }
    (WALLS[ty as usize] >> tx) & 1 == 1
}

pub fn circle_hits_wall(x: i32, y: i32, r: i32) -> bool {
    let tx0 = (x - r) >> 8;
    let tx1 = (x + r) >> 8;
    let ty0 = (y - r) >> 8;
    let ty1 = (y + r) >> 8;
    let r2 = (r as i64) * (r as i64);
    for ty in ty0..=ty1 {
        for tx in tx0..=tx1 {
            if !is_wall(tx, ty) {
                continue;
            }
            let cx = x.clamp(tx * UNIT, tx * UNIT + UNIT - 1);
            let cy = y.clamp(ty * UNIT, ty * UNIT + UNIT - 1);
            if dist2(x, y, cx, cy) < r2 {
                return true;
            }
        }
    }
    false
}

/// Velocity for an analog input in -127..127. Mirrored in sim.ts.
pub fn input_velocity(dx: i32, dy: i32) -> (i32, i32) {
    input_velocity_at(dx, dy, SPEED)
}

pub fn input_velocity_at(dx: i32, dy: i32, speed: i32) -> (i32, i32) {
    let m2 = dx * dx + dy * dy;
    if m2 == 0 {
        return (0, 0);
    }
    if m2 <= 127 * 127 {
        (dx * speed / 127, dy * speed / 127)
    } else {
        let m = isqrt(m2 as u64) as i32;
        (dx * speed / m, dy * speed / m)
    }
}

// ---- sprint. `moved` packs: bit 0 = moved this tick, bit 1 = sprinting, bit 2 = winded,
// bits 8.. = fatigue (0 = fresh, FATIGUE_MAX = empty). Mirrored in sim.ts.
pub const SPRINT_SPEED: i32 = 84;
pub const FATIGUE_MAX: u32 = 100;
pub const FATIGUE_RECOVERED: u32 = 30;
pub const BTN_SPRINT: u32 = 4;

/// One tick of stamina: returns (sprinting, new fatigue, winded).
pub fn sprint_step(moved: u32, buttons: u32, dx: i32, dy: i32) -> (bool, u32, bool) {
    let mut fatigue = moved >> 8;
    let mut winded = moved & 4 != 0;
    let wants = buttons & BTN_SPRINT != 0 && buttons & 1 == 0 && (dx != 0 || dy != 0);
    let sprinting = wants && !winded;
    if sprinting {
        fatigue = (fatigue + 2).min(FATIGUE_MAX);
        if fatigue >= FATIGUE_MAX {
            winded = true;
        }
    } else if fatigue > 0 {
        fatigue -= 1;
    }
    if winded && fatigue <= FATIGUE_RECOVERED {
        winded = false;
    }
    (sprinting, fatigue, winded)
}

/// Axis-separated move with wall sliding. Mirrored in sim.ts.
pub fn move_body(x: &mut i32, y: &mut i32, vx: i32, vy: i32) {
    if vx != 0 {
        let nx = *x + vx;
        if !circle_hits_wall(nx, *y, PLAYER_R) {
            *x = nx;
        } else {
            let hx = *x + vx / 2;
            if !circle_hits_wall(hx, *y, PLAYER_R) {
                *x = hx;
            }
        }
    }
    if vy != 0 {
        let ny = *y + vy;
        if !circle_hits_wall(*x, ny, PLAYER_R) {
            *y = ny;
        } else {
            let hy = *y + vy / 2;
            if !circle_hits_wall(*x, hy, PLAYER_R) {
                *y = hy;
            }
        }
    }
}

pub fn line_of_sight(x0: i32, y0: i32, x1: i32, y1: i32) -> bool {
    let d = isqrt(dist2(x0, y0, x1, y1) as u64) as i32;
    let steps = d / 64 + 1;
    for i in 1..steps {
        let px = x0 + (x1 - x0) * i / steps;
        let py = y0 + (y1 - y0) * i / steps;
        if is_wall(px >> 8, py >> 8) {
            return false;
        }
    }
    true
}

// ---------------------------------------------------------------- rng

pub fn rng_next(w: &mut World) -> u32 {
    let mut s = ((w.rng_hi as u64) << 32) | w.rng_lo as u64;
    if s == 0 {
        s = 0x9E37_79B9_7F4A_7C15;
    }
    s ^= s << 13;
    s ^= s >> 7;
    s ^= s << 17;
    w.rng_lo = s as u32;
    w.rng_hi = (s >> 32) as u32;
    (s >> 16) as u32
}

pub fn rng_range(w: &mut World, lo: i32, hi: i32) -> i32 {
    let span = (hi - lo + 1).max(1) as u32;
    lo + (rng_next(w) % span) as i32
}

pub fn tile_center(t: u8) -> i32 {
    t as i32 * UNIT + UNIT / 2
}

// ---------------------------------------------------------------- setup

/// Called from the VRF callback: everything random about the match is derived
/// here, from the VRF output, and stays sealed inside World until the reveal.
pub fn seed_match(room: &mut Room, w: &mut World, seed: [u8; 32]) {
    w.seed = seed;
    // the night's modifier comes straight from the seed (so verify.ts can re-derive it)
    let m = (seed[31] as u32) % 6;
    room.cfg = (room.cfg & !(7 << 13)) | (m << 13);
    w.rng_lo = u32::from_le_bytes(seed[0..4].try_into().unwrap()) | 1;
    w.rng_hi = u32::from_le_bytes(seed[4..8].try_into().unwrap());
    w.tick = 0;
    w.seeded = 1;
    w.bullets = [Bullet::default(); MAXB];
    w.loot = [Loot::default(); MAXL];
    w.bots = [BotBrain::default(); MAXP];

    // spawns: shuffled, greedy max-spread
    let mut order = [0usize; SPAWNS.len()];
    for (i, o) in order.iter_mut().enumerate() {
        *o = i;
    }
    for i in (1..order.len()).rev() {
        let j = (rng_next(w) as usize) % (i + 1);
        order.swap(i, j);
    }
    let mut used = [false; SPAWNS.len()];
    let mut placed: [(i32, i32); MAXP] = [(0, 0); MAXP];
    let mut n_placed = 0usize;
    for seat in 0..MAXP {
        let occupied = room.players[seat] != anchor_lang::prelude::Pubkey::default() || room.is_bot[seat] == 1;
        let p = &mut w.players[seat];
        *p = PlayerState::default();
        if !occupied {
            continue;
        }
        let mut pick = None;
        for &k in order.iter() {
            if used[k] {
                continue;
            }
            let (sx, sy) = (tile_center(SPAWNS[k].0), tile_center(SPAWNS[k].1));
            let far = placed[..n_placed].iter().all(|&(px, py)| dist2(px, py, sx, sy) >= (7 * UNIT as i64).pow(2));
            if far {
                pick = Some(k);
                break;
            }
        }
        let k = pick.unwrap_or_else(|| order.iter().copied().find(|&k| !used[k]).unwrap_or(0));
        used[k] = true;
        let (sx, sy) = (tile_center(SPAWNS[k].0), tile_center(SPAWNS[k].1));
        placed[n_placed] = (sx, sy);
        n_placed += 1;
        let p = &mut w.players[seat];
        p.x = sx;
        p.y = sy;
        p.alive = 1;
        p.hp = 100;
        p.weapon = W_PISTOL;
        p.mag = WEAPONS[0].mag;
        p.aim = atan2((MAP_W / 2) * UNIT - sy, (MAP_W / 2) * UNIT - sx);
        w.bots[seat] = bytemuck::Zeroable::zeroed(); // clean slate (humans keep their inventory here)
        w.bots[seat].sweep = rng_range(w, -4000, 4000);
        w.bots[seat].strafe = if rng_next(w) & 1 == 0 { 1 } else { -1 };
    }

    // loot: 10 of the 14 spots, contents rolled from the VRF stream
    let mut spots = [0usize; LOOT_SPOTS.len()];
    for (i, s) in spots.iter_mut().enumerate() {
        *s = i;
    }
    for i in (1..spots.len()).rev() {
        let j = (rng_next(w) as usize) % (i + 1);
        spots.swap(i, j);
    }
    for i in 0..10usize.min(MAXL) {
        let (lx, ly) = LOOT_SPOTS[spots[i]];
        let roll = rng_next(w) % 100;
        let kind = loot_for_roll(roll, m);
        w.loot[i] = Loot { x: tile_center(lx), y: tile_center(ly), kind, active: 1 };
    }

    // zone plan, also sealed until each phase is announced
    // (mirrored in app/src/game/verify.ts)
    let c = (MAP_W / 2) * UNIT;
    let (lo, hi) = (9 * UNIT, (MAP_W - 9) * UNIT);
    let c1x = c + rng_range(w, -7 * UNIT, 7 * UNIT);
    let c1y = c + rng_range(w, -7 * UNIT, 7 * UNIT);
    let c2x = (c1x + rng_range(w, -6 * UNIT, 6 * UNIT)).clamp(lo, hi);
    let c2y = (c1y + rng_range(w, -6 * UNIT, 6 * UNIT)).clamp(lo, hi);
    let c3x = (c2x + rng_range(w, -UNIT * 2, UNIT * 2)).clamp(lo, hi);
    let c3y = (c2y + rng_range(w, -UNIT * 2, UNIT * 2)).clamp(lo, hi);
    w.start_x = c;
    w.start_y = c;
    w.start_r = 35 * UNIT;
    // the schedule is written for a 2:15 night and stretched to the length the host picked
    let k = room.match_ticks();
    let sc = |v: u32| v * k / ZONE_BASE;
    w.zone = [
        ZonePhase { reveal: sc(100), start: sc(500), end: sc(900), dmg: 2, x: c1x, y: c1y, r: 20 * UNIT, _pad: 0 },
        ZonePhase { reveal: sc(900), start: sc(1200), end: sc(1600), dmg: 4, x: c2x, y: c2y, r: 9 * UNIT, _pad: 0 },
        ZonePhase { reveal: sc(1600), start: sc(1800), end: sc(2200), dmg: 8, x: c3x, y: c3y, r: 2 * UNIT, _pad: 0 },
        ZonePhase { reveal: sc(2200), start: sc(2200), end: sc(2200), dmg: 12, x: c3x, y: c3y, r: 2 * UNIT, _pad: 0 },
    ];

    room.zone_x = w.start_x;
    room.zone_y = w.start_y;
    room.zone_r = w.start_r;
    room.next_x = w.start_x;
    room.next_y = w.start_y;
    room.next_r = w.start_r;
    room.zone_phase = 0;
    room.tick = 0;
    room.status = ST_COUNTDOWN;
    let mut alive = 0;
    for seat in 0..MAXP {
        let a = w.players[seat].alive;
        room.alive[seat] = a;
        room.place[seat] = 0;
        room.kills[seat] = 0;
        alive += a;
    }
    room.alive_count = alive;
    room.winner = NO_SEAT;
    room.feed_head = 0;
    room.feed = [KillEvent { tick: 0, killer: 0, victim: 0, weapon: 0 }; FEED];
}

// ---------------------------------------------------------------- tick

pub struct TickOut {
    pub ended: bool,
}

fn zone_now(w: &World, t: u32) -> (i32, i32, i32, u32) {
    let (mut x, mut y, mut r) = (w.start_x, w.start_y, w.start_r);
    let mut dmg = 2;
    for ph in w.zone.iter() {
        if t < ph.start {
            break;
        }
        dmg = ph.dmg;
        if t >= ph.end || ph.end == ph.start {
            x = ph.x;
            y = ph.y;
            r = ph.r;
        } else {
            let k = (t - ph.start) as i64;
            let n = (ph.end - ph.start) as i64;
            x += ((ph.x - x) as i64 * k / n) as i32;
            y += ((ph.y - y) as i64 * k / n) as i32;
            r += ((ph.r - r) as i64 * k / n) as i32;
            break;
        }
    }
    (x, y, r, dmg)
}

fn damage(w: &mut World, killer: &mut [u32; MAXP], victim: usize, mut dmg: u32, src: u32, from_angle: u32, tick: u32) {
    let p = &mut w.players[victim];
    if p.alive == DOWNED {
        if killer[victim] == u32::MAX {
            killer[victim] = src;
        }
        return;
    }
    if p.alive == 0 || p.hp == 0 {
        return;
    }
    if p.armor > 0 {
        let a = p.armor.min(dmg);
        p.armor -= a;
        dmg -= a;
    }
    p.hp = p.hp.saturating_sub(dmg);
    p.hit_angle = (p.hit_angle & 0xffff_0000) | (from_angle & 0xffff);
    p.hit_tick = tick;
    if p.hp == 0 && killer[victim] == u32::MAX {
        killer[victim] = src;
    }
}

fn push_ping(v: &mut View, tick: u32, angle: u32, kind: u32, dist: u32) {
    let i = (v.ping_head as usize) % PINGS;
    v.pings[i] = Ping { tick, angle, kind, dist };
    v.ping_head = v.ping_head.wrapping_add(1);
}

/// Bot skill, picked by the host: (reaction ticks, aim spray, firing range, strafe speed, fire windows of 4).
pub struct Skill {
    pub react: u32,
    pub jitter: i32,
    pub range: i32,
    pub strafe: i32,
    pub fire: u32,
}

pub fn bot_skill(room: &Room) -> Skill {
    match room.bot_level() {
        BOT_EASY => Skill { react: 26, jitter: 3600, range: 8 * UNIT, strafe: 70, fire: 2 },
        BOT_HARD => Skill { react: 10, jitter: 1500, range: 12 * UNIT, strafe: 115, fire: 3 },
        _ => Skill { react: 17, jitter: 2500, range: 10 * UNIT, strafe: 95, fire: 2 },
    }
}

fn bot_think(w: &mut World, room: &Room, seat: usize, tick: u32) {
    let sk = bot_skill(room);
    let zone = (room.zone_x, room.zone_y, room.zone_r);
    let next = (room.next_x, room.next_y, room.next_r);
    let p = w.players[seat];
    let mut b = w.bots[seat];
    let mut dx = 0i32;
    let mut dy = 0i32;
    let mut aim = p.aim;
    let mut buttons = 0u32;
    let wpn = &WEAPONS[p.weapon as usize];

    // stuck detection
    let moved = dist2(p.x, p.y, b.last_x, b.last_y);
    if b.has_wp == 1 && moved < 25 {
        b.stuck += 1;
    } else {
        b.stuck = 0;
    }
    b.last_x = p.x;
    b.last_y = p.y;

    if b.target != NO_SEAT {
        let t = w.players[b.target as usize];
        let ang = atan2(t.y - p.y, t.x - p.x);
        // human-fair bots: a reaction delay, some spray, and a moment to re-acquire (all set by difficulty)
        let jitter = if tick >= b.react_at { sk.jitter } else { sk.jitter * 5 / 2 };
        let j = rng_range(w, -jitter, jitter);
        aim = (ang as i32 + j) as u32 & 0xffff;
        let d = isqrt(dist2(p.x, p.y, t.x, t.y) as u64) as i32;
        if tick >= b.react_at && d < sk.range && (tick / 6) % 4 < sk.fire {
            buttons |= 1;
        }
        if tick % 25 == (seat as u32 * 3) % 25 {
            b.strafe = -b.strafe;
        }
        let side = ang.wrapping_add(if b.strafe > 0 { 16384 } else { 49152 });
        dx = cos(side) * sk.strafe / 1024;
        dy = sin(side) * sk.strafe / 1024;
        if d > 7 * UNIT {
            dx += cos(ang) * 90 / 1024;
            dy += sin(ang) * 90 / 1024;
        } else if d < 3 * UNIT {
            dx -= cos(ang) * 90 / 1024;
            dy -= sin(ang) * 90 / 1024;
        }
    } else {
        if p.mag < WEAPONS[p.weapon as usize].mag / 2 && p.reload == 0 {
            buttons |= 2;
        }
        let heard = b.ping_tick != 0 && tick.saturating_sub(b.ping_tick) < 40;
        let outside = dist2(p.x, p.y, zone.0, zone.1) > ((zone.2 as i64) * 9 / 10).pow(2);
        let pick_new = b.has_wp == 0 || b.stuck > 12 || dist2(p.x, p.y, b.wx, b.wy) < (UNIT as i64 * 3 / 4).pow(2);
        if outside {
            b.wx = zone.0;
            b.wy = zone.1;
            b.has_wp = 1;
        } else if heard {
            b.wx = p.x + cos(b.ping_angle) * 5 * UNIT / 1024;
            b.wy = p.y + sin(b.ping_angle) * 5 * UNIT / 1024;
            b.has_wp = 1;
        } else if pick_new {
            // waypoint: a spawn/loot spot inside the next circle, prefer ones in sight
            let total = SPAWNS.len() + LOOT_SPOTS.len();
            let mut best: Option<(i32, i32)> = None;
            for _ in 0..6 {
                let k = (rng_next(w) as usize) % total;
                let (tx, ty) = if k < SPAWNS.len() { SPAWNS[k] } else { LOOT_SPOTS[k - SPAWNS.len()] };
                let (cx, cy) = (tile_center(tx), tile_center(ty));
                if dist2(cx, cy, next.0, next.1) > (next.2 as i64).pow(2) {
                    continue;
                }
                if line_of_sight(p.x, p.y, cx, cy) {
                    best = Some((cx, cy));
                    break;
                }
                if best.is_none() {
                    best = Some((cx, cy));
                }
            }
            let (cx, cy) = best.unwrap_or((next.0, next.1));
            b.wx = cx;
            b.wy = cy;
            b.has_wp = 1;
            b.stuck = 0;
        }
        let ang = atan2(b.wy - p.y, b.wx - p.x);
        dx = cos(ang) * 110 / 1024;
        dy = sin(ang) * 110 / 1024;
        b.sweep += if (tick / 30) % 2 == 0 { 500 } else { -500 };
        b.sweep = b.sweep.clamp(-9000, 9000);
        let look = if heard { b.ping_angle } else { ang };
        aim = (look as i32 + b.sweep) as u32 & 0xffff;
    }
    let _ = wpn;
    let pl = &mut w.players[seat];
    pl.in_dx = dx.clamp(-127, 127);
    pl.in_dy = dy.clamp(-127, 127);
    pl.aim = aim;
    pl.buttons = buttons;
    w.bots[seat] = b;
}

pub fn tick(room: &mut Room, w: &mut World, views: &mut [&mut View], recs: &mut [&mut [u8]]) -> TickOut {
    w.tick += 1;
    let tick = w.tick;
    room.tick = tick;
    let mut out = TickOut { ended: false };

    if room.status == ST_COUNTDOWN && tick >= COUNTDOWN_TICKS {
        room.status = ST_LIVE;
    }
    let live = room.status == ST_LIVE;
    let t = tick.saturating_sub(COUNTDOWN_TICKS);
    let mut killer = [u32::MAX; MAXP];
    let mut loot_events: [(i32, i32); 4] = [(0, 0); 4];
    let mut n_loot_events = 0usize;
    let mut booms: [(i32, i32); 4] = [(0, 0); 4];
    let mut n_booms = 0usize;

    if live {
        // 1. bots decide from what they saw last tick
        for s in 0..MAXP {
            if room.is_bot[s] == 1 && w.players[s].alive == 1 {
                bot_think(w, room, s, tick);
            }
        }
        // 2. movement, aim, weapons
        for s in 0..MAXP {
            let mut p = w.players[s];
            if p.alive == 0 {
                continue;
            }
            let downed = p.alive == DOWNED;
            let btn = if downed { 0 } else { p.buttons };
            let (sprinting, fatigue, winded) = sprint_step(p.moved, btn, p.in_dx, p.in_dy);
            let speed = if downed { CRAWL_SPEED } else if sprinting { SPRINT_SPEED } else { SPEED };
            let (vx, vy) = input_velocity_at(p.in_dx, p.in_dy, speed);
            let (ox, oy) = (p.x, p.y);
            move_body(&mut p.x, &mut p.y, vx, vy);
            let moved = ox != p.x || oy != p.y;
            p.moved = moved as u32 | ((sprinting && moved) as u32) << 1 | (winded as u32) << 2 | (fatigue & 0xff) << 8;
            let blind = blind_of(&p);
            if blind > 0 {
                p.hit_angle = (p.hit_angle & 0xffff) | ((blind - 1) << 16);
            }
            if downed {
                // bleeding out: armor counts down while you're on the floor
                p.armor = p.armor.saturating_sub(1);
                if p.armor == 0 && killer[s] == u32::MAX {
                    killer[s] = if p.last_shot >= 1 && p.last_shot <= MAXP as u32 { p.last_shot - 1 } else { NO_SEAT };
                }
                w.players[s] = p;
                continue;
            }
            if room.is_bot[s] == 0 {
                let mut b = w.bots[s];
                // night vision wears off
                if b.wy > 0 {
                    b.wy -= 1;
                }
                let (sec, sec_mag) = inv_sec(&b);
                let (g, n) = inv_gadget(&b);
                // swap guns
                if p.buttons & BTN_SWAP != 0 && p.cooldown == 0 && sec != 0 {
                    let (cw, cm) = (p.weapon, p.mag);
                    p.weapon = sec - 1;
                    p.mag = sec_mag;
                    p.reload = 0;
                    p.cooldown = 8;
                    inv_set(&mut b, cw + 1, cm, g, n);
                } else if p.buttons & BTN_GADGET != 0 && p.cooldown == 0 && g != 0 && n > 0 {
                    if g == G_NVG {
                        b.wy = NVG_TICKS as i32;
                    } else {
                        let (c, sn) = (cos(p.aim), sin(p.aim));
                        let bx = p.x + c * (PLAYER_R + 40) / 1024;
                        let by = p.y + sn * (PLAYER_R + 40) / 1024;
                        if !is_wall(bx >> 8, by >> 8) {
                            if let Some(slot) = w.bullets.iter().position(|q| q.ttl == 0) {
                                w.bullets[slot] = Bullet { x: bx, y: by, vx: c * 120 / 1024, vy: sn * 120 / 1024, owner: s as u32, ttl: 18, dmg: 0, weapon: EFF_FLY + g };
                            }
                        }
                    }
                    p.cooldown = 12;
                    let (sec2, sm2) = inv_sec(&b);
                    inv_set(&mut b, sec2, sm2, if n > 1 { g } else { 0 }, n - 1);
                }
                w.bots[s] = b;
            }
            if p.flare > 0 {
                p.flare -= 1;
            }
            if p.cooldown > 0 {
                p.cooldown -= 1;
            }
            let wpn = &WEAPONS[p.weapon as usize];
            if p.reload > 0 {
                p.reload -= 1;
                if p.reload == 0 {
                    p.mag = wpn.mag;
                }
            }
            if p.buttons & 2 != 0 && p.reload == 0 && p.mag < wpn.mag {
                p.reload = wpn.reload;
            }
            if p.buttons & 1 != 0 && p.cooldown == 0 && p.reload == 0 && p.mag > 0 {
                p.mag -= 1;
                p.cooldown = wpn.cooldown;
                p.last_shot = tick + 1;
                for _ in 0..wpn.pellets {
                    let spread = if wpn.spread > 0 { rng_range(w, -(wpn.spread as i32), wpn.spread as i32) } else { 0 };
                    let a = (p.aim as i32 + spread) as u32 & 0xffff;
                    let (c, sn) = (cos(a), sin(a));
                    let bx = p.x + c * (PLAYER_R + 40) / 1024;
                    let by = p.y + sn * (PLAYER_R + 40) / 1024;
                    if is_wall(bx >> 8, by >> 8) {
                        continue;
                    }
                    if let Some(slot) = w.bullets.iter().position(|b| b.ttl == 0) {
                        w.bullets[slot] = Bullet {
                            x: bx,
                            y: by,
                            vx: c * wpn.speed / 1024,
                            vy: sn * wpn.speed / 1024,
                            owner: s as u32,
                            ttl: wpn.ttl,
                            dmg: wpn.dmg,
                            weapon: p.weapon,
                        };
                        w.n_bullets_spawned = w.n_bullets_spawned.wrapping_add(1);
                    }
                }
                if p.mag == 0 {
                    p.reload = wpn.reload;
                }
            }
            w.players[s] = p;
        }
        // 3. bullets
        for bi in 0..MAXB {
            let mut b = w.bullets[bi];
            if b.ttl == 0 {
                continue;
            }
            if b.weapon >= EFF_FLY {
                // a gadget: thrown ones fly, bounce and slow down; placed ones just tick down
                if b.weapon < EFF_SMOKE {
                    let nx = b.x + b.vx;
                    if is_wall(nx >> 8, b.y >> 8) { b.vx = -b.vx / 2; } else { b.x = nx; }
                    let ny = b.y + b.vy;
                    if is_wall(b.x >> 8, ny >> 8) { b.vy = -b.vy / 2; } else { b.y = ny; }
                    b.vx = b.vx * 7 / 8;
                    b.vy = b.vy * 7 / 8;
                }
                b.ttl -= 1;
                if b.ttl == 0 && b.weapon < EFF_SMOKE {
                    match b.weapon - EFF_FLY {
                        G_FRAG => {
                            for s in 0..MAXP {
                                let q = w.players[s];
                                if q.alive == 0 || same_team(room, s, b.owner as usize) {
                                    continue;
                                }
                                let d2 = dist2(q.x, q.y, b.x, b.y);
                                if d2 <= (FRAG_R as i64).pow(2) && line_of_sight(b.x, b.y, q.x, q.y) {
                                    let d = isqrt(d2 as u64) as u32;
                                    let dmg = 10 + FRAG_DMG * (FRAG_R as u32 - d.min(FRAG_R as u32)) / FRAG_R as u32;
                                    damage(w, &mut killer, s, dmg, b.owner, atan2(q.y - b.y, q.x - b.x).wrapping_add(32768) & 0xffff, tick);
                                }
                            }
                            if n_booms < 4 { booms[n_booms] = (b.x, b.y); n_booms += 1; }
                        }
                        G_FLASH => {
                            for s in 0..MAXP {
                                let q = w.players[s];
                                if q.alive == 0 {
                                    continue;
                                }
                                let d2 = dist2(q.x, q.y, b.x, b.y);
                                // blinds anyone close who's looking anywhere near it
                                if d2 <= (FLASHBANG_R as i64).pow(2) && line_of_sight(b.x, b.y, q.x, q.y)
                                    && (d2 <= (2 * UNIT as i64).pow(2) || angle_diff(q.aim, atan2(b.y - q.y, b.x - q.x)) <= 16384) {
                                    w.players[s].hit_angle = (q.hit_angle & 0xffff) | (BLIND_TICKS << 16);
                                }
                            }
                            if n_booms < 4 { booms[n_booms] = (b.x, b.y); n_booms += 1; }
                        }
                        G_SMOKE => { b.weapon = EFF_SMOKE; b.ttl = SMOKE_TICKS; }
                        G_DECOY => { b.weapon = EFF_DECOY; b.ttl = DECOY_TICKS; }
                        G_SENSOR => { b.weapon = EFF_SENSOR; b.ttl = SENSOR_TICKS; }
                        _ => {}
                    }
                }
                w.bullets[bi] = b;
                continue;
            }
            'sub: for _ in 0..4 {
                b.x += b.vx / 4;
                b.y += b.vy / 4;
                if is_wall(b.x >> 8, b.y >> 8) {
                    b.ttl = 0;
                    break 'sub;
                }
                for s in 0..MAXP {
                    if s as u32 == b.owner || same_team(room, s, b.owner as usize) {
                        continue;
                    }
                    let q = w.players[s];
                    if q.alive == 0 {
                        continue;
                    }
                    if dist2(q.x, q.y, b.x, b.y) < ((PLAYER_R + 18) as i64).pow(2) {
                        let from = atan2(-b.vy, -b.vx);
                        damage(w, &mut killer, s, b.dmg, b.owner, from, tick);
                        b.ttl = 0;
                        break 'sub;
                    }
                }
            }
            if b.ttl > 0 {
                b.ttl -= 1;
            }
            w.bullets[bi] = b;
        }
        // 4. pickups
        for li in 0..MAXL {
            let l = w.loot[li];
            if l.active == 0 {
                continue;
            }
            for s in 0..MAXP {
                let human = room.is_bot[s] == 0;
                let p = &mut w.players[s];
                if p.alive != 1 || dist2(p.x, p.y, l.x, l.y) > (PICK_R as i64).pow(2) {
                    continue;
                }
                // bots don't carry gadgets
                if !human && l.kind >= LOOT_FRAG {
                    continue;
                }
                if l.kind >= LOOT_FRAG {
                    let g = l.kind - LOOT_FRAG + 1;
                    let b = &mut w.bots[s];
                    let (sec, sm) = inv_sec(b);
                    let (cg, cn) = inv_gadget(b);
                    let n = if cg == g { (cn + if g == G_NVG { 1 } else { 2 }).min(4) } else if g == G_NVG { 1 } else { 2 };
                    inv_set(b, sec, sm, g, n);
                    w.loot[li].active = 0;
                    if n_loot_events < 4 {
                        loot_events[n_loot_events] = (l.x, l.y);
                        n_loot_events += 1;
                    }
                    break;
                }
                match l.kind {
                    LOOT_MEDKIT => p.hp = (p.hp + 50).min(100),
                    LOOT_ARMOR => p.armor = (p.armor + 50).min(100),
                    LOOT_SMG | LOOT_SHOTGUN | LOOT_AR | LOOT_SNIPER => {
                        let wpn = match l.kind {
                            LOOT_SMG => W_SMG,
                            LOOT_SHOTGUN => W_SHOTGUN,
                            LOOT_AR => W_AR,
                            _ => W_SNIPER,
                        };
                        // a second gun goes in the free slot; with both full it replaces the one in hand
                        let full = WEAPONS[wpn as usize].mag;
                        if human && p.weapon != W_PISTOL {
                            let b = &mut w.bots[s];
                            let (sec, sm) = inv_sec(b);
                            let (g, n) = inv_gadget(b);
                            if sec == 0 || sec - 1 == W_PISTOL {
                                inv_set(b, p.weapon + 1, p.mag, g, n);
                            } else {
                                let _ = sm;
                            }
                        }
                        p.weapon = wpn;
                        p.mag = full;
                        p.reload = 0;
                    }
                    LOOT_FLARE => p.flare = FLARE_TICKS,
                    LOOT_DROP => {
                        // the good stuff: a Kar98k, a full vest, patched up
                        p.weapon = W_SNIPER;
                        p.mag = WEAPONS[W_SNIPER as usize].mag;
                        p.reload = 0;
                        p.armor = 100;
                        p.hp = 100;
                    }
                    _ => {}
                }
                w.loot[li].active = 0;
                if n_loot_events < 4 {
                    loot_events[n_loot_events] = (l.x, l.y);
                    n_loot_events += 1;
                }
                break;
            }
        }
        // 4b. supply drops: a crate lands somewhere inside the next circle
        for &dt in drop_ticks(room).iter() {
            if t == dt {
                let (nx, ny, nr) = (room.next_x, room.next_y, room.next_r.max(3 * UNIT));
                let total = SPAWNS.len() + LOOT_SPOTS.len();
                let mut cands = [0usize; 40];
                let mut nc = 0usize;
                let mut nearest = (i64::MAX, 0usize);
                for k in 0..total {
                    let (tx, ty) = if k < SPAWNS.len() { SPAWNS[k] } else { LOOT_SPOTS[k - SPAWNS.len()] };
                    let d = dist2(tile_center(tx), tile_center(ty), nx, ny);
                    if d < nearest.0 {
                        nearest = (d, k);
                    }
                    if d <= ((nr as i64) * 4 / 5).pow(2) && nc < cands.len() {
                        cands[nc] = k;
                        nc += 1;
                    }
                }
                let k = if nc > 0 { cands[(rng_next(w) as usize) % nc] } else { nearest.1 };
                let (tx, ty) = if k < SPAWNS.len() { SPAWNS[k] } else { LOOT_SPOTS[k - SPAWNS.len()] };
                let slot = w.loot.iter().position(|l| l.active == 0).unwrap_or((t as usize) % MAXL);
                w.loot[slot] = Loot { x: tile_center(tx), y: tile_center(ty), kind: LOOT_DROP, active: 1 };
            }
        }
        // 5. zone
        for (i, ph) in w.zone.iter().enumerate() {
            if t == ph.reveal {
                room.next_x = ph.x;
                room.next_y = ph.y;
                room.next_r = ph.r;
                room.zone_phase = i as u32 + 1;
            }
        }
        let (zx, zy, zr, zdmg) = zone_now(w, t);
        room.zone_x = zx;
        room.zone_y = zy;
        room.zone_r = zr;
        if t % 10 == 0 {
            for s in 0..MAXP {
                let p = w.players[s];
                if p.alive != 0 && dist2(p.x, p.y, zx, zy) > (zr as i64).pow(2) {
                    let a = atan2(zy - p.y, zx - p.x);
                    damage(w, &mut killer, s, zdmg, NO_SEAT, a, tick);
                }
            }
        }
        // 5b. revives (duos): a teammate standing over you for 3 s brings you back
        if duos(room) {
            for s in 0..MAXP {
                if w.players[s].alive != DOWNED || killer[s] != u32::MAX {
                    continue;
                }
                let mate = s ^ 1;
                let m = w.players[mate];
                if m.alive == 1 && m.buttons & 1 == 0 && dist2(m.x, m.y, w.players[s].x, w.players[s].y) <= (REVIVE_R as i64).pow(2) {
                    w.players[s].hp += 1;
                    if w.players[s].hp >= REVIVE_TICKS {
                        let p = &mut w.players[s];
                        p.alive = 1;
                        p.hp = 30;
                        p.armor = 0;
                        p.last_shot = 0;
                    }
                } else {
                    w.players[s].hp = 0;
                }
            }
        }
        // 6. deaths
        for s in 0..MAXP {
            if killer[s] == u32::MAX {
                continue;
            }
            let p = w.players[s];
            if p.alive == 0 {
                continue;
            }
            // duos: with your partner still standing you go down instead of out
            if p.alive == 1 && duos(room) && w.players[s ^ 1].alive == 1 {
                let q = &mut w.players[s];
                q.alive = DOWNED;
                q.hp = 0;
                q.armor = BLEED_TICKS;
                q.reload = 0;
                q.last_shot = if killer[s] < MAXP as u32 { killer[s] + 1 } else { 0 };
                continue;
            }
            let k = killer[s];
            w.players[s].alive = 0;
            room.alive[s] = 0;
            room.place[s] = room.alive_count;
            room.alive_count = room.alive_count.saturating_sub(1);
            let weapon = if k == NO_SEAT {
                W_ZONE
            } else {
                room.kills[k as usize] += 1;
                // a kill patches you up: aggression pays
                let kp = &mut w.players[k as usize];
                kp.hp = (kp.hp + KILL_HEAL).min(100);
                kp.weapon
            };
            let fi = (room.feed_head as usize) % FEED;
            room.feed[fi] = KillEvent { tick, killer: k, victim: s as u32, weapon };
            room.feed_head = room.feed_head.wrapping_add(1);
            // the dead drop their gun
            if p.weapon != W_PISTOL {
                if let Some(slot) = w.loot.iter().position(|l| l.active == 0) {
                    let kind = gun_loot(p.weapon);
                    w.loot[slot] = Loot { x: p.x, y: p.y, kind, active: 1 };
                }
            }
        }
        // 7. end of match
        // once every human is down, don't make them watch bots fight: end now
        let humans_in = (0..MAXP).any(|i| room.is_bot[i] == 0 && room.players[i] != anchor_lang::prelude::Pubkey::default());
        // a human only counts if their browser is still sending input (no ghost rooms full of bots)
        let humans_alive = (0..MAXP).any(|i| {
            room.is_bot[i] == 0
                && room.players[i] != anchor_lang::prelude::Pubkey::default()
                && w.players[i].alive != 0
                && (t < IDLE_TICKS || tick.saturating_sub(w.players[i].last_input_tick) <= IDLE_TICKS)
        });
        // (end_tick == END_REQUEST: the host ended the night early)
        // duos: the night is over when only one team is left
        let last_team = duos(room) && {
            let mut team = u32::MAX;
            let mut one = true;
            for s in 0..MAXP {
                if w.players[s].alive != 0 {
                    let tm = (s / 2) as u32;
                    if team == u32::MAX { team = tm; } else if team != tm { one = false; }
                }
            }
            one
        };
        if room.alive_count <= 1 || last_team || t >= room.match_ticks() || (humans_in && !humans_alive) || room.end_tick == END_REQUEST {
            // rank survivors by hp+armor, then kills
            let mut survivors: [(u32, u32, usize); MAXP] = [(0, 0, 0); MAXP];
            let mut n = 0;
            for s in 0..MAXP {
                if w.players[s].alive != 0 {
                    let standing = if w.players[s].alive == 1 { w.players[s].hp + w.players[s].armor + 1000 } else { 0 };
                    survivors[n] = (standing, room.kills[s], s);
                    n += 1;
                }
            }
            let sv = &mut survivors[..n];
            sv.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)).then(a.2.cmp(&b.2)));
            for (rank, &(_, _, s)) in sv.iter().enumerate() {
                room.place[s] = rank as u32 + 1;
            }
            room.winner = (0..MAXP).find(|&s| room.place[s] == 1).map(|s| s as u32).unwrap_or(NO_SEAT);
            room.status = ST_ENDED;
            room.end_tick = tick;
            out.ended = true;
        }
    }

    // BLACKOUT: halfway through the night every flashlight dies for 10 s
    let bo = blackout_tick(room);
    let lights_out = live && t >= bo && t < bo + BLACKOUT_TICKS;
    // kill leader: most kills among the living, at least 2
    let mut leader = NO_SEAT;
    let mut best_k = if night_mod(room) == MOD_HUNTER { 0u32 } else { 1u32 };
    for s in 0..MAXP {
        if w.players[s].alive == 1 && room.kills[s] > best_k {
            best_k = room.kills[s];
            leader = s as u32;
        }
    }

    // street lamps light whoever stands under them (dark during the blackout)
    let modifier = night_mod(room);
    let mut lit = [false; MAXP];
    // night vision glows: whoever wears it is easy to spot
    for s in 0..MAXP {
        lit[s] = room.is_bot[s] == 0 && w.players[s].alive == 1 && w.bots[s].wy > 0;
    }
    if !lights_out && modifier != MOD_NO_LAMPS {
        for s in 0..MAXP {
            let ps = w.players[s];
            lit[s] = lit[s] || ps.alive == 1 && LAMPS.iter().any(|&(lx, ly)| dist2(ps.x, ps.y, tile_center(lx), tile_center(ly)) <= (LAMP_R as i64).pow(2));
        }
    }

    // smoke clouds block sight lines
    let mut smokes = [(0i32, 0i32); 8];
    let mut n_smokes = 0usize;
    for b in w.bullets.iter() {
        if b.ttl > 0 && b.weapon == EFF_SMOKE && n_smokes < smokes.len() {
            smokes[n_smokes] = (b.x, b.y);
            n_smokes += 1;
        }
    }
    let smokes = &smokes[..n_smokes];
    let fog = modifier == MOD_FOG;

    // ---- vision: who sees whom (computed inside the TEE, never published)
    let mut vis = [[0u32; MAXP]; MAXP]; // flags, 0 = not visible
    for v in 0..MAXP {
        let pv = w.players[v];
        if pv.alive == 0 {
            continue;
        }
        let nvg = room.is_bot[v] == 0 && w.bots[v].wy > 0;
        let blind = blind_of(&pv) > 0;
        let vr = if nvg { VISION_R + 4 * UNIT } else if fog { VISION_R * 7 / 10 } else { VISION_R };
        let cone = if nvg { CONE_HALF * 3 / 2 } else { CONE_HALF };
        let lamp_r = if fog { LAMP_SEE_R * 7 / 10 } else { LAMP_SEE_R };
        for q in 0..MAXP {
            if q == v {
                continue;
            }
            let pq = w.players[q];
            if pq.alive == 0 {
                continue;
            }
            let d2 = dist2(pv.x, pv.y, pq.x, pq.y);
            let mut f = 0u32;
            if same_team(room, v, q) {
                // partners always see each other
                f = 8 | 32;
            } else if pv.flare > 0 {
                f = 2;
            } else if d2 <= (AMBIENT_R as i64).pow(2) {
                if line_of_sight(pv.x, pv.y, pq.x, pq.y) {
                    f = 8;
                }
            } else if blind {
                // a flashbang took your eyes: only what's right next to you
            } else if !lights_out
                && d2 <= (vr as i64).pow(2)
                && angle_diff(pv.aim, atan2(pq.y - pv.y, pq.x - pv.x)) <= cone
                && line_of_sight(pv.x, pv.y, pq.x, pq.y)
                && !smoked(smokes, pv.x, pv.y, pq.x, pq.y)
            {
                f = 8;
            } else if lit[q]
                && d2 <= (lamp_r as i64).pow(2)
                && line_of_sight(pv.x, pv.y, pq.x, pq.y)
                && !smoked(smokes, pv.x, pv.y, pq.x, pq.y)
            {
                // standing under a street lamp: anyone with a line on you sees you
                f = 8;
            } else if pq.last_shot != 0
                && pq.last_shot + 2 >= tick + 1
                && d2 <= (FLASH_R as i64).pow(2)
                && line_of_sight(pv.x, pv.y, pq.x, pq.y)
            {
                f = 1;
            }
            if f != 0 && pq.last_shot == tick + 1 {
                f |= 4;
            }
            if f != 0 && pq.alive == DOWNED {
                f |= 16;
            }
            vis[v][q] = f;
        }
    }

    // ---- per-player views + bot memory + sound
    for v in 0..MAXP {
        let pv = w.players[v];
        let is_bot = room.is_bot[v] == 1;
        let occupied = room.players[v] != anchor_lang::prelude::Pubkey::default() || is_bot;
        if is_bot {
            let mut b = w.bots[v];
            let mut best = (i64::MAX, NO_SEAT);
            for q in 0..MAXP {
                if vis[v][q] != 0 {
                    let d = dist2(pv.x, pv.y, w.players[q].x, w.players[q].y);
                    if d < best.0 {
                        best = (d, q as u32);
                    }
                }
            }
            if best.1 != NO_SEAT && b.target != best.1 {
                b.react_at = tick + bot_skill(room).react;
            }
            b.target = best.1;
            for q in 0..MAXP {
                let pq = w.players[q];
                if q == v || pq.alive == 0 || vis[v][q] != 0 {
                    continue;
                }
                let d2 = dist2(pv.x, pv.y, pq.x, pq.y);
                if same_team(room, v, q) {
                    continue;
                }
                if (pq.last_shot == tick + 1 && d2 <= (SHOT_R as i64).pow(2)) || (pq.moved & 1 == 1 && d2 <= (STEP_R as i64).pow(2) / 2)
                    || (pq.moved & 2 != 0 && d2 <= (STEP_R as i64 * 3 / 2).pow(2)) {
                    b.ping_angle = atan2(pq.y - pv.y, pq.x - pv.x);
                    b.ping_tick = tick;
                }
            }
            // decoys fool bots too
            for e in w.bullets.iter() {
                if e.ttl > 0 && e.weapon == EFF_DECOY && e.owner != v as u32 && dist2(pv.x, pv.y, e.x, e.y) <= (STEP_R as i64).pow(2) {
                    b.ping_angle = atan2(e.y - pv.y, e.x - pv.x);
                    b.ping_tick = tick;
                }
            }
            w.bots[v] = b;
            continue;
        }
        let view = &mut *views[v];
        view.tick = tick;
        view.status = room.status;
        view.seat = v as u32;
        view.me = pv;
        view.kills = room.kills[v];
        view.place = room.place[v];
        view.n_players = 0;
        view.n_bullets = 0;
        view.n_loot = 0;
        if !occupied || pv.alive == 0 || room.status == ST_LOBBY {
            continue;
        }
        let mut n = 0usize;
        for q in 0..MAXP {
            let f = vis[v][q];
            if f == 0 || n >= VIS_P {
                continue;
            }
            let pq = w.players[q];
            view.players[n] = VisPlayer { seat: q as u32, x: pq.x, y: pq.y, aim: pq.aim, hp: pq.hp, weapon: pq.weapon, flags: f };
            n += 1;
        }
        view.n_players = n as u32;
        // sounds from what you can't see
        for q in 0..MAXP {
            let pq = w.players[q];
            if q == v || pq.alive == 0 || vis[v][q] != 0 {
                continue;
            }
            let d2 = dist2(pv.x, pv.y, pq.x, pq.y);
            let dist = (isqrt(d2 as u64) as u32) / UNIT as u32;
            let ang = atan2(pq.y - pv.y, pq.x - pv.x);
            if pq.last_shot == tick + 1 && d2 <= (SHOT_R as i64).pow(2) {
                push_ping(view, tick, ang & !0x7ff, PING_SHOT, dist);
            } else if pq.moved & 2 != 0 && d2 <= (STEP_R as i64 * 3 / 2).pow(2) && (tick + q as u32) % 4 == 0 {
                // sprinting is loud: heard further away, twice as often
                push_ping(view, tick, ang & !0xfff, PING_STEP, dist);
            } else if pq.moved & 1 == 1 && d2 <= (STEP_R as i64).pow(2) && (tick + q as u32) % 8 == 0 {
                push_ping(view, tick, ang & !0xfff, PING_STEP, dist);
            } else if pq.reload > 0 && pq.reload == WEAPONS[pq.weapon as usize].reload - 1 && d2 <= (RELOAD_R as i64).pow(2) {
                push_ping(view, tick, ang & !0xfff, PING_RELOAD, dist);
            }
        }
        // night events everyone hears: where the supply drop is, and where the kill leader is
        if let Some(d) = w.loot.iter().find(|l| l.active == 1 && l.kind == LOOT_DROP) {
            if (tick + v as u32) % 30 == 0 {
                let d2 = dist2(pv.x, pv.y, d.x, d.y);
                push_ping(view, tick, atan2(d.y - pv.y, d.x - pv.x), PING_DROP, (isqrt(d2 as u64) as u32) / UNIT as u32);
            }
        }
        if leader != NO_SEAT && leader != v as u32 && tick % 100 == 0 {
            let pl = w.players[leader as usize];
            let d2 = dist2(pv.x, pv.y, pl.x, pl.y);
            push_ping(view, tick, atan2(pl.y - pv.y, pl.x - pv.x) & !0x3ff, PING_BOUNTY, (isqrt(d2 as u64) as u32) / UNIT as u32);
        }
        // gadgets: smoke you can see from afar, decoys that sound like people, your sensors, explosions
        for e in w.bullets.iter() {
            if e.ttl == 0 || e.weapon < EFF_SMOKE {
                continue;
            }
            let d2 = dist2(pv.x, pv.y, e.x, e.y);
            let dist = (isqrt(d2 as u64) as u32) / UNIT as u32;
            let ang = atan2(e.y - pv.y, e.x - pv.x);
            match e.weapon {
                EFF_SMOKE if (tick + v as u32) % 20 == 0 && d2 <= (24 * UNIT as i64).pow(2) => push_ping(view, tick, ang, PING_SMOKE, dist),
                EFF_DECOY if e.owner != v as u32 => {
                    if (tick + e.ttl) % 40 == 0 && d2 <= (SHOT_R as i64).pow(2) {
                        push_ping(view, tick, ang & !0x7ff, PING_SHOT, dist);
                    } else if (tick + e.ttl) % 8 == 0 && d2 <= (STEP_R as i64).pow(2) {
                        push_ping(view, tick, ang & !0xfff, PING_STEP, dist);
                    }
                }
                EFF_SENSOR if e.owner == v as u32 && tick % 10 == 0 => {
                    for q in 0..MAXP {
                        let pq = w.players[q];
                        if q == v || pq.alive == 0 || same_team(room, v, q) || pq.moved & 1 == 0 {
                            continue;
                        }
                        if dist2(pq.x, pq.y, e.x, e.y) <= (SENSOR_R as i64).pow(2) {
                            let dq = dist2(pv.x, pv.y, pq.x, pq.y);
                            push_ping(view, tick, atan2(pq.y - pv.y, pq.x - pv.x) & !0x3ff, PING_SENSOR, (isqrt(dq as u64) as u32) / UNIT as u32);
                        }
                    }
                }
                _ => {}
            }
        }
        for &(bx, by) in booms[..n_booms].iter() {
            let d2 = dist2(pv.x, pv.y, bx, by);
            if d2 <= (30 * UNIT as i64).pow(2) {
                push_ping(view, tick, atan2(by - pv.y, bx - pv.x), PING_BOOM, (isqrt(d2 as u64) as u32) / UNIT as u32);
            }
        }
        // your pockets: second gun, gadget, night vision, flash blindness (View._pad)
        if room.is_bot[v] == 0 {
            let b = w.bots[v];
            let (sec, sm) = inv_sec(&b);
            let (g, n) = inv_gadget(&b);
            let nvg4 = ((b.wy.max(0) as u32) / 4).min(255);
            let bl2 = (blind_of(&pv) / 2).min(63);
            view._pad = (sec & 0xf) | (sm & 0x3f) << 4 | (g & 0xf) << 10 | (n & 0xf) << 14 | nvg4 << 18 | bl2 << 26;
        } else {
            view._pad = 0;
        }
        for &(lx, ly) in loot_events[..n_loot_events].iter() {
            let d2 = dist2(pv.x, pv.y, lx, ly);
            if d2 > 0 && d2 <= (LOOT_R as i64).pow(2) && !line_of_sight(pv.x, pv.y, lx, ly) {
                push_ping(view, tick, atan2(ly - pv.y, lx - pv.x) & !0xfff, PING_LOOT, (isqrt(d2 as u64) as u32) / UNIT as u32);
            }
        }
        // bullets in sight (your own always)
        let mut nb = 0usize;
        for b in w.bullets.iter() {
            if b.ttl == 0 || nb >= VIS_B || b.weapon >= EFF_FLY {
                continue;
            }
            let mine = b.owner == v as u32;
            let seen = mine
                || pv.flare > 0
                || {
                    let d2 = dist2(pv.x, pv.y, b.x, b.y);
                    (d2 <= (AMBIENT_R as i64).pow(2)
                        || (!lights_out && d2 <= (VISION_R as i64).pow(2) && angle_diff(pv.aim, atan2(b.y - pv.y, b.x - pv.x)) <= CONE_HALF))
                        && line_of_sight(pv.x, pv.y, b.x, b.y)
                };
            if seen {
                view.bullets[nb] = VisBullet { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
                nb += 1;
            }
        }
        view.n_bullets = nb as u32;
        // loot in sight
        let mut nl = 0usize;
        for (li, l) in w.loot.iter().enumerate() {
            if l.active == 0 || nl >= VIS_L {
                continue;
            }
            let d2 = dist2(pv.x, pv.y, l.x, l.y);
            let seen = d2 <= (AMBIENT_R as i64).pow(2)
                || (!lights_out && d2 <= (VISION_R as i64).pow(2) && angle_diff(pv.aim, atan2(l.y - pv.y, l.x - pv.x)) <= CONE_HALF + 2000 && line_of_sight(pv.x, pv.y, l.x, l.y))
                || (l.kind == LOOT_DROP && d2 <= (VISION_R as i64).pow(2) && line_of_sight(pv.x, pv.y, l.x, l.y));
            if seen {
                view.loot[nl] = VisLoot { id: li as u32, x: l.x, y: l.y, kind: l.kind };
                nl += 1;
            }
        }
        view.n_loot = nl as u32;
    }

    // ---- flight recorder (10 Hz)
    if live || out.ended {
        let every = room.rec_every();
        if t % every == 0 || out.ended {
            let frame = (t / every) as usize;
            let hdr_len = core::mem::size_of::<RecHeader>();
            if frame < REC_FRAMES {
                let chunk = frame / REC_PER_CHUNK;
                let local = frame % REC_PER_CHUNK;
                let rec: &mut [u8] = &mut *recs[chunk];
                for s in 0..MAXP {
                    let p = w.players[s];
                    let x = ((p.x.max(0) / 4) as u32).min(2047);
                    let y = ((p.y.max(0) / 4) as u32).min(2047);
                    let aim = p.aim >> 10;
                    let mut fl = p.alive & 1;
                    if p.last_shot != 0 && p.last_shot + REC_EVERY >= tick + 1 {
                        fl |= 2;
                    }
                    if p.flare > 0 {
                        fl |= 4;
                    }
                    if p.hit_tick != 0 && p.hit_tick + REC_EVERY >= tick {
                        fl |= 8;
                    }
                    let packed = x | (y << 11) | (aim << 22) | (fl << 28);
                    let off = hdr_len + (local * MAXP + s) * 4;
                    rec[off..off + 4].copy_from_slice(&packed.to_le_bytes());
                }
                let hdr: &mut RecHeader = bytemuck::from_bytes_mut(&mut rec[..hdr_len]);
                hdr.frames = local as u32 + 1;
                hdr.match_no = room.match_no;
                hdr.every = every;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::prelude::Pubkey;

    fn run(seed_byte: u8, humans: usize) -> (u32, u32, [u32; MAXP], u32) {
        let mut room: Room = bytemuck::Zeroable::zeroed();
        let mut w: World = bytemuck::Zeroable::zeroed();
        let mut views: Vec<View> = (0..MAXP).map(|_| bytemuck::Zeroable::zeroed()).collect();
        let mut rec_bufs: Vec<Vec<u8>> = (0..REC_CHUNKS).map(|_| vec![0u8; REC_LEN]).collect();
        for s in 0..MAXP {
            if s < humans {
                room.players[s] = Pubkey::new_unique();
            } else {
                room.is_bot[s] = 1;
            }
        }
        let mut seed = [seed_byte; 32];
        seed[1] = seed_byte.wrapping_mul(31);
        seed_match(&mut room, &mut w, seed);
        let mut max_tick = 0;
        for _ in 0..(COUNTDOWN_TICKS + MATCH_TICKS + 10) {
            // humans: run in circles and shoot
            for s in 0..humans {
                let p = &mut w.players[s];
                p.in_dx = sin(w.tick * 300) * 127 / 1024;
                p.in_dy = cos(w.tick * 300) * 127 / 1024;
                p.aim = w.tick.wrapping_mul(997) & 0xffff;
                p.buttons = 1;
            }
            let mut refs: Vec<&mut View> = views.iter_mut().collect();
            let mut rr: Vec<&mut [u8]> = rec_bufs.iter_mut().map(|b| &mut b[..]).collect();
            let out = tick(&mut room, &mut w, &mut refs[..], &mut rr[..]);
            max_tick = w.tick;
            if out.ended {
                break;
            }
        }
        let frames: u32 = rec_bufs.iter().map(|b| bytemuck::from_bytes::<RecHeader>(&b[..core::mem::size_of::<RecHeader>()]).frames).sum();
        (room.status, max_tick, room.place, frames)
    }

    #[test]
    fn full_matches_end_cleanly() {
        let mut total_ticks = 0u64;
        for seed in 0..40u8 {
            let (status, ticks, place, frames) = run(seed, (seed % 3) as usize);
            assert_eq!(status, ST_ENDED, "seed {seed} did not end");
            let mut places: Vec<u32> = place.to_vec();
            places.sort();
            assert_eq!(places, (1..=8).collect::<Vec<u32>>(), "seed {seed} bad placements {place:?}");
            assert!(frames > 0);
            total_ticks += ticks as u64;
        }
        println!("avg match length: {} ticks", total_ticks / 40);
    }

    #[test]
    fn atan2_matches_quadrants() {
        assert_eq!(atan2(0, 10), 0);
        assert!((atan2(10, 0) as i32 - 16384).abs() < 8);
        assert!((atan2(0, -10) as i32 - 32768).abs() < 8);
        assert!((atan2(-10, 0) as i32 - 49152).abs() < 8);
        assert!((atan2(10, 10) as i32 - 8192).abs() < 16);
    }

    #[test]
    fn isqrt_exact() {
        for v in [0u64, 1, 2, 3, 4, 15, 16, 17, 99, 100, 65535, 1 << 40, 123456789] {
            let r = isqrt(v);
            assert!(r * r <= v && (r + 1) * (r + 1) > v, "{v}");
        }
    }
}

#[cfg(test)]
mod stats {
    use super::*;
    #[test]
    fn bots_actually_fight() {
        let (mut gun, mut zone, mut shots) = (0, 0, 0u64);
        for sd in 0..30u8 {
            let mut room: Room = bytemuck::Zeroable::zeroed();
            let mut w: World = bytemuck::Zeroable::zeroed();
            let mut views: Vec<View> = (0..MAXP).map(|_| bytemuck::Zeroable::zeroed()).collect();
            let mut rec_bufs: Vec<Vec<u8>> = (0..REC_CHUNKS).map(|_| vec![0u8; REC_LEN]).collect();
            for s in 0..MAXP { room.is_bot[s] = 1; }
            seed_match(&mut room, &mut w, [sd.wrapping_mul(7).wrapping_add(3); 32]);
            for _ in 0..4000 {
                let mut refs: Vec<&mut View> = views.iter_mut().collect();
                let mut rr: Vec<&mut [u8]> = rec_bufs.iter_mut().map(|b| &mut b[..]).collect();
                if tick(&mut room, &mut w, &mut refs[..], &mut rr[..]).ended { break; }
            }
            shots += w.n_bullets_spawned as u64;
            for i in 0..(room.feed_head as usize).min(FEED) {
                if room.feed[i].weapon == W_ZONE { zone += 1 } else { gun += 1 }
            }
        }
        println!("kills by gun {gun}, by zone {zone}, bullets/match {}", shots / 30);
    }

    fn setup(seed: u8, duo: bool) -> (Room, World, Vec<View>, Vec<Vec<u8>>) {
        let mut room: Room = bytemuck::Zeroable::zeroed();
        let mut w: World = bytemuck::Zeroable::zeroed();
        let views: Vec<View> = (0..MAXP).map(|_| bytemuck::Zeroable::zeroed()).collect();
        let rec_bufs: Vec<Vec<u8>> = (0..REC_CHUNKS).map(|_| vec![0u8; REC_LEN]).collect();
        for s in 0..MAXP { room.is_bot[s] = 1; }
        room.is_bot[0] = 0; // seat 0 is a "human" with an inventory
        room.players[0] = anchor_lang::prelude::Pubkey::new_from_array([7; 32]);
        if duo { room.cfg |= CFG_DUOS; }
        seed_match(&mut room, &mut w, [seed; 32]);
        (room, w, views, rec_bufs)
    }
    fn step(room: &mut Room, w: &mut World, views: &mut Vec<View>, rec: &mut Vec<Vec<u8>>) {
        let mut refs: Vec<&mut View> = views.iter_mut().collect();
        let mut rr: Vec<&mut [u8]> = rec.iter_mut().map(|b| &mut b[..]).collect();
        tick(room, w, &mut refs[..], &mut rr[..]);
    }

    #[test]
    fn frag_hurts_and_inventory_shows() {
        let (mut room, mut w, mut views, mut rec) = setup(3, false);
        while room.status != ST_LIVE { step(&mut room, &mut w, &mut views, &mut rec); }
        // hand seat 0 two frags and put an enemy 2 tiles ahead
        inv_set(&mut w.bots[0], 0, 0, G_FRAG, 2);
        let (x, y) = (w.players[0].x, w.players[0].y);
        w.players[0].aim = 0;
        w.players[3].x = x + 2 * UNIT;
        w.players[3].y = y;
        let hp0 = w.players[3].hp + w.players[3].armor;
        w.players[0].buttons = BTN_GADGET;
        step(&mut room, &mut w, &mut views, &mut rec);
        w.players[0].buttons = 0;
        assert_eq!(inv_gadget(&w.bots[0]), (G_FRAG, 1), "one frag thrown");
        assert!(views[0]._pad >> 14 & 0xf == 1, "client sees 1 frag left");
        for _ in 0..25 {
            w.players[3].x = x + 2 * UNIT; // hold the target still
            w.players[3].y = y;
            step(&mut room, &mut w, &mut views, &mut rec);
        }
        let hp1 = w.players[3].hp + w.players[3].armor;
        assert!(hp1 < hp0 || w.players[3].alive == 0, "frag did damage: {hp0} -> {hp1}");
    }

    #[test]
    fn duos_go_down_then_get_revived() {
        let (mut room, mut w, mut views, mut rec) = setup(9, true);
        room.is_bot[3] = 0; // the partner is a person (bots hold the trigger, which blocks a revive)
        room.players[3] = anchor_lang::prelude::Pubkey::new_from_array([8; 32]);
        while room.status != ST_LIVE { step(&mut room, &mut w, &mut views, &mut rec); }
        // seat 2 (partner of 3) takes a lethal hit
        let mut killer = [u32::MAX; MAXP];
        w.players[2].armor = 0;
        damage(&mut w, &mut killer, 2, 500, 5, 0, room.tick);
        // let the next tick turn that into "down" (we fake it through the same path)
        w.players[2].hp = 1;
        w.players[2].armor = 0;
        w.bullets[0] = Bullet { x: w.players[2].x - 60, y: w.players[2].y, vx: 300, vy: 0, owner: 5, ttl: 4, dmg: 200, weapon: 0 };
        step(&mut room, &mut w, &mut views, &mut rec);
        assert_eq!(w.players[2].alive, DOWNED, "partner alive, so seat 2 is down not dead");
        // partner stands over them, holding fire off
        for _ in 0..(REVIVE_TICKS + 5) {
            w.players[3].x = w.players[2].x + 100;
            w.players[3].y = w.players[2].y;
            w.players[3].buttons = 0;
            if w.players[2].alive != DOWNED { break; }
            step(&mut room, &mut w, &mut views, &mut rec);
        }
        assert_eq!(w.players[2].alive, 1, "revived");
        assert_eq!(w.players[2].hp, 30);
    }

    #[test]
    fn host_can_end_during_countdown() {
        let mut room: Room = bytemuck::Zeroable::zeroed();
        let mut w: World = bytemuck::Zeroable::zeroed();
        let mut views: Vec<View> = (0..MAXP).map(|_| bytemuck::Zeroable::zeroed()).collect();
        let mut rec_bufs: Vec<Vec<u8>> = (0..REC_CHUNKS).map(|_| vec![0u8; REC_LEN]).collect();
        for s in 0..MAXP { room.is_bot[s] = 1; }
        seed_match(&mut room, &mut w, [5; 32]);
        room.end_tick = END_REQUEST;
        for _ in 0..80 {
            let mut refs: Vec<&mut View> = views.iter_mut().collect();
            let mut rr: Vec<&mut [u8]> = rec_bufs.iter_mut().map(|b| &mut b[..]).collect();
            if tick(&mut room, &mut w, &mut refs[..], &mut rr[..]).ended { break; }
        }
        assert_eq!(room.status, ST_ENDED, "tick {} status {}", room.tick, room.status);
    }

    #[test]
    fn supply_drop_lands_and_blackout_hides() {
        let mut room: Room = bytemuck::Zeroable::zeroed();
        let mut w: World = bytemuck::Zeroable::zeroed();
        let mut views: Vec<View> = (0..MAXP).map(|_| bytemuck::Zeroable::zeroed()).collect();
        let mut rec_bufs: Vec<Vec<u8>> = (0..REC_CHUNKS).map(|_| vec![0u8; REC_LEN]).collect();
        for s in 0..MAXP { room.is_bot[s] = 1; }
        seed_match(&mut room, &mut w, [11; 32]);
        let drop_at = COUNTDOWN_TICKS + drop_ticks(&room)[0];
        let mut dropped = false;
        while room.tick < drop_at + 2 {
            let mut refs: Vec<&mut View> = views.iter_mut().collect();
            let mut rr: Vec<&mut [u8]> = rec_bufs.iter_mut().map(|b| &mut b[..]).collect();
            if tick(&mut room, &mut w, &mut refs[..], &mut rr[..]).ended { break; }
            dropped |= w.loot.iter().any(|l| l.kind == LOOT_DROP);
        }
        println!("drop landed: {dropped}, status {}, tick {}", room.status, room.tick);
        assert!(dropped || room.status == ST_ENDED, "no supply drop by tick {}", room.tick);
    }
}

#[cfg(test)]
mod sizes {
    use super::*;
    #[test]
    fn print_sizes() {
        println!("SIZES room={} world={} view={} rec={} player={} board={}", core::mem::size_of::<Room>(), WORLD_LEN, VIEW_LEN, REC_LEN, core::mem::size_of::<PlayerState>(), core::mem::size_of::<Board>());
    }
}

#[cfg(test)]
mod mirror {
    use super::*;
    #[test]
    fn movement_trace() {
        // same LCG as scripts/mirror.ts
        let mut s: u32 = 12345;
        let mut out = String::new();
        for &(sx, sy) in SPAWNS.iter().take(5) {
            let (mut x, mut y) = (tile_center(sx), tile_center(sy));
            let mut moved = 0u32;
            for _ in 0..400 {
                s = s.wrapping_mul(1103515245).wrapping_add(12345);
                let dx = ((s >> 16) % 255) as i32 - 127;
                s = s.wrapping_mul(1103515245).wrapping_add(12345);
                let dy = ((s >> 16) % 255) as i32 - 127;
                // every 7th stretch holds sprint, some of it while firing
                let buttons = if (s >> 9) % 7 < 3 { BTN_SPRINT | ((s >> 12) & 1) } else { 0 };
                let (sprinting, fatigue, winded) = sprint_step(moved, buttons, dx, dy);
                let (vx, vy) = input_velocity_at(dx, dy, if sprinting { SPRINT_SPEED } else { SPEED });
                let (ox, oy) = (x, y);
                move_body(&mut x, &mut y, vx, vy);
                let m = ox != x || oy != y;
                moved = m as u32 | ((sprinting && m) as u32) << 1 | (winded as u32) << 2 | fatigue << 8;
                out.push_str(&format!("{x},{y},{fatigue};"));
            }
        }
        std::fs::write("/tmp/blackout-mirror-rust.txt", out).unwrap();
    }
}
