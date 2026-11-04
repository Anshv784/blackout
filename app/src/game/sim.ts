// Bit-exact mirror of the movement/collision math in programs/blackout/src/sim/,
// used for client-side prediction of your own body.
import { WALL_CHARS, MAP_W, MAP_H, SIN_TABLE } from "./gen";
import { activeMap, onMapChange } from "./maps";

export const UNIT = 256;
export const PLAYER_R = 90;
/** a death crate's footprint (radius): solid on foot, a jump clears it. Mirror of sim/rules.rs */
export const BOX_R = 48;
export const SPEED = 56;
export const TPS = 20;
export const COUNTDOWN_TICKS = 60;
export const VISION_R = 10 * UNIT;
export const AMBIENT_R = 2 * UNIT + 64;
export const CONE_HALF = 7000;
export const FLARE_TICKS = 100;

// Night length (mirror of Room::match_ticks): fixed at 5:00; the zone schedule is stretched to it.
export const BASE_MATCH_TICKS = 2700;
export const MATCH_LENGTHS = [6000, 6000, 6000]; // every night is 5:00
export const matchTicks = (len: number) => MATCH_LENGTHS[len] ?? 6000;
// night events (mirror of the program's sim/ drop_ticks / blackout_tick)
export const BLACKOUT_TICKS = 200;
export const dropTicks = (len: number) => [Math.floor((matchTicks(len) * 3) / 10), Math.floor((matchTicks(len) * 62) / 100)];
export const blackoutTick = (len: number) => Math.floor(matchTicks(len) / 2);
export const lightsOut = (len: number, t: number) => t >= blackoutTick(len) && t < blackoutTick(len) + BLACKOUT_TICKS;

export function zoneSchedule(len: number) {
  const k = matchTicks(len);
  const sc = (v: number) => Math.floor((v * k) / BASE_MATCH_TICKS);
  return [
    { reveal: sc(100), start: sc(500), end: sc(900) },
    { reveal: sc(900), start: sc(1200), end: sc(1600) },
    { reveal: sc(1600), start: sc(1800), end: sc(2200) },
  ];
}

const tdiv = (a: number, b: number) => Math.trunc(a / b);

// rows are 48 wide: past JS's 32-bit bit ops, so keep a byte grid instead of masks
const GRID = new Uint8Array(MAP_W * MAP_H);
function buildGrid(rows: string[]) {
  rows.forEach((row, y) => {
    for (let x = 0; x < MAP_W; x++) GRID[y * MAP_W + x] = WALL_CHARS.includes(row[x]) ? 1 : 0;
  });
}
buildGrid(activeMap().rows);
onMapChange((m) => buildGrid(m.rows));

export function isWall(tx: number, ty: number) {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  return GRID[ty * MAP_W + tx] === 1;
}

export function circleHitsWall(x: number, y: number, r: number) {
  const tx0 = (x - r) >> 8;
  const tx1 = (x + r) >> 8;
  const ty0 = (y - r) >> 8;
  const ty1 = (y + r) >> 8;
  const r2 = r * r;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!isWall(tx, ty)) continue;
      const cx = Math.min(Math.max(x, tx * UNIT), tx * UNIT + UNIT - 1);
      const cy = Math.min(Math.max(y, ty * UNIT), ty * UNIT + UNIT - 1);
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy < r2) return true;
    }
  }
  return false;
}

export function isqrt(v: number) {
  if (v <= 0) return 0;
  let x = v;
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + Math.floor(v / x)) / 2);
  }
  return x;
}

export function inputVelocity(dx: number, dy: number, speed = SPEED): [number, number] {
  const m2 = dx * dx + dy * dy;
  if (m2 === 0) return [0, 0];
  if (m2 <= 127 * 127) return [tdiv(dx * speed, 127), tdiv(dy * speed, 127)];
  const m = isqrt(m2);
  return [tdiv(dx * speed, m), tdiv(dy * speed, m)];
}

