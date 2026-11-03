//! What each player can know this tick: who sees whom, what bots remember, and each
//! player's private view. Computed inside the TEE and never published.
use super::*;

/// Who sees whom this tick, and the night events that affect it.
pub struct Sight {
    pub lights_out: bool,
    pub leader: u32,
    pub vis: [[u32; MAXP]; MAXP],
}

/// Does the segment a-b pass through any smoke cloud?
pub fn smoked(smokes: &[(i32, i32)], ax: i32, ay: i32, bx: i32, by: i32) -> bool {
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
pub fn push_ping(v: &mut View, tick: u32, angle: u32, kind: u32, dist: u32) {
    let i = (v.ping_head as usize) % PINGS;
    v.pings[i] = Ping { tick, angle, kind, dist };
    v.ping_head = v.ping_head.wrapping_add(1);
}

pub fn compute_sight(room: &Room, w: &World, live: bool, t: u32, tick: u32) -> Sight {
    let m = map_of(room);
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
            lit[s] = lit[s] || ps.alive == 1 && m.lamps.iter().any(|&(lx, ly)| dist2(ps.x, ps.y, tile_center(lx), tile_center(ly)) <= (LAMP_R as i64).pow(2));
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
    // One Light: only the carrier has a flashlight, and its glow gives them away
    let one_light = modifier == MOD_ONE_LIGHT;
    let carrier = if one_light && w.light > 0 { (w.light - 1) as usize } else { MAXP };
    if carrier < MAXP && !lights_out && w.players[carrier].alive == 1 {
        lit[carrier] = true;
    }

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
                if line_of_sight(m, pv.x, pv.y, pq.x, pq.y) {
                    f = 8;
                }
            } else if blind {
                // a flashbang took your eyes: only what's right next to you
            } else if !lights_out
                && (!one_light || v == carrier)
                && d2 <= (if pq.moved & 8 != 0 { vr * 7 / 10 } else { vr } as i64).pow(2)
                && angle_diff(pv.aim, atan2(pq.y - pv.y, pq.x - pv.x)) <= cone
                && line_of_sight(m, pv.x, pv.y, pq.x, pq.y)
                && !smoked(smokes, pv.x, pv.y, pq.x, pq.y)
            {
                f = 8;
            } else if lit[q]
                && d2 <= (lamp_r as i64).pow(2)
                && line_of_sight(m, pv.x, pv.y, pq.x, pq.y)
                && !smoked(smokes, pv.x, pv.y, pq.x, pq.y)
            {
                // standing under a street lamp: anyone with a line on you sees you
                f = 8;
            } else if pq.last_shot != 0
                && loud(pq.weapon)
                && pq.last_shot + 2 >= tick + 1
                && d2 <= (FLASH_R as i64).pow(2)
                && line_of_sight(m, pv.x, pv.y, pq.x, pq.y)
            {
                f = 1;
            }
            if f != 0 && pq.last_shot == tick + 1 {
                f |= 4;
            }
            if f != 0 && pq.alive == DOWNED {
                f |= 16;
            }
            if f != 0 && (pq.moved >> 4) & 0xf != 0 {
                f |= 128; // in the air
            }
            if f != 0 && pq.moved & 8 != 0 {
                f |= 256; // crouched
            }
            if f != 0 && q == carrier {
                f |= VIS_LIGHT;
            }
            vis[v][q] = f;
        }
    }
    Sight { lights_out, leader, vis }
}

/// A bot picks its target and remembers what it heard.
pub fn update_bot_memory(room: &Room, w: &mut World, v: usize, vis: &[[u32; MAXP]; MAXP], tick: u32) {
    let pv = w.players[v];
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
        if (pq.last_shot == tick + 1 && loud(pq.weapon) && d2 <= (SHOT_R as i64).pow(2)) || (pq.moved & 1 == 1 && pq.moved & 8 == 0 && d2 <= (STEP_R as i64).pow(2) / 2)
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
}

/// Who a dead player watches: their killer, or whoever got the killer, and so on. None if
/// the zone got them, or in duos while their partner still plays (no scouting for them).
pub fn spectate_target(room: &Room, w: &World, v: usize) -> Option<usize> {
    if duos(room) && w.players[v ^ 1].alive != 0 {
        return None;
    }
    let mut cur = v as u32;
    for _ in 0..MAXP {
        let n = (room.feed_head as usize).min(FEED);
        let killer = (1..=n).map(|i| room.feed[(room.feed_head as usize - i) % FEED]).find(|e| e.victim == cur)?.killer;
        if killer >= MAXP as u32 || killer == v as u32 {
            return None;
        }
        if w.players[killer as usize].alive != 0 {
            return Some(killer as usize);
        }
        cur = killer;
    }
    None
}

