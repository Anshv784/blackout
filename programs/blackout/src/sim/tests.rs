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
                move_body(&mut x, &mut y, vx, vy);
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

    const EXPECTED: u64 = 0xfed285b9bc0dcc08;

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
