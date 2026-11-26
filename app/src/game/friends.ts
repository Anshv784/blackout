// Friends-only staked tables (worker/index.ts /api/friends/*). Tapping a staked table reserves it for
// a fresh code; your friends join with that code; nobody else is let in by the site. It's a soft
// lock: the program itself would still seat anyone with a ticket.
import { NETWORK } from "../config";

const post = async (op: string, body: object) => {
  const r = await fetch(`/api/friends/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, net: NETWORK }) });
  return { ok: r.ok, status: r.status, data: (await r.json().catch(() => ({}))) as any };
};

const KEY = (room: number) => `bo-friends-${NETWORK}-${room}`;
/** the code you hold for a table (you reserved it, or joined with it) */
export const myFriendCode = (room: number): number | null => {
  try {
    const v = Number(sessionStorage.getItem(KEY(room)) ?? "");
    return v > 0 ? v : null;
  } catch {
    return null;
  }
};
export const rememberFriendCode = (room: number, code: number) => {
  try {
    sessionStorage.setItem(KEY(room), String(code));
  } catch {}
};
export const forgetFriendCode = (room: number) => {
  try {
    sessionStorage.removeItem(KEY(room));
  } catch {}
};

/** reserve a staked table for you and your friends: a fresh code, or "busy" */
export async function reserveTable(room: number): Promise<{ code: number } | "busy"> {
  const r = await post("reserve", { room });
  if (r.status === 409) return "busy";
  if (!r.ok) throw new Error("Couldn't start a friends game. Try again.");
  rememberFriendCode(room, r.data.code);
  return { code: r.data.code };
}
/** which table a friend code opens */
export async function tableForCode(code: number): Promise<number | null> {
  const r = await post("lookup", { code });
  return r.ok ? Number(r.data.room) : null;
}
/** which tables are taken by a friends game right now */
export async function reservedTables(rooms: number[]): Promise<Record<number, boolean>> {
  const r = await fetch(`/api/friends/status?net=${NETWORK}&rooms=${rooms.join(",")}`).catch(() => null);
  return r && r.ok ? ((await r.json()).reserved as Record<number, boolean>) : {};
}
export const keepTable = (room: number, code: number) => post("keep", { room, code }).then((r) => !r.data.gone).catch(() => true);
export const releaseTable = (room: number, code: number) => post("release", { room, code }).catch(() => {});
/** let the table go even while the page is closing */
export const releaseTableOnExit = (room: number, code: number) => {
  fetch("/api/friends/release", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ room, code, net: NETWORK }), keepalive: true }).catch(() => {});
};
