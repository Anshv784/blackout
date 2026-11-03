//! The flight recorder: one packed frame every few ticks, for the replay.
use super::*;

pub fn record(room: &Room, w: &World, recs: &mut [&mut [u8]], t: u32, tick: u32, ended: bool) {
    let every = room.rec_every();
    if t % every == 0 || ended {
        let frame = (t / every) as usize;
        let hdr_len = core::mem::size_of::<RecHeader>();
        if frame < REC_FRAMES {
            let chunk = frame / REC_PER_CHUNK;
            let local = frame % REC_PER_CHUNK;
            let rec: &mut [u8] = &mut *recs[chunk];
            for s in 0..MAXP {
                let p = w.players[s];
                // 11 bits per axis at 6 units a step covers the whole 48-tile Yard (mirrored in layout.ts)
                let x = ((p.x.max(0) / 6) as u32).min(2047);
                let y = ((p.y.max(0) / 6) as u32).min(2047);
                let aim = p.aim >> 10;
                let mut fl = p.alive & 1;
                // any shot since the last frame (frames are `every` ticks apart)
                if p.last_shot != 0 && p.last_shot + every >= tick + 1 {
                    fl |= 2;
                }
                if p.flare > 0 {
                    fl |= 4;
                }
                if p.hit_tick != 0 && p.hit_tick + every >= tick {
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
