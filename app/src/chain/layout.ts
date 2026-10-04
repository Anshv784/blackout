// Byte-exact decoders for the on-chain layouts in programs/blackout/src/state.rs.
import { PublicKey } from "@solana/web3.js";

export const MAXP = 8;
export const ROOM_SIZE = 1216;
export const WORLD_SIZE = 2456;
export const VIEW_SIZE = 968;
export const REC_HEADER = 32;
export const UNIT = 256;

export const ST_LOBBY = 0;
export const ST_STARTING = 1;
export const ST_COUNTDOWN = 2;
export const ST_LIVE = 3;
export const ST_ENDED = 4;
export const ST_REVEALED = 5;
export const NO_SEAT = 255;

export const STATUS_NAME = ["LOBBY", "SEEDING", "COUNTDOWN", "LIVE", "ENDED", "REVEALED"];
export const WEAPON_NAME = ["PISTOL", "SMG", "SHOTGUN"];
export const LOOT_NAME = ["", "MEDKIT", "ARMOR", "SMG", "SHOTGUN", "FLARE"];

class Reader {
  o: number;
  constructor(public dv: DataView, o = 0) {
    this.o = o;
  }
  u32() {
    const v = this.dv.getUint32(this.o, true);
    this.o += 4;
    return v;
  }
  i32() {
    const v = this.dv.getInt32(this.o, true);
    this.o += 4;
    return v;
  }
  u64() {
    const v = this.dv.getBigUint64(this.o, true);
    this.o += 8;
    return v;
  }
  key() {
    const b = new Uint8Array(this.dv.buffer, this.dv.byteOffset + this.o, 32);
    this.o += 32;
    return new PublicKey(b.slice());
  }
  bytes(n: number) {
    const b = new Uint8Array(this.dv.buffer, this.dv.byteOffset + this.o, n).slice();
    this.o += n;
    return b;
  }
  arr<T>(n: number, f: () => T): T[] {
    const out: T[] = [];
    for (let i = 0; i < n; i++) out.push(f());
    return out;
  }
}

const dvOf = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);

export interface KillEvent {
  tick: number;
  killer: number;
  victim: number;
  weapon: number;
}

export interface Room {
  roomId: bigint;
  stake: bigint;
  pot: bigint;
  startSlot: bigint;
  lastTickSlot: bigint;
  taskId: bigint;
  host: PublicKey;
  players: PublicKey[];
  payout: PublicKey[];
  names: string[];
  status: number;
  matchNo: number;
  tick: number;
  endTick: number;
  nPlayers: number;
  nBots: number;
  isBot: number[];
  alive: number[];
  kills: number[];
  place: number[];
  winner: number;
  aliveCount: number;
  feedHead: number;
  feed: KillEvent[];
  zone: { x: number; y: number; r: number };
  next: { x: number; y: number; r: number };
  zonePhase: number;
  privateCode: number;
  seedRevealed: number;
  readyMask: number;
  lastSeen: number[];
  maxPlayers: number;
  unlisted: boolean;
  /** 0 = medium, 1 = easy, 2 = hard */
  botLevel: number;
  /** 0 = standard 2:15, 1 = quick 1:30, 2 = long 3:30 */
  matchLen: number;
}

export const READY_ALL = 1 | (0b11111 << 1) | (0xff << 8);

const decodeName = (b: Uint8Array) => {
  const end = b.indexOf(0);
  return new TextDecoder().decode(end < 0 ? b : b.subarray(0, end));
};

