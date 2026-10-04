// Bit-exact mirror of the movement/collision math in programs/blackout/src/sim.rs,
// used for client-side prediction of your own body.
import { WALLS, MAP_W, MAP_H, SIN_TABLE } from "./gen";

export const UNIT = 256;
export const PLAYER_R = 90;
export const SPEED = 56;
export const TPS = 20;
export const COUNTDOWN_TICKS = 60;
export const VISION_R = 10 * UNIT;
export const AMBIENT_R = 2 * UNIT + 64;
export const CONE_HALF = 7000;
export const FLARE_TICKS = 100;

// Night length (mirror of Room::match_ticks): the zone schedule stretches with it.
export const BASE_MATCH_TICKS = 2700;
export const MATCH_LENGTHS = [2700, 1800, 4200];
export const matchTicks = (len: number) => MATCH_LENGTHS[len] ?? 2700;
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

export function isWall(tx: number, ty: number) {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  return ((WALLS[ty] >>> tx) & 1) === 1;
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

// sprint (mirror of sim.rs): `moved` packs bit 0 moved, bit 1 sprinting, bit 2 winded, bits 8.. fatigue
export const SPRINT_SPEED = 84;
export const FATIGUE_MAX = 100;
export const FATIGUE_RECOVERED = 30;
export const BTN_SPRINT = 4;

export function sprintStep(moved: number, buttons: number, dx: number, dy: number): [boolean, number, boolean] {
  let fatigue = moved >>> 8;
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

export function moveBody(p: { x: number; y: number }, vx: number, vy: number) {
  if (vx !== 0) {
    const nx = p.x + vx;
    if (!circleHitsWall(nx, p.y, PLAYER_R)) p.x = nx;
    else {
      const hx = p.x + tdiv(vx, 2);
      if (!circleHitsWall(hx, p.y, PLAYER_R)) p.x = hx;
    }
  }
  if (vy !== 0) {
    const ny = p.y + vy;
    if (!circleHitsWall(p.x, ny, PLAYER_R)) p.y = ny;
    else {
      const hy = p.y + tdiv(vy, 2);
      if (!circleHitsWall(p.x, hy, PLAYER_R)) p.y = hy;
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
