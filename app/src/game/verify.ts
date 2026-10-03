// Re-derive a match from its revealed VRF seed (mirror of sim::seed_match) and
// check it against the unsealed World: spawns, loot rolls and the zone plan.
import { SPAWNS, LOOT_SPOTS } from "./gen";
import type { Room, World, Recording } from "../chain/layout";

const MASK64 = (1n << 64n) - 1n;

class Rng {
  s: bigint;
  constructor(lo: number, hi: number) {
    this.s = (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
  }
  next(): number {
    let s = this.s;
    if (s === 0n) s = 0x9e3779b97f4a7c15n;
    s ^= (s << 13n) & MASK64;
    s ^= s >> 7n;
    s ^= (s << 17n) & MASK64;
    this.s = s;
    return Number((s >> 16n) & 0xffffffffn);
  }
  range(lo: number, hi: number) {
    const span = Math.max(1, hi - lo + 1);
    return lo + (this.next() % span);
  }
}

const tc = (t: number) => t * 256 + 128;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export interface VerifyResult {
  spawns: boolean;
  loot: boolean;
  zone: boolean;
}

export function verifyMatch(room: Room, world: World, rec: Recording, occupied: boolean[]): VerifyResult {
  const seed = world.seed;
  const dv = new DataView(seed.buffer, seed.byteOffset, 32);
  const rng = new Rng(dv.getUint32(0, true) | 1, dv.getUint32(4, true));

  // spawns
  const order = SPAWNS.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.next() % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const used = new Array(SPAWNS.length).fill(false);
  const placed: [number, number][] = [];
  const spawnAt: ([number, number] | null)[] = [];
  for (let seat = 0; seat < 8; seat++) {
    if (!occupied[seat]) {
      spawnAt.push(null);
      continue;
    }
    let pick = order.find((k) => {
      if (used[k]) return false;
      const [sx, sy] = [tc(SPAWNS[k][0]), tc(SPAWNS[k][1])];
      return placed.every(([px, py]) => (px - sx) ** 2 + (py - sy) ** 2 >= (7 * 256) ** 2);
    });
    if (pick === undefined) pick = order.find((k) => !used[k]) ?? 0;
    used[pick] = true;
    const p: [number, number] = [tc(SPAWNS[pick][0]), tc(SPAWNS[pick][1])];
    placed.push(p);
    spawnAt.push(p);
    rng.range(-4000, 4000); // bot sweep
    rng.next(); // bot strafe
  }
  // loot
  const spots = LOOT_SPOTS.map((_, i) => i);
  for (let i = spots.length - 1; i > 0; i--) {
    const j = rng.next() % (i + 1);
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  const loot: { x: number; y: number; kind: number }[] = [];
  for (let i = 0; i < 10; i++) {
    const [lx, ly] = LOOT_SPOTS[spots[i]];
    const roll = rng.next() % 100;
    const kind = roll <= 27 ? 1 : roll <= 47 ? 2 : roll <= 67 ? 3 : roll <= 83 ? 4 : 5;
    loot.push({ x: tc(lx), y: tc(ly), kind });
  }
  // zone
  const c = 16 * 256;
  const c1x = c + rng.range(-5 * 256, 5 * 256);
  const c1y = c + rng.range(-5 * 256, 5 * 256);
  const c2x = clamp(c1x + rng.range(-4 * 256, 4 * 256), 7 * 256, 25 * 256);
  const c2y = clamp(c1y + rng.range(-4 * 256, 4 * 256), 7 * 256, 25 * 256);
  const c3x = clamp(c2x + rng.range(-384, 384), 7 * 256, 25 * 256);
  const c3y = clamp(c2y + rng.range(-384, 384), 7 * 256, 25 * 256);
  const zone = [
    [c1x, c1y],
    [c2x, c2y],
    [c3x, c3y],
  ];

  const zoneOk = zone.every(([x, y], i) => world.zone[i].x === x && world.zone[i].y === y);
  // loot can be picked up/dropped during play, but its rolled kinds/positions for the first
  // 10 slots only change by pickup (active flag) or weapon drops into empty slots
  // a picked-up slot can later be reused by a weapon drop at a different spot
  const exact = loot.filter((l, i) => world.loot[i].x === l.x && world.loot[i].y === l.y && world.loot[i].kind === l.kind).length;
  const lootOk = loot.every((l, i) => (world.loot[i].x === l.x && world.loot[i].y === l.y ? world.loot[i].kind === l.kind : true)) && exact >= 5;
  // spawns vs the first recorded frame (≤1 tick of movement, recorder precision 4 units)
  const f0 = rec.data[0];
  const spawnsOk = !!f0 && spawnAt.every((sp, seat) => !sp || Math.hypot(f0[seat].x - sp[0], f0[seat].y - sp[1]) <= 64);
  void room;
  return { spawns: spawnsOk, loot: lootOk, zone: zoneOk };
}
