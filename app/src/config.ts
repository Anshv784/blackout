// Rooms are pre-created and delegated to the TEE by scripts/admin.ts.
/** Room slots. Players "create" a room by claiming a free slot and becoming its host. */
// Devnet: 12 free rooms and one staked table. Mainnet launches smaller: 6 free rooms (1-6) and two
// staked tables (7, 8), both at the same stake (0.01 SOL), set when scripts/admin.ts creates them.
const MAINNET = (import.meta as any).env?.VITE_CLUSTER === "mainnet";
export const ROOM_POOL = MAINNET ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13];
export const STAKED_ROOMS = MAINNET ? [7, 8] : [5];
// kept for older imports
export const PUBLIC_ROOMS = ROOM_POOL;
export const QUICK_ROOMS = ROOM_POOL;
export const PRIVATE_POOL = ROOM_POOL;

export const SITE_URL = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";
export const roomLink = (id: bigint | number) => `${SITE_URL}#/r/${id}`;
export const explorerAddr = (a: string, cluster = "devnet") => `https://explorer.solana.com/address/${a}?cluster=${cluster}`;
export const explorerTx = (s: string) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;