export function decodeRoom(data: Uint8Array): Room {
  const r = new Reader(dvOf(data), 8);
  const roomId = r.u64();
  const stake = r.u64();
  const pot = r.u64();
  const startSlot = r.u64();
  const lastTickSlot = r.u64();
  const taskId = r.u64();
  const host = r.key();
  const players = r.arr(MAXP, () => r.key());
  const payout = r.arr(MAXP, () => r.key());
  const names = r.arr(MAXP, () => decodeName(r.bytes(16)));
  const status = r.u32();
  const matchNo = r.u32();
  const tick = r.u32();
  const endTick = r.u32();
  const nPlayers = r.u32();
  const nBots = r.u32();
  const isBot = r.arr(MAXP, () => r.u32());
  const alive = r.arr(MAXP, () => r.u32());
  const kills = r.arr(MAXP, () => r.u32());
  const place = r.arr(MAXP, () => r.u32());
  const winner = r.u32();
  const aliveCount = r.u32();
  const feedHead = r.u32();
  const feed = r.arr(16, () => ({ tick: r.u32(), killer: r.u32(), victim: r.u32(), weapon: r.u32() }));
  const zone = { x: r.i32(), y: r.i32(), r: r.i32() };
  const next = { x: r.i32(), y: r.i32(), r: r.i32() };
  const zonePhase = r.u32();
  const privateCode = r.u32();
  const seedRevealed = r.u32();
  const cfg = r.u32();
  const readyMask = r.u32();
  const lastSeen = r.arr(MAXP, () => r.u32());
  return {
    roomId, stake, pot, startSlot, lastTickSlot, taskId, host, players, payout, names, status, matchNo, tick,
    endTick, nPlayers, nBots, isBot, alive, kills, place, winner, aliveCount, feedHead, feed, zone, next, zonePhase,
    privateCode, seedRevealed, readyMask, lastSeen,
    maxPlayers: cfg & 0xff ? Math.min(8, Math.max(2, cfg & 0xff)) : 8,
    unlisted: (cfg & 0x100) !== 0,
    botLevel: (cfg >>> 9) & 3,
    matchLen: (cfg >>> 11) & 3,
  };
}

export interface PlayerState {
  x: number;
  y: number;
  aim: number;
  inDx: number;
  inDy: number;
  buttons: number;
  inSeq: number;
  alive: number;
  hp: number;
  armor: number;
  weapon: number;
  mag: number;
  reload: number;
  cooldown: number;
  flare: number;
  lastShot: number;
  hitAngle: number;
  hitTick: number;
  moved: number;
  lastInputTick: number;
}

function readPlayer(r: Reader): PlayerState {
  return {
    x: r.i32(), y: r.i32(), aim: r.u32(), inDx: r.i32(), inDy: r.i32(), buttons: r.u32(), inSeq: r.u32(),
    alive: r.u32(), hp: r.u32(), armor: r.u32(), weapon: r.u32(), mag: r.u32(), reload: r.u32(),
    cooldown: r.u32(), flare: r.u32(), lastShot: r.u32(), hitAngle: r.u32(), hitTick: r.u32(), moved: r.u32(),
    lastInputTick: r.u32(),
  };
}

export interface VisPlayer {
  seat: number;
  x: number;
  y: number;
  aim: number;
  hp: number;
  weapon: number;
  flags: number;
}
export interface Ping {
  tick: number;
  angle: number;
  kind: number;
  dist: number;
}
export interface View {
  tick: number;
  status: number;
  seat: number;
  me: PlayerState;
  kills: number;
  place: number;
  players: VisPlayer[];
  bullets: { x: number; y: number; vx: number; vy: number }[];
  loot: { id: number; x: number; y: number; kind: number }[];
  pingHead: number;
  pings: Ping[];
}

export function decodeView(data: Uint8Array): View {
  const r = new Reader(dvOf(data));
  r.u32(); // magic
  r.u32();
  r.u32();
  const tick = r.u32();
  const status = r.u32();
  const seat = r.u32();
  const me = readPlayer(r);
  const kills = r.u32();
  const place = r.u32();
  const nP = r.u32();
  const players = r.arr(7, () => ({ seat: r.u32(), x: r.i32(), y: r.i32(), aim: r.u32(), hp: r.u32(), weapon: r.u32(), flags: r.u32() })).slice(0, nP);
  const nB = r.u32();
  const bullets = r.arr(16, () => ({ x: r.i32(), y: r.i32(), vx: r.i32(), vy: r.i32() })).slice(0, nB);
  const nL = r.u32();
  const loot = r.arr(12, () => ({ id: r.u32(), x: r.i32(), y: r.i32(), kind: r.u32() })).slice(0, nL);
  const pingHead = r.u32();
  const pings = r.arr(12, () => ({ tick: r.u32(), angle: r.u32(), kind: r.u32(), dist: r.u32() }));
  return { tick, status, seat, me, kills, place, players, bullets, loot, pingHead, pings };
}

