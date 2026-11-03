//! Deterministic integer simulation. Runs inside the TEE once per crank tick.
//! Any change to a game rule shows up in the `golden` test in tests.rs.
use crate::gen::*;
use crate::state::*;

pub mod bots;
pub mod math;
pub mod recorder;
pub mod rules;
pub mod seed;
pub mod sight;
pub mod step;
#[cfg(test)]
mod tests;

pub use bots::*;
pub use math::*;
pub use recorder::*;
pub use rules::*;
pub use seed::*;
pub use sight::*;
pub use step::*;

pub struct TickOut {
    pub ended: bool,
}

/// One 50 ms step of the night.
pub fn tick(room: &mut Room, w: &mut World, views: &mut [&mut View], recs: &mut [&mut [u8]]) -> TickOut {
    w.tick += 1;
    let tick = w.tick;
    room.tick = tick;

    if room.status == ST_COUNTDOWN && tick >= COUNTDOWN_TICKS {
        room.status = ST_LIVE;
    }
    let live = room.status == ST_LIVE;
    let t = tick.saturating_sub(COUNTDOWN_TICKS);
    let mut ended = false;
    let mut killer = [u32::MAX; MAXP];
    let mut loot_events = [(0, 0); 4];
    let mut n_loot_events = 0usize;
    let mut booms = [(0, 0); 4];
    let mut n_booms = 0usize;

    if live {
        step_players(room, w, &mut killer, tick);
        step_bullets(room, w, &mut killer, &mut booms, &mut n_booms, tick);
        step_pickups(room, w, &mut loot_events, &mut n_loot_events);
        step_supply_drops(room, w, t);
        step_zone(room, w, &mut killer, t, tick);
        step_revives(room, w, &killer);
        step_deaths(room, w, &killer, tick);
        ended = check_end(room, w, t, tick);
    }

    let sight = compute_sight(room, w, live, t, tick);
    for v in 0..MAXP {
        if room.is_bot[v] == 1 {
            update_bot_memory(room, w, v, &sight.vis, tick);
        } else {
            write_view(room, w, &mut *views[v], v, &sight, &booms[..n_booms], &loot_events[..n_loot_events], tick);
        }
    }
    if live || ended {
        record(room, w, recs, t, tick, ended);
    }
    TickOut { ended }
}
