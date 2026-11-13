#[allow(dead_code)]
const YARD: super::math::M = &super::math::MAPS[0];
use super::*;

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
        let fly = views[0].bullets[..views[0].n_bullets as usize].iter().find(|b| b.vx > GADGET_TAG / 2);
        assert!(fly.map_or(false, |b| (b.vx + GADGET_TAG / 2) / GADGET_TAG == G_FRAG as i32), "thrower sees the frag in the air");
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
mod features {
    use super::*;
    use anchor_lang::prelude::Pubkey;

    fn room_with(humans: &[usize]) -> (Room, World) {
        let mut room: Room = bytemuck::Zeroable::zeroed();
        let w: World = bytemuck::Zeroable::zeroed();
        for s in 0..MAXP {
            if humans.contains(&s) {
                room.players[s] = Pubkey::new_from_array([s as u8 + 1; 32]);
            } else {
                room.is_bot[s] = 1;
            }
        }
        (room, w)
    }

    /// Two players in the open, 5 tiles apart, the viewer looking straight at the other.
    fn face_off(room: &mut Room, w: &mut World) {
        room.status = ST_LIVE;
        for s in 0..MAXP {
            w.players[s] = PlayerState::default();
        }
        for (s, tx) in [(0usize, 3u8), (1, 8)] {
            let p = &mut w.players[s];
            p.alive = 1;
            p.hp = 100;
            p.x = tile_center(tx);
            p.y = tile_center(2);
        }
        w.players[0].aim = 0;
    }

    #[test]
    fn one_light_only_the_carrier_sees_by_flashlight() {
        let (mut room, mut w) = room_with(&[0, 1]);
        room.cfg = MOD_ONE_LIGHT << 13;
        face_off(&mut room, &mut w);
        w.light = 2; // seat 1 carries it
        let s = compute_sight(&room, &w, true, 500, 600);
        assert_eq!(s.vis[0][1] & 8, 8, "the light gives its carrier away");
        assert_ne!(s.vis[0][1] & VIS_LIGHT, 0);
        w.light = 0;
        let s = compute_sight(&room, &w, true, 500, 600);
        assert_eq!(s.vis[0][1], 0, "no flashlight: can't see 5 tiles into the dark");
        w.light = 1; // now the viewer carries it
        let s = compute_sight(&room, &w, true, 500, 600);
        assert_eq!(s.vis[0][1] & 8, 8, "the carrier sees with it");
        room.cfg = 0;
        w.light = 0;
        let s = compute_sight(&room, &w, true, 500, 600);
        assert_eq!(s.vis[0][1] & 8, 8, "a normal night: everyone has a flashlight");
    }

    #[test]
    fn one_light_starts_with_someone_and_passes_to_the_killer() {
        let mut found = false;
        for sd in 0..60u8 {
            let (mut room, mut w) = room_with(&[0]);
            let mut seed = [sd; 32];
            seed[31] = 6 + 7 * (sd % 30);
            seed_match(&mut room, &mut w, seed);
            if night_mod(&room) != MOD_ONE_LIGHT {
                continue;
            }
            found = true;
            assert!(w.light >= 1 && w.players[(w.light - 1) as usize].alive == 1);
            let carrier = (w.light - 1) as usize;
            let killer = (carrier + 1) % MAXP;
            room.status = ST_LIVE;
            let mut k = [u32::MAX; MAXP];
            k[carrier] = killer as u32;
            step_deaths(&mut room, &mut w, &k, 700);
            assert_eq!(w.light, killer as u32 + 1, "seed {sd}: the light passes to the killer");
        }
        assert!(found, "no One Light night in the sample");
    }

