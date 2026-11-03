//! Integer maths and movement. Mirrored bit-for-bit in app/src/game/sim.ts for prediction.
use super::*;

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
pub const BTN_CROUCH: u32 = 32;
pub const BTN_JUMP: u32 = 64;
/// sneaking: slow and silent (mirrored in sim.ts)
pub const SNEAK_SPEED: i32 = 28;
pub const JUMP_TICKS: u32 = 10;
pub const JUMP_COST: u32 = 15;

/// One tick of how you move: (speed, new `moved` word without the moved bit).
/// `moved` packs: bit 1 sprinting, bit 2 winded, bit 3 crouched, bits 4-7 jump ticks left,
/// bits 8-15 fatigue. Mirrored in sim.ts moveStep.
pub fn move_step(moved: u32, buttons: u32, dx: i32, dy: i32, downed: bool) -> (i32, bool, u32) {
    let crouch = !downed && buttons & BTN_CROUCH != 0;
    let btn = if downed { 0 } else if crouch { buttons & !BTN_SPRINT } else { buttons };
    let (sprinting, mut fatigue, winded) = sprint_step(moved, btn, dx, dy);
    let mut jt = (moved >> 4) & 0xf;
    if jt > 0 {
        jt -= 1;
    } else if !downed && !crouch && btn & BTN_JUMP != 0 && fatigue + JUMP_COST <= FATIGUE_MAX {
        jt = JUMP_TICKS;
        fatigue += JUMP_COST;
    }
    let speed = if downed { CRAWL_SPEED } else if crouch { SNEAK_SPEED } else if sprinting { SPRINT_SPEED } else { SPEED };
    let word = (sprinting as u32) << 1 | (winded as u32) << 2 | (crouch as u32) << 3 | jt << 4 | (fatigue & 0xff) << 8;
    (speed, sprinting, word)
}

/// One tick of stamina: returns (sprinting, new fatigue, winded).
pub fn sprint_step(moved: u32, buttons: u32, dx: i32, dy: i32) -> (bool, u32, bool) {
    let mut fatigue = (moved >> 8) & 0xff;
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