// sprint (mirror of the program's sim/): `moved` packs bit 0 moved, bit 1 sprinting, bit 2 winded, bits 8.. fatigue
export const SPRINT_SPEED = 84;
export const FATIGUE_MAX = 100;
export const FATIGUE_RECOVERED = 30;
export const BTN_SPRINT = 4;
export const CRAWL_SPEED = 18; // downed (duos)

export function sprintStep(moved: number, buttons: number, dx: number, dy: number): [boolean, number, boolean] {
  let fatigue = (moved >>> 8) & 0xff;
  let winded = (moved & 4) !== 0;
  const wants = (buttons & BTN_SPRINT) !== 0 && (buttons & 1) === 0 && (dx !== 0 || dy !== 0);
  const sprinting = wants && !winded;
  if (sprinting) {
    fatigue = Math.min(FATIGUE_MAX, fatigue + 2);
    if (fatigue >= FATIGUE_MAX) winded = true;
  } else if (fatigue > 0) fatigue -= 1;
  if (winded && fatigue <= FATIGUE_RECOVERED) winded = false;
  return [sprinting, fatigue, winded];
}

export const packMoved = (moved: boolean, sprinting: boolean, winded: boolean, fatigue: number) =>
  (moved ? 1 : 0) | (sprinting && moved ? 2 : 0) | (winded ? 4 : 0) | (fatigue << 8);

// crouch + jump (mirror of the program's sim/ move_step)
export const BTN_CROUCH = 32;
export const BTN_JUMP = 64;
export const BTN_PRONE = 128;
export const PRONE_BIT = 1 << 16;
export const SNEAK_SPEED = 28;
export const JUMP_TICKS = 10;
export const JUMP_COST = 15;

/** One tick of movement state: [speed, sprinting, word without the moved bit]. */
export function moveStep(moved: number, buttons: number, dx: number, dy: number, downed: boolean): [number, boolean, number] {
  const prone = !downed && (buttons & BTN_PRONE) !== 0;
  const crouch = prone || (!downed && (buttons & BTN_CROUCH) !== 0);
  const btn = downed ? 0 : crouch ? buttons & ~BTN_SPRINT : buttons;
  const [sprinting, fat0, winded] = sprintStep(moved, btn, dx, dy);
  let fatigue = fat0;
  let jt = (moved >>> 4) & 0xf;
  if (jt > 0) jt -= 1;
  else if (!downed && !crouch && (btn & BTN_JUMP) !== 0 && fatigue + JUMP_COST <= FATIGUE_MAX) {
    jt = JUMP_TICKS;
    fatigue += JUMP_COST;
  }
  const speed = downed || prone ? CRAWL_SPEED : crouch ? SNEAK_SPEED : sprinting ? SPRINT_SPEED : SPEED;
  const word = ((sprinting ? 1 : 0) << 1) | ((winded ? 1 : 0) << 2) | ((crouch ? 1 : 0) << 3) | (jt << 4) | ((fatigue & 0xff) << 8) | (prone ? PRONE_BIT : 0);
  return [speed, sprinting, word];
}

export function moveBody(p: { x: number; y: number }, vx: number, vy: number, boxes: readonly { x: number; y: number }[] = []) {
  const r2 = (PLAYER_R + BOX_R) ** 2;
  const d2 = (ax: number, ay: number, b: { x: number; y: number }) => (ax - b.x) ** 2 + (ay - b.y) ** 2;
  // a crate only blocks a step that goes further into it, so nobody is ever stuck inside one
  const hits = (nx: number, ny: number) => circleHitsWall(nx, ny, PLAYER_R) || boxes.some((b) => d2(nx, ny, b) < r2 && d2(nx, ny, b) < d2(p.x, p.y, b));
  if (vx !== 0) {
    const nx = p.x + vx;
    if (!hits(nx, p.y)) p.x = nx;
    else {
      const hx = p.x + tdiv(vx, 2);
      if (!hits(hx, p.y)) p.x = hx;
    }
  }
  if (vy !== 0) {
    const ny = p.y + vy;
    if (!hits(p.x, ny)) p.y = ny;
    else {
      const hy = p.y + tdiv(vy, 2);
      if (!hits(p.x, hy)) p.y = hy;
    }
  }
}