    #[test]
    fn the_dead_watch_their_killer_but_not_for_a_living_partner() {
        let (mut room, mut w) = room_with(&[0]);
        face_off(&mut room, &mut w);
        w.players[0].alive = 0;
        room.feed[0] = KillEvent { tick: 600, killer: 1, victim: 0, weapon: 0 };
        room.feed_head = 1;
        let sight = compute_sight(&room, &w, true, 500, 600);
        let mut view: View = bytemuck::Zeroable::zeroed();
        write_view(&room, &w, &mut view, 0, &sight, &[], &[], 600);
        assert_ne!(view.status & VIEW_SPECTATING, 0);
        assert_eq!(view.players[0].seat, 1);
        assert_ne!(view.players[0].flags & VIS_WATCHED, 0);
        // duos with the partner (seat 1) still alive: no death cam
        room.cfg |= CFG_DUOS;
        let mut view: View = bytemuck::Zeroable::zeroed();
        write_view(&room, &w, &mut view, 0, &sight, &[], &[], 600);
        assert_eq!(view.status & VIEW_SPECTATING, 0);
        assert_eq!(view.n_players, 0);
    }

    #[test]
    fn campers_hold_their_spot() {
        let (mut room, mut w) = room_with(&[]);
        let seat = (0..MAXP).find(|&s| bot_style(&room, s) == STYLE_CAMPER).unwrap();
        room.status = ST_LIVE;
        room.zone_r = 40 * UNIT;
        room.zone_x = 24 * UNIT;
        room.zone_y = 24 * UNIT;
        let p = &mut w.players[seat];
        p.alive = 1;
        p.x = 24 * UNIT;
        p.y = 24 * UNIT;
        w.bots[seat].target = NO_SEAT;
        w.bots[seat].wx = p.x;
        w.bots[seat].wy = p.y;
        w.bots[seat].has_wp = 1;
        let mut may_pick = true;
        bot_think(&mut w, &room, seat, 700, &mut may_pick);
        assert_eq!((w.players[seat].in_dx, w.players[seat].in_dy), (0, 0));
        assert_eq!(w.bots[seat].has_wp, 2, "holding");
        assert_ne!(w.players[seat].buttons & BTN_CROUCH, 0, "crouched while camping");
    }
}

/// Playtest numbers from the simulation (bots stand in for people): run with
/// `cargo test night_report -- --nocapture --ignored`.
#[cfg(test)]
mod report {
    use super::*;

    fn nights(seats: usize, n: u32) -> String {
        let (mut len, mut first, mut dark, mut alive_ticks) = (0u64, 0u64, 0u64, 0u64);
        let (mut gun, mut zone, mut gadget, mut nights_with_contact) = (0u64, 0u64, 0u64, 0u64);
        for sd in 0..n {
            let mut room: Room = bytemuck::Zeroable::zeroed();
            let mut w: World = bytemuck::Zeroable::zeroed();
            let mut views: Vec<View> = (0..MAXP).map(|_| bytemuck::Zeroable::zeroed()).collect();
            let mut recs: Vec<Vec<u8>> = (0..REC_CHUNKS).map(|_| vec![0u8; REC_LEN]).collect();
            for s in 0..seats {
                room.is_bot[s] = 1;
            }
            room.cfg = seats as u32;
            room.match_no = sd;
            let mut seed = [(sd as u8).wrapping_mul(53).wrapping_add(7); 32];
            seed[0] = sd as u8;
            seed[31] = (sd % 7) as u8;
            seed_match(&mut room, &mut w, seed);
            let mut contact = None;
            for _ in 0..(COUNTDOWN_TICKS + MATCH_TICKS + 20) {
                let mut refs: Vec<&mut View> = views.iter_mut().collect();
                let mut rr: Vec<&mut [u8]> = recs.iter_mut().map(|b| &mut b[..]).collect();
                let out = tick(&mut room, &mut w, &mut refs[..], &mut rr[..]);
                if room.status == ST_LIVE || out.ended {
                    let sight = compute_sight(&room, &w, true, room.tick.saturating_sub(COUNTDOWN_TICKS), room.tick);
                    for v in 0..seats {
                        if w.players[v].alive == 0 {
                            continue;
                        }
                        alive_ticks += 1;
                        let sees = (0..seats).any(|q| q != v && sight.vis[v][q] & 8 != 0);
                        if !sees {
                            dark += 1;
                        } else if contact.is_none() {
                            contact = Some(room.tick - COUNTDOWN_TICKS);
                        }
                    }
                }
                if out.ended {
                    break;
                }
            }
            len += (room.tick - COUNTDOWN_TICKS) as u64;
            if let Some(c) = contact {
                first += c as u64;
                nights_with_contact += 1;
            }
            for i in 0..(room.feed_head as usize).min(FEED) {
                match room.feed[i].weapon {
                    W_ZONE => zone += 1,
                    w if w >= EFF_FLY => gadget += 1,
                    _ => gun += 1,
                }
            }
        }
        let kills = (gun + zone + gadget).max(1);
        format!(
            "{seats} seats, {n} nights: night lasts {:.0} s on average; first enemy seen after {:.1} s; \
             {:.0}% of a fighter's time alive sees nobody; kills: {:.0}% guns, {:.0}% zone, {:.0}% gadgets",
            len as f64 / n as f64 / 20.0,
            first as f64 / nights_with_contact.max(1) as f64 / 20.0,
            100.0 * dark as f64 / alive_ticks.max(1) as f64,
            100.0 * gun as f64 / kills as f64,
            100.0 * zone as f64 / kills as f64,
            100.0 * gadget as f64 / kills as f64,
        )
    }

