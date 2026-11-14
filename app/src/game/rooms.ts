// "Create a room" = claim a free on-chain room slot, become its host, take seat 0 — one gasless tx.
import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import { client } from "./identity";
import { useStore } from "./store";
import { PRIVATE_ROOMS, PUBLIC_ROOMS, ROOM_POOL, STAKED_ROOMS, STALE_SLOTS } from "../config";
import { ST_LOBBY, ST_ENDED, ST_REVEALED, ST_LIVE, ST_COUNTDOWN, READY_ALL, NO_SEAT, lobbyDeadline, type Room, type Daily } from "../chain/layout";
import { todayUtc } from "../chain/client";

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
    // a free lobby held past its time limit (its own players' games normally handle this first)
    const limit = lobbyDeadline(r);
    if (limit !== null && liveHumansAt(r, slot) > 0 && now / 1000 >= limit + 10) {
      nudged.set(id, now);
      const ix = r.unlisted ? client.expireLobbyIx(BigInt(id)) : client.startIx(BigInt(id), r.maxPlayers);
      client.sendEr([ix], { confirm: false }).catch(() => {});
      continue;
    }
    if (r.status === ST_ENDED) {
      nudged.set(id, now);
      const w = r.winner;
      const payout = w !== NO_SEAT && r.isBot[w] === 0 ? r.payout[w] : null;
      client.sendEr(client.withBudget(client.finishIx(BigInt(id), payout, r.daily)), { confirm: false }).catch(() => {});
    } else if (r.status === ST_REVEALED) {
      // a replay holds the room: reset after 20 s if nobody is watching, after a minute if someone is
      // (the players' own games reopen it at 45 s; this is the backstop)
      const since = abandonedSince.get(id) ?? now;
      abandonedSince.set(id, since);
      if (now - since > (liveHumansAt(r, slot) === 0 ? 20000 : 60000)) {
        nudged.set(id, now);
        abandonedSince.delete(id);
        client.sendEr(client.withBudget(client.resetIx(BigInt(id))), { confirm: false }).catch(() => {});
      }
    } else if ((r.status === ST_LIVE || r.status === ST_COUNTDOWN) && liveHumansAt(r, slot) === 0) {
      // a night nobody is in any more (its ticker died): one budgeted tick lets it end itself
      const since = abandonedSince.get(id) ?? now;
      abandonedSince.set(id, since);
      if (now - since > 20000) {
        nudged.set(id, now);
        client
          .sendEr([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), client.tickIx(BigInt(id))], { confirm: false })
          .catch(() => {});
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
  r.players.filter((p, i) => r.isBot[i] === 0 && p.toBase58() !== EMPTY && ((slot >>> 0) - r.lastSeen[i]) >>> 0 <= STALE_SLOTS).length;

/** The room you're already sitting in (one room per player), if any. */
export function myRoom(rooms: (readonly [number, Room | null])[]): number | null {
  const me = client.publicKey.toBase58();
  const hit = rooms.find(([, r]) => r && r.players.some((p, i) => r.isBot[i] === 0 && p.toBase58() === me));
  return hit ? hit[0] : null;
}

/** Which staked table a "play staked" button opens: the one where stakers are already waiting in the
 *  lobby with a seat free (most of them first), else the open table with the smallest stake, else
 *  the first table. With one table this is always that table. */
export function pickStakedTable(rooms: Record<number, Room | null>, ids: number[] = STAKED_ROOMS): number {
  const humans = (r: Room) => r.players.filter((p, i) => r.isBot[i] === 0 && p.toBase58() !== EMPTY).length;
  const tables = ids.map((id) => [id, rooms[id] ?? null] as const).filter((t): t is readonly [number, Room] => !!t[1]);
  const open = tables.filter(([, r]) => r.status === ST_LOBBY && humans(r) < r.maxPlayers);
  const waiting = open.filter(([, r]) => humans(r) > 0).sort((a, b) => humans(b[1]) - humans(a[1]));
  if (waiting.length) return waiting[0][0];
  const cheapest = [...open].sort((a, b) => Number(a[1].stake - b[1].stake));
  return cheapest.length ? cheapest[0][0] : ids[0];
}

/** "0.01 SOL", or "0.01–0.05 SOL" across tables (from the rooms themselves; nothing hard-coded). */
export function stakeLabel(rooms: Record<number, Room | null>, ids: number[] = STAKED_ROOMS): string {
  const stakes = ids.map((id) => rooms[id]?.stake).filter((s): s is bigint => !!s && s > 0n).map((s) => Number(s) / 1e9);
  if (!stakes.length) return "real SOL";
  const fmt = (n: number) => n.toFixed(n < 0.1 ? 2 : 1).replace(/\.?0+$/, "") || "0";
  const lo = Math.min(...stakes), hi = Math.max(...stakes);
  return lo === hi ? `${fmt(lo)} SOL` : `${fmt(lo)}–${fmt(hi)} SOL`;
}

export const playedToday = (d: Daily, wallet: string) => d.entries.some((e) => e.key.toBase58() === wallet);

export async function createRoom(maxPlayers: number, unlisted: boolean): Promise<{ id: number; code: number }> {
  const rooms = await Promise.all(ROOM_POOL.map(async (id) => [id, await client.fetchRoom(id).catch(() => null)] as const));
  // one room at a time: if you're already seated somewhere, go back there
  const mine = myRoom(rooms);
  // a private game only takes a private room, a public one only a public room
  const pool = new Set(unlisted ? PRIVATE_ROOMS : PUBLIC_ROOMS);
  if (mine !== null) return { id: mine, code: rooms.find(([i]) => i === mine)?.[1]?.privateCode ?? 0 };
  const slot = await (await client.teeConn()).getSlot().catch(() => 0);
  const hostGone = (r: Room) => {
    const i = r.players.findIndex((p, k) => r.isBot[k] === 0 && p.toBase58() !== EMPTY && p.equals(r.host));
    return i < 0 || ((slot >>> 0) - r.lastSeen[i]) >>> 0 > STALE_SLOTS;
  };
  const free = rooms.filter(([id, r]) => pool.has(id) && r && r.status === ST_LOBBY && r.readyMask === READY_ALL && r.stake === 0n && (liveHumansAt(r, slot) === 0 || hostGone(r)));
  if (!free.length) throw new Error(`Every ${unlisted ? "private" : "public"} room is in use right now — try again in a minute`);
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
