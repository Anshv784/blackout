// "Create a room" = claim a free on-chain room slot, become its host, take seat 0 — one gasless tx.
import { PublicKey } from "@solana/web3.js";
import { client } from "./identity";
import { useStore } from "./store";
import { ROOM_POOL } from "../config";
import { ST_LOBBY, READY_ALL, type Room } from "../chain/layout";

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
