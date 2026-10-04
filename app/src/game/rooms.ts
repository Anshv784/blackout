// "Create a room" = claim a free on-chain room slot, become its host, take seat 0 — one gasless tx.
import { PublicKey } from "@solana/web3.js";
import { client } from "./identity";
import { useStore } from "./store";
import { ROOM_POOL, STAKED_ROOMS } from "../config";
import { ST_LOBBY, ST_ENDED, ST_REVEALED, READY_ALL, NO_SEAT, type Room } from "../chain/layout";

const EMPTY = "11111111111111111111111111111111";

// Private room codes: 6 characters, no look-alikes (0/O, 1/I), packed into the room's u32.
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function newCode(): number {
  const b = crypto.getRandomValues(new Uint32Array(1))[0] & 0x3fffffff;
  return b || 1;
}
export function codeToText(n: number): string {
  let s = "";
  for (let i = 0; i < 6; i++) s = ALPHA[(n >>> (i * 5)) & 31] + s;
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}
export function textToCode(t: string): number | null {
  const s = t.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length !== 6) return null;
  let n = 0;
  for (const ch of s) {
    const v = ALPHA.indexOf(ch);
    if (v < 0) return null;
    n = n * 32 + v;
  }
  return n >>> 0 || null;
}

/** The room (other than `except`) where you hold a seat, if any. */
export async function seatElsewhere(except: number): Promise<{ id: number; room: Room } | null> {
  const ids = [...ROOM_POOL, ...STAKED_ROOMS].filter((i) => i !== except);
  const rooms = await Promise.all(ids.map(async (id) => [id, await client.fetchRoom(id).catch(() => null)] as const));
  const me = client.publicKey;
  const hit = rooms.find(([, r]) => r && r.players.some((p, i) => r.isBot[i] === 0 && p.equals(me)));
  return hit ? { id: hit[0], room: hit[1]! } : null;
}

// Rooms everyone walked away from: ENDED needs someone to call finish, REVEALED needs a reset
// before anyone can claim it again. Any visitor nudges them along (gasless).
const nudged = new Map<number, number>();
const abandonedSince = new Map<number, number>();
export function sweepRooms(rooms: Record<number, Room | null>, slot: number) {
  const now = Date.now();
  for (const [k, r] of Object.entries(rooms)) {
    const id = Number(k);
    if (!r || now - (nudged.get(id) ?? 0) < 15000) continue;
    if (r.status === ST_ENDED) {
      nudged.set(id, now);
      const w = r.winner;
      const payout = w !== NO_SEAT && r.isBot[w] === 0 ? r.payout[w] : null;
      client.sendEr([client.finishIx(BigInt(id), payout)], { confirm: false }).catch(() => {});
    } else if (r.status === ST_REVEALED && liveHumansAt(r, slot) === 0) {
      // nobody is watching the replay: reset after it has looked abandoned for a while
      const since = abandonedSince.get(id) ?? now;
      abandonedSince.set(id, since);
      if (now - since > 20000) {
        nudged.set(id, now);
        abandonedSince.delete(id);
        client.sendEr([client.resetIx(BigInt(id))], { confirm: false }).catch(() => {});
      }
    } else abandonedSince.delete(id);
  }
}

/** Find the open private room behind a code. */
export async function findByCode(text: string): Promise<{ id: number; code: number } | null> {
  const code = textToCode(text);
  if (!code) return null;
  const rooms = await Promise.all(ROOM_POOL.map(async (id) => [id, await client.fetchRoom(id).catch(() => null)] as const));
  const hit = rooms.find(([, r]) => r && r.unlisted && r.privateCode === code);
  return hit ? { id: hit[0], code } : null;
}

export const liveHumansAt = (r: Room, slot: number) =>
  r.players.filter((p, i) => r.isBot[i] === 0 && p.toBase58() !== EMPTY && ((slot >>> 0) - r.lastSeen[i]) >>> 0 <= 4500).length;

/** The room you're already sitting in (one room per player), if any. */
export function myRoom(rooms: (readonly [number, Room | null])[]): number | null {
  const me = client.publicKey.toBase58();
  const hit = rooms.find(([, r]) => r && r.players.some((p, i) => r.isBot[i] === 0 && p.toBase58() === me));
  return hit ? hit[0] : null;
}

export async function createRoom(maxPlayers: number, unlisted: boolean): Promise<{ id: number; code: number }> {
  const rooms = await Promise.all(ROOM_POOL.map(async (id) => [id, await client.fetchRoom(id).catch(() => null)] as const));
  // one room at a time: if you're already seated somewhere, go back there
  const mine = myRoom(rooms);
  if (mine !== null) return { id: mine, code: rooms.find(([i]) => i === mine)?.[1]?.privateCode ?? 0 };
  const slot = await (await client.teeConn()).getSlot().catch(() => 0);
  const hostGone = (r: Room) => {
    const i = r.players.findIndex((p, k) => r.isBot[k] === 0 && p.toBase58() !== EMPTY && p.equals(r.host));
    return i < 0 || ((slot >>> 0) - r.lastSeen[i]) >>> 0 > 4500;
  };
  const free = rooms.filter(([, r]) => r && r.status === ST_LOBBY && r.readyMask === READY_ALL && r.stake === 0n && (liveHumansAt(r, slot) === 0 || hostGone(r)));
  if (!free.length) throw new Error("Every room is in use right now — try again in a minute");
  // shuffle so two people creating at once rarely collide
  free.sort(() => Math.random() - 0.5);
  const st = useStore.getState();
  const wallet = st.wallet ? new PublicKey(st.wallet) : null;
  const code = unlisted ? newCode() : 0;
  let lastErr: unknown = null;
  for (const [id] of free.slice(0, 3)) {
    try {
      await client.sendEr([client.claimIx(BigInt(id), maxPlayers, unlisted, code), client.joinIx(BigInt(id), 0, st.name || "GHOST", wallet, code)]);
      return { id, code };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
