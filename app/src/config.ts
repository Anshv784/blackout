// Rooms are pre-created and delegated to the TEE by scripts/admin.ts.
export const PUBLIC_ROOMS = [1, 2, 3, 4, 5];
/** Unlisted rooms handed out by "Play with friends" — share the link. */
export const PRIVATE_POOL = [10, 11, 12, 13];

export const SITE_URL = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";
export const roomLink = (id: bigint | number) => `${SITE_URL}#/r/${id}`;
export const explorerAddr = (a: string, cluster = "devnet") => `https://explorer.solana.com/address/${a}?cluster=${cluster}`;
export const explorerTx = (s: string) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;
