// Rooms are pre-created and delegated to the TEE by scripts/admin.ts.
/** Room slots. Players "create" a room by claiming a free slot and becoming its host. */
// Reserved pools: a room only ever serves its own kind of game, so private games can't use up the
// public rooms and the other way round. Both networks: 6 public, 4 private, 2 staked (0.01 and 0.05 SOL).
//   Mainnet: public 1-6, private 7-10, staked 11-12.
//   Devnet: the same, except public room 5 is 13 (devnet's room 5 was created as a staked table
//   and a room's stake can't change; it's retired).
const MAINNET = ((import.meta as any).env ?? ((globalThis as any).process?.env ?? {})).VITE_CLUSTER === "mainnet";
export const PUBLIC_ROOMS = MAINNET ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 6, 13];
export const PRIVATE_ROOMS = [7, 8, 9, 10];
export const STAKED_ROOMS = [11, 12];
/** every free room (public and private) */
export const ROOM_POOL = [...PUBLIC_ROOMS, ...PRIVATE_ROOMS];
/** every room there is */
export const ALL_ROOMS = [...ROOM_POOL, ...STAKED_ROOMS];
// kept for older imports
export const QUICK_ROOMS = PUBLIC_ROOMS;
export const PRIVATE_POOL = PRIVATE_ROOMS;

export const SITE_URL = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";
export const roomLink = (id: bigint | number) => `${SITE_URL}#/r/${id}`;
/** which Solana network this build plays on, for text and links (VITE_CLUSTER at build time) */
export const NETWORK = MAINNET ? "mainnet" : "devnet";
export const TEE_HOST = MAINNET ? "mainnet-tee.magicblock.app" : "devnet-tee.magicblock.app";
const cluster = MAINNET ? "" : "?cluster=devnet";
export const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}${cluster}`;
export const explorerTx = (s: string) => `https://explorer.solana.com/tx/${s}${cluster}`;