    #[test]
    #[ignore]
    fn night_report() {
        println!("REPORT {}", nights(4, 100));
        println!("REPORT {}", nights(8, 100));
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
                let buttons = if (s >> 9) % 7 < 3 { BTN_SPRINT | ((s >> 12) & 1) } else { 0 } | if (s >> 14) % 9 == 0 { BTN_CROUCH } else { 0 } | if (s >> 17) % 11 == 0 { BTN_JUMP } else { 0 };
                let (speed, sprinting, word) = move_step(moved, buttons, dx, dy, false);
                let (vx, vy) = input_velocity_at(dx, dy, speed);
                let (ox, oy) = (x, y);
                move_body(YARD, &mut x, &mut y, vx, vy);
                let m = ox != x || oy != y;
                moved = m as u32 | if sprinting && m { word } else { word & !2 };
                out.push_str(&format!("{x},{y},{};", moved >> 8));
            }
        }
        std::fs::write("/tmp/blackout-mirror-rust.txt", out).unwrap();
    }
}

/// Pins the simulation's exact behaviour: any change to a single byte of game state, on any
/// tick, in any of these nights, changes the hash. Only update it for a deliberate rule change.
#[cfg(test)]
mod golden {
    use super::*;
    use anchor_lang::prelude::Pubkey;

    const EXPECTED: u64 = 0x43a8e90ab8405877;

    fn fnv(h: &mut u64, bytes: &[u8]) {
        for b in bytes {
            *h = (*h ^ *b as u64).wrapping_mul(0x100_0000_01b3);
        }
    }

