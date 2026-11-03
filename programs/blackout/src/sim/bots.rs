//! How bots decide what to do, from what they saw last tick.
use super::*;

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

/// `may_pick`: whether this bot may search for a new waypoint this tick. Each search runs up
/// to 6 long line-of-sight checks, so only one bot does it per tick. When every bot searched
/// on the same tick (the first live one), that tick cost ~500k compute units and the crank,
/// which runs well under its 1.4M limit, failed and stopped.
pub fn bot_think(w: &mut World, room: &Room, seat: usize, tick: u32, may_pick: &mut bool) {
    let m = map_of(room);
    let sk = bot_skill(room);
    let style = bot_style(room, seat);
    let zone = (room.zone_x, room.zone_y, room.zone_r);
    let next = (room.next_x, room.next_y, room.next_r);
    let p = w.players[seat];
    let mut b = w.bots[seat];
    let mut dx: i32;
    let mut dy: i32;
    let aim: u32;
    let mut buttons = 0u32;

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
        // stalkers hold fire until they're close; rushers open up from further out
        let range = match style {
            STYLE_STALKER => sk.range * 3 / 4,
            STYLE_RUSHER => sk.range * 5 / 4,
            _ => sk.range,
        };
        if tick >= b.react_at && d < range && (tick / 6) % 4 < sk.fire {
            buttons |= 1;
        }
        if tick % 25 == (seat as u32 * 3) % 25 {
            b.strafe = -b.strafe;
        }
        let side = ang.wrapping_add(if b.strafe > 0 { 16384 } else { 49152 });
        dx = cos(side) * sk.strafe / 1024;
        dy = sin(side) * sk.strafe / 1024;
        if d > 7 * UNIT || (style == STYLE_RUSHER && d > 2 * UNIT) {
            let push = if style == STYLE_RUSHER { 120 } else { 90 };
            dx += cos(ang) * push / 1024;
            dy += sin(ang) * push / 1024;
        } else if d < 3 * UNIT && style != STYLE_RUSHER {
            dx -= cos(ang) * 90 / 1024;
            dy -= sin(ang) * 90 / 1024;
        }
    } else {
        if p.mag < WEAPONS[p.weapon as usize].mag / 2 && p.reload == 0 {
            buttons |= 2;
        }
        // stalkers remember a sound for longer and follow it
        let memory = if style == STYLE_STALKER { 100 } else { 40 };
        let heard = b.ping_tick != 0 && tick.saturating_sub(b.ping_tick) < memory;
        let outside = dist2(p.x, p.y, zone.0, zone.1) > ((zone.2 as i64) * 9 / 10).pow(2);
        let arrived = b.has_wp >= 1 && dist2(p.x, p.y, b.wx, b.wy) < (UNIT as i64 * 3 / 4).pow(2);
        // campers hold a spot for a while once they reach it (has_wp counts up while holding)
        let holding = style == STYLE_CAMPER && arrived && b.has_wp < 1 + CAMP_TICKS;
        if holding {
            b.has_wp += 1;
        }
        let pick_new = !holding && (b.has_wp == 0 || b.stuck > 12 || arrived);
        if outside {
            b.wx = zone.0;
            b.wy = zone.1;
            b.has_wp = 1;
        } else if heard {
            b.wx = p.x + cos(b.ping_angle) * 5 * UNIT / 1024;
            b.wy = p.y + sin(b.ping_angle) * 5 * UNIT / 1024;
            b.has_wp = 1;
        } else if pick_new && *may_pick {
            *may_pick = false;
            // waypoint: a spawn/loot spot inside the next circle, prefer ones in sight
            let total = SPAWNS.len() + LOOT_SPOTS.len();
            let mut best: Option<(i32, i32)> = None;
            for _ in 0..6 {
                let k = (rng_next(w) as usize) % total;
                let (tx, ty) = if k < SPAWNS.len() { m.spawns[k] } else { m.loot[k - SPAWNS.len()] };
                let (cx, cy) = (tile_center(tx), tile_center(ty));
                if dist2(cx, cy, next.0, next.1) > (next.2 as i64).pow(2) {
                    continue;
                }
                if line_of_sight(m, p.x, p.y, cx, cy) {
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
        if b.has_wp == 0 || holding {
            // waiting for its turn to pick a first waypoint, or camping: stand still
            dx = 0;
            dy = 0;
        }
        match style {
            STYLE_CAMPER if holding => buttons |= BTN_CROUCH,
            STYLE_STALKER if heard => buttons |= BTN_CROUCH, // creep up on it, silently
            STYLE_RUSHER if !outside => buttons |= BTN_SPRINT,
            _ => {}
        }
        b.sweep += if (tick / 30) % 2 == 0 { 500 } else { -500 };
        b.sweep = b.sweep.clamp(-9000, 9000);
        let look = if heard { b.ping_angle } else { ang };
        aim = (look as i32 + b.sweep) as u32 & 0xffff;
    }
    let pl = &mut w.players[seat];
    pl.in_dx = dx.clamp(-127, 127);
    pl.in_dy = dy.clamp(-127, 127);
    pl.aim = aim;
    pl.buttons = buttons;
    w.bots[seat] = b;
}
