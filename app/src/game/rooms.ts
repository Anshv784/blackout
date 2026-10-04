// "Create a room" = claim a free on-chain room slot, become its host, take seat 0 — one gasless tx.
import { PublicKey } from "@solana/web3.js";
import { client } from "./identity";
import { useStore } from "./store";
import { ROOM_POOL } from "../config";
import { ST_LOBBY, READY_ALL, type Room } from "../chain/layout";

const EMPTY = "11111111111111111111111111111111";

export const liveHumansAt = (r: Room, slot: number) =>
  r.players.filter((p, i) => r.isBot[i] === 0 && p.toBase58() !== EMPTY && ((slot >>> 0) - r.lastSeen[i]) >>> 0 <= 4500).length;

export async function createRoom(maxPlayers: number, unlisted: boolean): Promise<number> {
  const rooms = await Promise.all(ROOM_POOL.map(async (id) => [id, await client.fetchRoom(id).catch(() => null)] as const));
  const slot = await (await client.teeConn()).getSlot().catch(() => 0);
  const free = rooms.filter(([, r]) => r && r.status === ST_LOBBY && r.readyMask === READY_ALL && liveHumansAt(r, slot) === 0);
  if (!free.length) throw new Error("Every room is in use right now — try again in a minute");
  // shuffle so two people creating at once rarely collide
  free.sort(() => Math.random() - 0.5);
  const st = useStore.getState();
  const wallet = st.wallet ? new PublicKey(st.wallet) : null;
  let lastErr: unknown = null;
  for (const [id] of free.slice(0, 3)) {
    try {
      await client.sendEr([client.claimIx(BigInt(id), maxPlayers, unlisted), client.joinIx(BigInt(id), 0, st.name || "GHOST", wallet)]);
      return id;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