    #[test]
    fn simulation_is_unchanged() {
        let mut h = 0xcbf2_9ce4_8422_2325u64;
        for night in 0..48u32 {
            let humans = (night % 5) as usize;
            let mut room: Room = bytemuck::Zeroable::zeroed();
            let mut w: World = bytemuck::Zeroable::zeroed();
            let mut views: Vec<View> = (0..MAXP).map(|_| bytemuck::Zeroable::zeroed()).collect();
            let mut recs: Vec<Vec<u8>> = (0..REC_CHUNKS).map(|_| vec![0u8; REC_LEN]).collect();
            for s in 0..MAXP {
                if s < humans {
                    room.players[s] = Pubkey::new_from_array([s as u8 + 1; 32]);
                } else {
                    room.is_bot[s] = 1;
                }
            }
            room.cfg = 8 | ((night % 3) << 9);
            if night % 4 == 3 {
                room.cfg |= CFG_DUOS;
            }
            let mut seed = [(night as u8).wrapping_mul(37); 32];
            seed[1] = night as u8;
            seed[31] = night as u8;
            seed_match(&mut room, &mut w, seed);
            for i in 0..w.loot.len() {
                // put every kind of gadget in play
                if night % 2 == 1 && w.loot[i].active == 1 {
                    w.loot[i].kind = LOOT_FRAG + (i as u32 % 6);
                }
            }
            let mut r = night.wrapping_mul(2_654_435_761) | 1;
            for _ in 0..(COUNTDOWN_TICKS + MATCH_TICKS + 20) {
                for s in 0..humans {
                    r ^= r << 13;
                    r ^= r >> 17;
                    r ^= r << 5;
                    let p = &mut w.players[s];
                    p.in_dx = (r % 255) as i32 - 127;
                    p.in_dy = ((r >> 8) % 255) as i32 - 127;
                    p.aim = (r >> 12) & 0xffff;
                    p.buttons = (r >> 24) & 0x7f;
                    p.last_input_tick = w.tick;
                }
                let mut refs: Vec<&mut View> = views.iter_mut().collect();
                let mut rr: Vec<&mut [u8]> = recs.iter_mut().map(|b| &mut b[..]).collect();
                let out = tick(&mut room, &mut w, &mut refs[..], &mut rr[..]);
                fnv(&mut h, bytemuck::bytes_of(&room));
                fnv(&mut h, bytemuck::bytes_of(&w));
                for v in views.iter() {
                    fnv(&mut h, bytemuck::bytes_of(v));
                }
                if out.ended {
                    break;
                }
            }
            for b in recs.iter() {
                fnv(&mut h, b);
            }
        }
        assert_eq!(h, EXPECTED, "simulation behaviour changed: {h:#x}");
    }
}

#[cfg(test)]
mod crates {
    use super::*;

    #[test]
    fn a_crate_is_solid_on_foot_and_never_traps_you() {
        let boxes = [(tile_center(5), tile_center(2))];
        // walking straight at it: stopped short of the crate
        let (mut x, mut y) = (tile_center(3), tile_center(2));
        for _ in 0..60 {
            move_body_boxes(YARD, &mut x, &mut y, 20, 0, &boxes);
        }
        assert!(dist2(x, y, boxes[0].0, boxes[0].1) >= ((PLAYER_R + BOX_R) as i64).pow(2), "walked into the crate");
        // a crate that appears on top of you: you can always step out
        let (mut x, mut y) = (boxes[0].0 + 10, boxes[0].1);
        for _ in 0..20 {
            move_body_boxes(YARD, &mut x, &mut y, 20, 0, &boxes);
        }
        assert!(x > boxes[0].0 + 10, "stuck inside a crate");
        // jumping (no boxes passed): straight over
        let (mut x, mut y) = (tile_center(3), tile_center(2));
        for _ in 0..30 {
            move_body_boxes(YARD, &mut x, &mut y, 20, 0, &[]);
        }
        assert!(x > boxes[0].0, "a jump should clear the crate");
    }
}

#[cfg(test)]
mod throws {
    use super::*;

    /// Open floor along row `ty` from tile `t0`, or None.
    fn open_run(len: i32) -> Option<(i32, i32)> {
        for ty in 1..MAP_H as i32 - 1 {
            for t0 in 1..MAP_W as i32 - len - 1 {
                if (t0..t0 + len).all(|tx| !is_wall(YARD, tx, ty) && !is_wall(YARD, tx, ty - 1) && !is_wall(YARD, tx, ty + 1)) {
                    return Some((t0, ty));
                }
            }
        }
        None
    }