export interface World {
  tick: number;
  seeded: number;
  seed: Uint8Array;
  players: PlayerState[];
  loot: { x: number; y: number; kind: number; active: number }[];
  zone: { reveal: number; start: number; end: number; dmg: number; x: number; y: number; r: number }[];
  bulletsSpawned: number;
}

export function decodeWorld(data: Uint8Array): World {
  const r = new Reader(dvOf(data));
  r.u32();
  r.u32();
  r.u32();
  const tick = r.u32();
  const seeded = r.u32();
  r.u32();
  r.u32();
  const bulletsSpawned = r.u32();
  const seed = r.bytes(32);
  const players = r.arr(MAXP, () => readPlayer(r));
  r.o += 32 * 32; // bullets
  const loot = r.arr(12, () => ({ x: r.i32(), y: r.i32(), kind: r.u32(), active: r.u32() }));
  r.o += 8 * 48; // bot brains
  const zone = r.arr(4, () => {
    const z = { start: r.u32(), end: r.u32(), reveal: r.u32(), dmg: r.u32(), x: r.i32(), y: r.i32(), r: r.i32() };
    r.u32();
    return z;
  });
  return { tick, seeded, seed, players, loot, zone, bulletsSpawned };
}

export interface RecFrame {
  x: number; // fixed-point units
  y: number;
  aim: number; // 0..65535
  alive: boolean;
  firing: boolean;
  flare: boolean;
  hit: boolean;
}

export interface Recording {
  frames: number;
  matchNo: number;
  every: number;
  data: RecFrame[][]; // [frame][seat]
}

export const REC_PER_CHUNK = 319;

/** Concatenate the five recorder chunks into one timeline. */
export function decodeRecording(chunks: Uint8Array[]): Recording {
  const out: RecFrame[][] = [];
  let matchNo = 0;
  let every = 2;
  for (const data of chunks) {
    const dv = dvOf(data);
    const frames = dv.getUint32(12, true);
    if (frames === 0) break;
    matchNo = dv.getUint32(16, true);
    every = dv.getUint32(20, true) || 2;
    decodeChunk(dv, frames, out);
    if (frames < REC_PER_CHUNK) break;
  }
  return { frames: out.length, matchNo, every, data: out };
}

function decodeChunk(dv: DataView, frames: number, out: RecFrame[][]) {
  for (let f = 0; f < frames; f++) {
    const row: RecFrame[] = [];
    for (let s = 0; s < MAXP; s++) {
      const v = dv.getUint32(REC_HEADER + (f * MAXP + s) * 4, true);
      const fl = v >>> 28;
      row.push({
        x: (v & 2047) * 4,
        y: ((v >>> 11) & 2047) * 4,
        aim: ((v >>> 22) & 63) << 10,
        alive: (fl & 1) === 1,
        firing: (fl & 2) === 2,
        flare: (fl & 4) === 4,
        hit: (fl & 8) === 8,
      });
    }
    out.push(row);
  }
}

export interface BoardEntry {
  key: PublicKey;
  name: string;
  wins: number;
  kills: number;
  games: number;
  bestPlace: number;
  /** lamports won from staked pots */
  earned: bigint;
}

export function decodeBoard(data: Uint8Array): { matches: bigint; entries: BoardEntry[] } {
  const r = new Reader(dvOf(data), 8);
  const matches = r.u64();
  const count = r.u32();
  r.u32();
  const entries = r.arr(64, () => ({ key: r.key(), name: decodeName(r.bytes(16)), wins: r.u32(), kills: r.u32(), games: r.u32(), bestPlace: r.u32(), earned: r.u64() })).slice(0, count);
  return { matches, entries };
}
