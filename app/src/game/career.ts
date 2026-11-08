// Your service record: every night you finished, summed up on this device (nothing on-chain).
// Written once per night from the result screen; read by the Operator page.
import type { Room } from "../chain/layout";

const KEY = "bo-career-v1";
const TICKS_PER_SEC = 20;

export interface Career {
  nights: number;
  wins: number;
  kills: number;
  deaths: number;
  /** best placing (1 = won), 0 = none yet */
  best: number;
  /** seconds survived across every night */
  alive: number;
  /** kills per gun (index into WEAPON_NAME), from the kill feed */
  guns: number[];
  /** the last nights counted, so a replay or a refresh never counts one twice */
  seen: string[];
  /** the last few placings, newest first */
  recent: number[];
}

const empty = (): Career => ({ nights: 0, wins: 0, kills: 0, deaths: 0, best: 0, alive: 0, guns: Array(8).fill(0), seen: [], recent: [] });

export function loadCareer(): Career {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!c || typeof c.nights !== "number") return empty();
    return { ...empty(), ...c, guns: Array.from({ length: 8 }, (_, i) => Number(c.guns?.[i] ?? 0)) };
  } catch {
    return empty();
  }
}

/** Count a finished night for the seat you played. Safe to call more than once per night. */
export function recordNight(room: Room, seat: number): Career | null {
  const c = loadCareer();
  const id = `${room.roomId}:${room.matchNo}`;
  if (c.seen.includes(id)) return null;
  const feed = room.feed.slice(0, Math.min(room.feed.length, room.feedHead));
  const myDeath = feed.find((f) => f.victim === seat);
  const won = room.winner === seat;
  const place = room.place[seat] || (won ? 1 : 0);
  const endTick = myDeath ? myDeath.tick : room.endTick || room.tick;
  c.nights += 1;
  if (won) c.wins += 1;
  if (myDeath) c.deaths += 1;
  c.kills += room.kills[seat] ?? 0;
  if (place > 0 && (c.best === 0 || place < c.best)) c.best = place;
  c.alive += Math.max(0, Math.round(endTick / TICKS_PER_SEC));
  for (const f of feed) if (f.killer === seat && f.weapon < 8) c.guns[f.weapon] += 1;
  c.seen = [id, ...c.seen].slice(0, 60);
  c.recent = [place, ...c.recent].slice(0, 10);
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* storage full or blocked: the record just isn't kept */
  }
  return c;
}

export function favouriteGun(c: Career): number | null {
  let best = -1;
  let n = 0;
  c.guns.forEach((k, i) => {
    if (k > n) {
      n = k;
      best = i;
    }
  });
  return best >= 0 ? best : null;
}

export const fmtTime = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m ${s % 60}s`);