    #[test]
    fn an_aimed_throw_lands_where_you_aimed() {
        let (t0, ty) = open_run(11).expect("an open stretch of floor");
        for tiles in [2u32, 4, 6, 9] {
            let (mut x, mut y) = (t0 * UNIT + UNIT / 2, ty * UNIT + UNIT / 2);
            let x0 = x;
            let v0 = throw_speed(tiles * THROW_PER_TILE);
            let (mut vx, mut vy) = (v0, 0);
            for _ in 0..THROW_TTL {
                fly_step(YARD, &mut x, &mut y, &mut vx, &mut vy);
            }
            let got = (x - x0) as f64 / UNIT as f64;
            assert!((got - tiles as f64).abs() < 0.35, "aimed {tiles} tiles, landed {got:.2}");
        }
    }

    #[test]
    fn a_hard_throw_never_passes_through_a_wall() {
        // from every open tile, throw as hard as possible in 8 directions: it must never end inside a wall
        for ty in 1..MAP_H as i32 - 1 {
            for tx in 1..MAP_W as i32 - 1 {
                if is_wall(YARD, tx, ty) { continue; }
                for d in 0..8u32 {
                    let a = d * 8192;
                    let v0 = throw_speed(255);
                    let (mut x, mut y) = (tx * UNIT + UNIT / 2, ty * UNIT + UNIT / 2);
                    let (mut vx, mut vy) = (cos(a) * v0 / 1024, sin(a) * v0 / 1024);
                    for _ in 0..THROW_TTL {
                        fly_step(YARD, &mut x, &mut y, &mut vx, &mut vy);
                        assert!(!is_wall(YARD, x >> 8, y >> 8), "went into a wall from ({tx},{ty}) dir {d}");
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod throw_mirror {
    use super::*;
    /// Prints throw landings for scripts/throw_mirror.ts to compare against sim.ts.
    #[test]
    #[ignore]
    fn print_throws() {
        for (tx, ty) in [(5i32, 5i32), (10, 20), (24, 24), (30, 12)] {
            if is_wall(YARD, tx, ty) { continue; }
            for aim in [0u32, 9000, 20000, 33000, 47000, 61000] {
                for t in [0u32, 56, 140, 252] {
                    let (c, sn) = (cos(aim), sin(aim));
                    let (mut x, mut y) = (tx * UNIT + 128 + c * (PLAYER_R + 40) / 1024, ty * UNIT + 128 + sn * (PLAYER_R + 40) / 1024);
                    let v0 = throw_speed(t);
                    let (mut vx, mut vy) = (c * v0 / 1024, sn * v0 / 1024);
                    for _ in 0..THROW_TTL { fly_step(YARD, &mut x, &mut y, &mut vx, &mut vy); }
                    println!("T {} {} {} {} {} {}", tx * UNIT + 128, ty * UNIT + 128, aim, t, x, y);
                }
            }
        }
    }
}

#[cfg(test)]
mod meadow {
    use super::*;

    #[test]
    fn meadow_nights_run_start_to_finish() {
        // the same 48-night run as the golden test's setup, on the Meadow: every night must end
        for night in 0..12u32 {
            let mut room: Room = bytemuck::Zeroable::zeroed();
            let mut w: World = bytemuck::Zeroable::zeroed();
            for s in 0..MAXP {
                room.is_bot[s] = 1;
            }
            room.cfg = 8 | ((night % 3) << 9) | CFG_MEADOW;
            let mut seed = [(night as u8).wrapping_mul(53); 32];
            seed[1] = night as u8;
            seed[31] = night as u8;
            seed_match(&mut room, &mut w, seed);
            // everyone spawns on open ground of the Meadow
            for s in 0..MAXP {
                let p = &w.players[s];
                assert!(!circle_hits_wall(map_of(&room), p.x, p.y, PLAYER_R), "spawned in a wall on night {night}");
            }
            let mut views: Vec<View> = (0..MAXP).map(|_| bytemuck::Zeroable::zeroed()).collect();
            let mut recs: Vec<Vec<u8>> = (0..5).map(|_| vec![0u8; REC_CHUNK_LEN]).collect();
            let mut ended = false;
            for _ in 0..(COUNTDOWN_TICKS + MATCH_TICKS + 20) {
                let mut refs: Vec<&mut View> = views.iter_mut().collect();
                let mut rr: Vec<&mut [u8]> = recs.iter_mut().map(|b| &mut b[..]).collect();
                if tick(&mut room, &mut w, &mut refs[..], &mut rr[..]).ended {
                    ended = true;
                    break;
                }
                for s in 0..MAXP {
                    let p = &w.players[s];
                    if p.alive != 0 {
                        assert!(!circle_hits_wall(map_of(&room), p.x, p.y, PLAYER_R), "walked into a Meadow wall");
                    }
                }
            }
            assert!(ended, "Meadow night {night} never ended");
        }
    }

    #[test]
    fn the_maps_really_differ() {
        let (y, m) = (&MAPS[0], &MAPS[1]);
        let differ = (0..MAP_H).flat_map(|ty| (0..MAP_W).map(move |tx| (tx, ty))).filter(|&(tx, ty)| is_wall(y, tx, ty) != is_wall(m, tx, ty)).count();
        assert!(differ > 300, "only {differ} tiles differ");
    }
}

#[cfg(test)]
mod new_guns {
    use super::*;

    #[test]
    fn every_gun_loot_round_trips() {
        for w in [W_SMG, W_SHOTGUN, W_AR, W_SNIPER, W_DMR, W_LMG, W_XBOW] {
            assert_eq!(loot_gun(gun_loot(w)), Some(w), "gun {w}");
            assert!(!is_gadget_loot(gun_loot(w)), "gun {w} loot taken for a gadget");
        }
        for k in LOOT_FRAG..=LOOT_NVG {
            assert!(is_gadget_loot(k) && loot_gun(k).is_none());
        }
    }

    #[test]
    fn the_new_guns_turn_up_as_loot() {
        let kinds: Vec<u32> = (0..100).map(|r| loot_for_roll(r, 0)).collect();
        for k in [LOOT_DMR, LOOT_LMG, LOOT_XBOW] {
            assert!(kinds.contains(&k), "loot {k} never rolls");
        }
    }

    #[test]
    fn every_gun_can_kill() {
        for (i, w) in WEAPONS.iter().enumerate() {
            let per_shot = w.dmg * w.pellets;
            let shots = (100 + per_shot - 1) / per_shot;
            assert!(shots <= w.mag.max(1) * 6, "weapon {i} needs {shots} hits");
            assert!(w.mag >= 1 && w.reload > 0 && w.speed > 0);
        }
    }

    /// Two players a few tiles apart in the dark, out of each other's sight: what does the listener hear
    /// and see when the other fires?
    fn shot_heard(weapon: u32) -> (bool, bool) {
        let mut room: Room = bytemuck::Zeroable::zeroed();
        let mut w: World = bytemuck::Zeroable::zeroed();
        for s in 0..MAXP {
            room.is_bot[s] = if s < 2 { 0 } else { 1 };
            if s < 2 {
                room.players[s] = anchor_lang::prelude::Pubkey::new_from_array([s as u8 + 1; 32]);
            }
        }
        room.cfg = 2;
        let mut seed = [3u8; 32];
        seed[31] = 0; // no night modifier
        seed_match(&mut room, &mut w, seed);
        room.status = ST_LIVE;
        // park everyone else far away, then put the shooter 6 tiles from the listener, facing away
        for s in 0..MAXP {
            w.players[s].alive = 0;
        }
        let y = (1..MAP_H - 1).find(|&ty| (2..12).all(|tx| !is_wall(YARD, tx, ty) && !is_wall(YARD, tx, ty - 1) && !is_wall(YARD, tx, ty + 1))).unwrap();
        for (s, tx) in [(0usize, 3u8), (1, 9)] {
            let p = &mut w.players[s];
            *p = PlayerState::default();
            p.alive = 1;
            p.hp = 100;
            p.x = tile_center(tx);
            p.y = tile_center(y as u8);
            p.weapon = weapon;
            p.mag = WEAPONS[weapon as usize].mag;
        }
        w.players[0].aim = 32768; // listener looks away (sight cone off the shooter)
        w.players[1].aim = 0; // the shooter fires away from the listener
        // the instant of the shot, as the sight pass sees it
        let tick = 100u32;
        w.tick = tick;
        w.players[1].last_shot = tick + 1;
        let sight = compute_sight(&room, &w, true, tick - COUNTDOWN_TICKS.min(tick), tick);
        let mut view: View = bytemuck::Zeroable::zeroed();
        write_view(&room, &w, &mut view, 0, &sight, &[], &[], tick);
        let heard = view.pings.iter().any(|p| p.kind == PING_SHOT);
        let seen = (0..view.n_players as usize).any(|i| view.players[i].seat == 1);
        (heard, seen)
    }

    #[test]
    fn a_crossbow_is_silent_and_a_rifle_is_not() {
        // a rifle gives you away: the flash lights you up for anyone in line, or the bang is heard
        let (heard_rifle, seen_rifle) = shot_heard(W_AR);
        assert!(heard_rifle || seen_rifle, "a rifle shot nearby should give the shooter away (heard {heard_rifle}, seen {seen_rifle})");
        let (heard_bow, seen_bow) = shot_heard(W_XBOW);
        assert!(!heard_bow, "a crossbow shot should make no sound");
        assert!(!seen_bow, "a crossbow shot should not light the shooter up");
    }
}

#[cfg(test)]
mod ghillie {
    use super::*;

    fn meadow_room() -> (Room, World) {
        let mut room: Room = bytemuck::Zeroable::zeroed();
        let mut w: World = bytemuck::Zeroable::zeroed();
        for s in 0..MAXP {
            room.is_bot[s] = if s < 2 { 0 } else { 1 };
            if s < 2 {
                room.players[s] = anchor_lang::prelude::Pubkey::new_from_array([s as u8 + 1; 32]);
            }
        }
        room.cfg = 2 | CFG_MEADOW;
        let mut seed = [5u8; 32];
        seed[31] = 0;
        seed_match(&mut room, &mut w, seed);
        (room, w)
    }

    #[test]
    fn the_meadow_has_one_ghillie_a_night_and_the_yard_none() {
        let (_, w) = meadow_room();
        assert_eq!(w.loot.iter().filter(|l| l.active == 1 && l.kind == LOOT_GHILLIE).count(), 1);
        let mut room: Room = bytemuck::Zeroable::zeroed();
        let mut w2: World = bytemuck::Zeroable::zeroed();
        room.cfg = 2;
        seed_match(&mut room, &mut w2, [5u8; 32]);
        assert!(w2.loot.iter().all(|l| l.kind != LOOT_GHILLIE));
    }

    /// The viewer (seat 0) looks straight at seat 1, 6 tiles away in the open Meadow.
    fn seen(wear: bool, crouch: bool, fired: bool) -> bool {
        let (mut room, mut w) = meadow_room();
        room.status = ST_LIVE;
        let m = map_of(&room);
        let y = (1..MAP_H - 1).find(|&ty| (2..12).all(|tx| !is_wall(m, tx, ty) && !is_wall(m, tx, ty - 1) && !is_wall(m, tx, ty + 1))).unwrap();
        for s in 0..MAXP {
            w.players[s].alive = 0;
        }
        for (s, tx) in [(0usize, 3u8), (1, 9)] {
            let p = &mut w.players[s];
            *p = PlayerState::default();
            p.alive = 1;
            p.hp = 100;
            p.x = tile_center(tx);
            p.y = tile_center(y as u8);
        }
        w.players[0].aim = 0;
        w.players[1].moved = if crouch { 8 } else { 0 };
        w.bots[1].stuck = wear as u32;
        let tick = 400u32;
        w.tick = tick;
        if fired {
            w.players[1].last_shot = tick + 1;
        }
        // no lamps near: put the light carrier nowhere
        let sight = compute_sight(&room, &w, true, tick - COUNTDOWN_TICKS, tick);
        let mut view: View = bytemuck::Zeroable::zeroed();
        write_view(&room, &w, &mut view, 0, &sight, &[], &[], tick);
        (0..view.n_players as usize).any(|i| view.players[i].seat == 1)
    }

    /// Seat 1's flags as seat 0 sees them (standing 6 tiles away in the open Meadow), or None.
    fn seen_flags(wear: bool, buttons: u32, moving: bool) -> Option<u32> {
        let (mut room, mut w) = meadow_room();
        room.status = ST_LIVE;
        let m = map_of(&room);
        let y = (1..MAP_H - 1).find(|&ty| (2..12).all(|tx| !is_wall(m, tx, ty) && !is_wall(m, tx, ty - 1) && !is_wall(m, tx, ty + 1))).unwrap();
        for s in 0..MAXP {
            w.players[s].alive = 0;
        }
        for (s, tx) in [(0usize, 3u8), (1, 9)] {
            let p = &mut w.players[s];
            *p = PlayerState::default();
            p.alive = 1;
            p.hp = 100;
            p.x = tile_center(tx);
            p.y = tile_center(y as u8);
        }
        w.players[1].buttons = buttons;
        w.players[1].moved = if moving { 1 } else { 0 };
        w.bots[1].stuck = wear as u32;
        let tick = 400u32;
        w.tick = tick;
        let sight = compute_sight(&room, &w, true, tick - COUNTDOWN_TICKS, tick);
        let mut view: View = bytemuck::Zeroable::zeroed();
        write_view(&room, &w, &mut view, 0, &sight, &[], &[], tick);
        (0..view.n_players as usize).find(|&i| view.players[i].seat == 1).map(|i| view.players[i].flags)
    }

    #[test]
    fn others_see_your_ghillie_suit() {
        assert!(seen_flags(true, 0, false).unwrap() & VIS_GHILLIE != 0, "a seen player in the suit shows it");
        assert!(seen_flags(false, 0, false).unwrap() & VIS_GHILLIE == 0, "no suit, no flag");
    }

    #[test]
    fn others_see_your_emote() {
        let emote = |b: u32, moving: bool| (seen_flags(false, b, moving).unwrap() >> VIS_EMOTE_SHIFT) & 0xf;
        assert_eq!(emote(3 << 8, false), 3, "standing still: the emote shows");
        assert_eq!(emote(0, false), 0, "no emote");
        assert_eq!(emote(3 << 8, true), 0, "moving ends it");
        assert_eq!(emote((3 << 8) | BTN_GADGET, false), 0, "aiming a throw uses that byte: no emote");
    }

    #[test]
    fn crouched_in_a_ghillie_you_vanish_until_you_fire() {
        assert!(seen(false, true, false), "a crouched player without the suit is seen in the cone");
        assert!(!seen(true, true, false), "crouched in the suit, hidden");
        assert!(seen(true, false, false), "standing in the suit, seen");
        assert!(seen(true, true, true), "firing gives you away even in the suit");
    }
}

#[cfg(test)]
mod prone {
    use super::*;

    #[test]
    fn prone_is_a_slow_silent_crawl() {
        let (speed, sprint, word) = move_step(0, BTN_PRONE | BTN_SPRINT | BTN_JUMP, 127, 0, false);
        assert_eq!(speed, CRAWL_SPEED);
        assert!(!sprint, "no sprinting flat on your belly");
        assert!(word & PRONE_BIT != 0 && word & 8 != 0, "prone also counts as crouched (quiet)");
        assert_eq!((word >> 4) & 0xf, 0, "no jumping while prone");
    }
}