export function lineOfSight(x0: number, y0: number, x1: number, y1: number) {
  const d = isqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
  const steps = tdiv(d, 64) + 1;
  for (let i = 1; i < steps; i++) {
    const px = x0 + tdiv((x1 - x0) * i, steps);
    const py = y0 + tdiv((y1 - y0) * i, steps);
    if (isWall(px >> 8, py >> 8)) return false;
  }
  return true;
}

export const angleToRad = (a: number) => (a / 65536) * Math.PI * 2;
export const radToAngle = (r: number) => (((Math.round((r / (Math.PI * 2)) * 65536) % 65536) + 65536) % 65536);

export function sinFx(a: number) {
  a &= 0xffff;
  const idx = a >> 8;
  const frac = a & 255;
  const s0 = SIN_TABLE[idx];
  const s1 = SIN_TABLE[idx + 1];
  return s0 + tdiv((s1 - s0) * frac, 256);
}

/** Aimed throws (mirror of sim/rules.rs + math.rs): the throw byte is tiles x THROW_PER_TILE. */
export const THROW_PER_TILE = 28;
export const THROW_TTL = 18;
export const THROW_MAX_TILES = 9;
const FLY_STEP = 128;

export function throwSpeed(t: number) {
  if (t === 0) return 120;
  const dist = tdiv(Math.min(255, t) * UNIT, THROW_PER_TILE);
  return Math.max(30, tdiv(dist * 1000, 7270));
}

/** One tick of a thrown thing, exactly as the program moves it. */
export function flyStep(b: { x: number; y: number; vx: number; vy: number }) {
  const n = Math.max(1, tdiv(Math.max(Math.abs(b.vx), Math.abs(b.vy)) + FLY_STEP - 1, FLY_STEP));
  const sx = b.vx;
  const sy = b.vy;
  for (let i = 0; i < n; i++) {
    let ddx = tdiv(sx * (i + 1), n) - tdiv(sx * i, n);
    let ddy = tdiv(sy * (i + 1), n) - tdiv(sy * i, n);
    if (b.vx !== sx) ddx = tdiv(-ddx, 2);
    if (b.vy !== sy) ddy = tdiv(-ddy, 2);
    const nx = b.x + ddx;
    if (isWall(nx >> 8, b.y >> 8)) {
      if (b.vx === sx) b.vx = tdiv(-sx, 2);
    } else b.x = nx;
    const ny = b.y + ddy;
    if (isWall(b.x >> 8, ny >> 8)) {
      if (b.vy === sy) b.vy = tdiv(-sy, 2);
    } else b.y = ny;
  }
  b.vx = tdiv(b.vx * 7, 8);
  b.vy = tdiv(b.vy * 7, 8);
}

/** Where a throw from (x, y) at `aim` with throw byte `t` goes: every tick's position, landing last. */
export function predictThrow(x: number, y: number, aim: number, t: number) {
  const c = sinFx((aim + 16384) & 0xffff);
  const s = sinFx(aim & 0xffff);
  const b = { x: x + tdiv(c * (90 + 40), 1024), y: y + tdiv(s * (90 + 40), 1024), vx: 0, vy: 0 };
  const v0 = throwSpeed(t);
  b.vx = tdiv(c * v0, 1024);
  b.vy = tdiv(s * v0, 1024);
  const path = [{ x: b.x, y: b.y }];
  for (let i = 0; i < THROW_TTL; i++) {
    flyStep(b);
    path.push({ x: b.x, y: b.y });
  }
  return path;
}
