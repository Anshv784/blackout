//! Everything random about a night, derived from the VRF seed and sealed inside World.
use super::*;

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
    let map = map_of(room);
    let m = (seed[31] as u32) % NIGHT_MODS;
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
            let (sx, sy) = (tile_center(map.spawns[k].0), tile_center(map.spawns[k].1));
            let far = placed[..n_placed].iter().all(|&(px, py)| dist2(px, py, sx, sy) >= (7 * UNIT as i64).pow(2));
            if far {
                pick = Some(k);
                break;
            }
        }
        let k = pick.unwrap_or_else(|| order.iter().copied().find(|&k| !used[k]).unwrap_or(0));
        used[k] = true;
        let (sx, sy) = (tile_center(map.spawns[k].0), tile_center(map.spawns[k].1));
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

    // loot: 10 of the spots, contents rolled from the VRF stream
    let mut spots = [0usize; LOOT_SPOTS.len()];
    for (i, s) in spots.iter_mut().enumerate() {
        *s = i;
    }
    for i in (1..spots.len()).rev() {
        let j = (rng_next(w) as usize) % (i + 1);
        spots.swap(i, j);
    }
    for i in 0..10usize.min(MAXL) {
        let (lx, ly) = map.loot[spots[i]];
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
    // the schedule is written for a 2:15 night and stretched to the 5:00 night
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

    // One Light: the night's only flashlight starts with a random fighter
    w.light = 0;
    if m == MOD_ONE_LIGHT && alive > 0 {
        let k = rng_next(w) % alive;
        let seat = (0..MAXP).filter(|&s| w.players[s].alive == 1).nth(k as usize).unwrap_or(0);
        w.light = seat as u32 + 1;
    }
}