/// Death cam: fill a dead player's view with what their killer sees.
fn watch_killer(room: &Room, w: &World, view: &mut View, v: usize, vis: &[[u32; MAXP]; MAXP]) {
    let Some(k) = spectate_target(room, w, v) else { return };
    view.status |= VIEW_SPECTATING;
    let pk = w.players[k];
    view.players[0] = VisPlayer { seat: k as u32, x: pk.x, y: pk.y, aim: pk.aim, hp: pk.hp, weapon: pk.weapon, flags: 8 | VIS_WATCHED };
    let mut n = 1usize;
    for q in 0..MAXP {
        if vis[k][q] == 0 || q == v || n >= VIS_P {
            continue;
        }
        let pq = w.players[q];
        view.players[n] = VisPlayer { seat: q as u32, x: pq.x, y: pq.y, aim: pq.aim, hp: pq.hp, weapon: pq.weapon, flags: vis[k][q] };
        n += 1;
    }
    view.n_players = n as u32;
}

/// Fill in one human seat's private view.
#[allow(clippy::too_many_arguments)]
pub fn write_view(room: &Room, w: &World, view: &mut View, v: usize, sight: &Sight, booms: &[(i32, i32)], loot_events: &[(i32, i32)], tick: u32) {
    let m = map_of(room);
    let (vis, lights_out, leader) = (&sight.vis, sight.lights_out, sight.leader);
    let pv = w.players[v];
    let occupied = room.players[v] != anchor_lang::prelude::Pubkey::default();
    view.tick = tick;
    view.status = room.status;
    view.seat = v as u32;
    view.me = pv;
    view.kills = room.kills[v];
    view.place = room.place[v];
    view.n_players = 0;
    view.n_bullets = 0;
    view.n_loot = 0;
    if w.light == v as u32 + 1 {
        view.status |= VIEW_I_CARRY_LIGHT;
    }
    if occupied && pv.alive == 0 && room.status == ST_LIVE {
        watch_killer(room, w, view, v, vis);
        return;
    }
    if !occupied || pv.alive == 0 || room.status == ST_LOBBY {
        return;
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
        if pq.last_shot == tick + 1 && loud(pq.weapon) && d2 <= (SHOT_R as i64).pow(2) {
            push_ping(view, tick, ang & !0x7ff, PING_SHOT, dist);
        } else if pq.moved & 2 != 0 && d2 <= (STEP_R as i64 * 3 / 2).pow(2) && (tick + q as u32) % 4 == 0 {
            // sprinting is loud: heard further away, twice as often
            push_ping(view, tick, ang & !0xfff, PING_STEP, dist);
        } else if pq.moved & 1 == 1 && pq.moved & 8 == 0 && d2 <= (STEP_R as i64).pow(2) && (tick + q as u32) % 8 == 0 {
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
    for &(bx, by) in booms.iter() {
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
    for &(lx, ly) in loot_events.iter() {
        let d2 = dist2(pv.x, pv.y, lx, ly);
        if d2 > 0 && d2 <= (LOOT_R as i64).pow(2) && !line_of_sight(m, pv.x, pv.y, lx, ly) {
            push_ping(view, tick, atan2(ly - pv.y, lx - pv.x) & !0xfff, PING_LOOT, (isqrt(d2 as u64) as u32) / UNIT as u32);
        }
    }
    // bullets in sight (your own always)
    let mut nb = 0usize;
    for b in w.bullets.iter() {
        if b.ttl == 0 || nb >= VIS_B || b.weapon >= EFF_SMOKE {
            continue;
        }
        let mine = b.owner == v as u32;
        let seen = mine
            || pv.flare > 0
            || {
                let d2 = dist2(pv.x, pv.y, b.x, b.y);
                (d2 <= (AMBIENT_R as i64).pow(2)
                    || (!lights_out && d2 <= (VISION_R as i64).pow(2) && angle_diff(pv.aim, atan2(b.y - pv.y, b.x - pv.x)) <= CONE_HALF))
                    && line_of_sight(m, pv.x, pv.y, b.x, b.y)
            };
        if seen {
            // a thrown gadget rides along as a bullet tagged in the high bits: kind in vx, ticks left in vy
            view.bullets[nb] = if b.weapon >= EFF_FLY {
                VisBullet { x: b.x, y: b.y, vx: b.vx + ((b.weapon - EFF_FLY) as i32) * GADGET_TAG, vy: b.vy + b.ttl as i32 * GADGET_TAG }
            } else {
                VisBullet { x: b.x, y: b.y, vx: b.vx, vy: b.vy }
            };
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
            || (!lights_out && d2 <= (VISION_R as i64).pow(2) && angle_diff(pv.aim, atan2(l.y - pv.y, l.x - pv.x)) <= CONE_HALF + 2000 && line_of_sight(m, pv.x, pv.y, l.x, l.y))
            || (l.kind == LOOT_DROP && d2 <= (VISION_R as i64).pow(2) && line_of_sight(m, pv.x, pv.y, l.x, l.y));
        if seen {
            view.loot[nl] = VisLoot { id: li as u32, x: l.x, y: l.y, kind: l.kind };
            nl += 1;
        }
    }
    view.n_loot = nl as u32;
}
