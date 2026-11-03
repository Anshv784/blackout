//! The steps of one live tick that change the world, in the order they run.
use super::*;

pub fn zone_now(w: &World, t: u32) -> (i32, i32, i32, u32) {
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

pub fn damage(w: &mut World, killer: &mut [u32; MAXP], victim: usize, mut dmg: u32, src: u32, from_angle: u32, tick: u32) {
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


pub fn step_players(room: &Room, w: &mut World, killer: &mut [u32; MAXP], tick: u32) {
    let m = map_of(room);
    // 1. bots decide from what they saw last tick (one waypoint search per tick, see bot_think)
    let mut may_pick = true;
    for s in 0..MAXP {
        if room.is_bot[s] == 1 && w.players[s].alive == 1 {
            bot_think(w, room, s, tick, &mut may_pick);
        }
    }
    // 2. movement, aim, weapons
    // death crates: where the fallen lie. Solid to anyone on foot; a jump clears one, and bots step over.
    let mut boxes = [(0i32, 0i32); MAX_BOXES];
    let mut n_boxes = 0;
    for j in 0..MAXP {
        let seated = room.is_bot[j] == 1 || room.players[j] != anchor_lang::prelude::Pubkey::default();
        if seated && w.players[j].alive == 0 && n_boxes < MAX_BOXES {
            boxes[n_boxes] = (w.players[j].x, w.players[j].y);
            n_boxes += 1;
        }
    }
    for s in 0..MAXP {
        let mut p = w.players[s];
        if p.alive == 0 {
            continue;
        }
        let downed = p.alive == DOWNED;
        let (speed, sprinting, word) = move_step(p.moved, p.buttons, p.in_dx, p.in_dy, downed);
        let (vx, vy) = input_velocity_at(p.in_dx, p.in_dy, speed);
        let (ox, oy) = (p.x, p.y);
        let jumping = (word >> 4) & 0xf != 0;
        let solid: &[(i32, i32)] = if room.is_bot[s] == 1 || jumping { &[] } else { &boxes[..n_boxes] };
        move_body_boxes(m, &mut p.x, &mut p.y, vx, vy, solid);
        let moved = ox != p.x || oy != p.y;
        p.moved = moved as u32 | if sprinting && moved { word } else { word & !2 };
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
                    if !is_wall(m, bx >> 8, by >> 8) {
                        if let Some(slot) = w.bullets.iter().position(|q| q.ttl == 0) {
                            let v0 = throw_speed((p.buttons >> 8) & 0xff);
                            w.bullets[slot] = Bullet { x: bx, y: by, vx: c * v0 / 1024, vy: sn * v0 / 1024, owner: s as u32, ttl: THROW_TTL, dmg: 0, weapon: EFF_FLY + g };
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
                if is_wall(m, bx >> 8, by >> 8) {
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
}

pub fn step_bullets(room: &Room, w: &mut World, killer: &mut [u32; MAXP], booms: &mut [(i32, i32); 4], n_booms: &mut usize, tick: u32) {
    let m = map_of(room);
    // 3. bullets
    for bi in 0..MAXB {
        let mut b = w.bullets[bi];
        if b.ttl == 0 {
            continue;
        }
        if b.weapon >= EFF_FLY {
            // a gadget: thrown ones fly, bounce and slow down; placed ones just tick down
            if b.weapon < EFF_SMOKE {
                fly_step(m, &mut b.x, &mut b.y, &mut b.vx, &mut b.vy);
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
                            if d2 <= (FRAG_R as i64).pow(2) && line_of_sight(m, b.x, b.y, q.x, q.y) {
                                let d = isqrt(d2 as u64) as u32;
                                let dmg = 10 + FRAG_DMG * (FRAG_R as u32 - d.min(FRAG_R as u32)) / FRAG_R as u32;
                                damage(w, killer, s, dmg, b.owner, atan2(q.y - b.y, q.x - b.x).wrapping_add(32768) & 0xffff, tick);
                            }
                        }
                        if *n_booms < 4 { booms[*n_booms] = (b.x, b.y); *n_booms += 1; }
                    }
                    G_FLASH => {
                        for s in 0..MAXP {
                            let q = w.players[s];
                            if q.alive == 0 {
                                continue;
                            }
                            let d2 = dist2(q.x, q.y, b.x, b.y);
                            // blinds anyone close who's looking anywhere near it
                            if d2 <= (FLASHBANG_R as i64).pow(2) && line_of_sight(m, b.x, b.y, q.x, q.y)
                                && (d2 <= (2 * UNIT as i64).pow(2) || angle_diff(q.aim, atan2(b.y - q.y, b.x - q.x)) <= 16384) {
                                w.players[s].hit_angle = (q.hit_angle & 0xffff) | (BLIND_TICKS << 16);
                            }
                        }
                        if *n_booms < 4 { booms[*n_booms] = (b.x, b.y); *n_booms += 1; }
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
            if is_wall(m, b.x >> 8, b.y >> 8) {
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
                    damage(w, killer, s, b.dmg, b.owner, from, tick);
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
}

pub fn step_pickups(room: &Room, w: &mut World, loot_events: &mut [(i32, i32); 4], n_loot_events: &mut usize) {
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
            if !human && is_gadget_loot(l.kind) {
                continue;
            }
            if is_gadget_loot(l.kind) {
                let g = l.kind - LOOT_FRAG + 1;
                let b = &mut w.bots[s];
                let (sec, sm) = inv_sec(b);
                let (cg, cn) = inv_gadget(b);
                let n = if cg == g { (cn + if g == G_NVG { 1 } else { 2 }).min(4) } else if g == G_NVG { 1 } else { 2 };
                inv_set(b, sec, sm, g, n);
                w.loot[li].active = 0;
                if *n_loot_events < 4 {
                    loot_events[*n_loot_events] = (l.x, l.y);
                    *n_loot_events += 1;
                }
                break;
            }
            match l.kind {
                LOOT_MEDKIT => p.hp = (p.hp + 50).min(100),
                LOOT_ARMOR => p.armor = (p.armor + 50).min(100),
                LOOT_SMG | LOOT_SHOTGUN | LOOT_AR | LOOT_SNIPER | LOOT_DMR | LOOT_LMG | LOOT_XBOW => {
                    let wpn = loot_gun(l.kind).unwrap_or(W_SNIPER);
                    // a second gun goes in the free slot; with both full it replaces the one in hand
                    let full = WEAPONS[wpn as usize].mag;
                    if human && p.weapon != W_PISTOL {
                        let b = &mut w.bots[s];
                        let (sec, _) = inv_sec(b);
                        let (g, n) = inv_gadget(b);
                        if sec == 0 || sec - 1 == W_PISTOL {
                            inv_set(b, p.weapon + 1, p.mag, g, n);
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
            if *n_loot_events < 4 {
                loot_events[*n_loot_events] = (l.x, l.y);
                *n_loot_events += 1;
            }
            break;
        }
    }
}

pub fn step_supply_drops(room: &Room, w: &mut World, t: u32) {
    let m = map_of(room);
    // 4b. supply drops: a crate lands somewhere inside the next circle
    for &dt in drop_ticks(room).iter() {
        if t == dt {
            let (nx, ny, nr) = (room.next_x, room.next_y, room.next_r.max(3 * UNIT));
            let total = SPAWNS.len() + LOOT_SPOTS.len();
            let mut cands = [0usize; 40];
            let mut nc = 0usize;
            let mut nearest = (i64::MAX, 0usize);
            for k in 0..total {
                let (tx, ty) = if k < SPAWNS.len() { m.spawns[k] } else { m.loot[k - SPAWNS.len()] };
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
            let (tx, ty) = if k < SPAWNS.len() { m.spawns[k] } else { m.loot[k - SPAWNS.len()] };
            let slot = w.loot.iter().position(|l| l.active == 0).unwrap_or((t as usize) % MAXL);
            w.loot[slot] = Loot { x: tile_center(tx), y: tile_center(ty), kind: LOOT_DROP, active: 1 };
        }
    }
}

pub fn step_zone(room: &mut Room, w: &mut World, killer: &mut [u32; MAXP], t: u32, tick: u32) {
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
                damage(w, killer, s, zdmg, NO_SEAT, a, tick);
            }
        }
    }
}

pub fn step_revives(room: &Room, w: &mut World, killer: &[u32; MAXP]) {
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
}

pub fn step_deaths(room: &mut Room, w: &mut World, killer: &[u32; MAXP], tick: u32) {
    let m = map_of(room);
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
        if w.light == s as u32 + 1 {
            // the One Light passes to the killer, or to the next one standing
            let next = if k < MAXP as u32 && w.players[k as usize].alive == 1 { Some(k as usize) } else { (1..MAXP).map(|i| (s + i) % MAXP).find(|&i| w.players[i].alive == 1) };
            w.light = next.map_or(0, |i| i as u32 + 1);
        }
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
        // the dead drop what they carried, spread round the crate so each piece can be picked up:
        // the gun in hand, the second gun, armor and grenades (bots carry only a gun and armor)
        let human = room.is_bot[s] == 0;
        let (sec, gadget, n_gadget) = if human {
            let (sec, _) = inv_sec(&w.bots[s]);
            let (g, n) = inv_gadget(&w.bots[s]);
            (sec, g, n)
        } else {
            (0, 0, 0)
        };
        let mut drops = [0u32; 4];
        let mut n_drops = 0;
        if p.weapon != W_PISTOL {
            drops[n_drops] = gun_loot(p.weapon);
            n_drops += 1;
        }
        if sec > 0 && sec - 1 != W_PISTOL && sec - 1 != p.weapon {
            drops[n_drops] = gun_loot(sec - 1);
            n_drops += 1;
        }
        // (on the floor, `armor` counts bleed-out ticks, so only a standing death drops armor)
        if p.alive == 1 && p.armor > 0 {
            drops[n_drops] = LOOT_ARMOR;
            n_drops += 1;
        }
        if gadget > 0 && n_gadget > 0 {
            drops[n_drops] = LOOT_FRAG + gadget - 1;
            n_drops += 1;
        }
        const AROUND: [(i32, i32); 4] = [(BOX_R + 40, 0), (0, BOX_R + 40), (-(BOX_R + 40), 0), (0, -(BOX_R + 40))];
        for (i, &kind) in drops[..n_drops].iter().enumerate() {
            let (ox, oy) = AROUND[i];
            // off the crate where there's floor, on it where there's a wall
            let (lx, ly) = if circle_hits_wall(m, p.x + ox, p.y + oy, 1) { (p.x, p.y) } else { (p.x + ox, p.y + oy) };
            if let Some(slot) = w.loot.iter().position(|l| l.active == 0) {
                w.loot[slot] = Loot { x: lx, y: ly, kind, active: 1 };
            }
        }
    }
}

/// Returns true if the night just ended.
pub fn check_end(room: &mut Room, w: &World, t: u32, tick: u32) -> bool {
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
        // insertion sort: the standard library's stable sort adds ~10 KB for at most 8 entries
        for i in 1..sv.len() {
            let mut j = i;
            while j > 0 && (sv[j].0, sv[j].1, core::cmp::Reverse(sv[j].2)) > (sv[j - 1].0, sv[j - 1].1, core::cmp::Reverse(sv[j - 1].2)) {
                sv.swap(j, j - 1);
                j -= 1;
            }
        }
        for (rank, &(_, _, s)) in sv.iter().enumerate() {
            room.place[s] = rank as u32 + 1;
        }
        room.winner = (0..MAXP).find(|&s| room.place[s] == 1).map(|s| s as u32).unwrap_or(NO_SEAT);
        room.status = ST_ENDED;
        room.end_tick = tick;
        return true;
    }
    false
}
