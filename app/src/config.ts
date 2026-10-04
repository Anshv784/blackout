// Rooms are pre-created and delegated to the TEE by scripts/admin.ts.
/** Room slots. Players "create" a room by claiming a free slot and becoming its host. */
export const ROOM_POOL = [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13];
export const STAKED_ROOMS = [5];
// kept for older imports
export const PUBLIC_ROOMS = ROOM_POOL;
export const QUICK_ROOMS = ROOM_POOL;
export const PRIVATE_POOL = ROOM_POOL;

export const SITE_URL = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";
export const roomLink = (id: bigint | number) => `${SITE_URL}#/r/${id}`;
export const explorerAddr = (a: string, cluster = "devnet") => `https://explorer.solana.com/address/${a}?cluster=${cluster}`;
export const explorerTx = (s: string) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;
