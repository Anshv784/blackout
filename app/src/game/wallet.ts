// Wallet is optional. Connected players get their callsign + stats saved on Solana (board3,
// written by the settle Magic Action after each night). Guests play on the same gasless
// in-browser session key, but settle skips them, so nothing is saved or ranked.
import { PublicKey, Transaction } from "@solana/web3.js";
import { client } from "./identity";
import { useStore } from "./store";
import type { BoardEntry } from "../chain/layout";

export interface WalletOption {
  id: "phantom" | "solflare" | "backpack";
  name: string;
  get: () => any;
  url: string;
}

export const WALLETS: WalletOption[] = [
  { id: "phantom", name: "Phantom", get: () => (window as any).phantom?.solana ?? ((window as any).solana?.isPhantom ? (window as any).solana : null), url: "https://phantom.app/download" },
  { id: "solflare", name: "Solflare", get: () => (window as any).solflare ?? null, url: "https://solflare.com/download" },
  { id: "backpack", name: "Backpack", get: () => (window as any).backpack?.solana ?? (window as any).backpack ?? null, url: "https://backpack.app/download" },
];

let active: any = null;

export const provider = () => {
  if (active) return active;
  const id = (() => {
    try {
      return localStorage.getItem("bo-wallet-provider");
    } catch {
      return null;
    }
  })();
  return WALLETS.find((w) => w.id === id)?.get() ?? WALLETS.map((w) => w.get()).find(Boolean) ?? null;
};

const nameKey = (wallet: string) => `bo-name:${wallet}`;

export function localNameFor(wallet: string): string | null {
  try {
    return localStorage.getItem(nameKey(wallet));
  } catch {
    return null;
  }
}

export function saveWalletName(wallet: string, name: string) {
  try {
    localStorage.setItem(nameKey(wallet), name);
    localStorage.setItem("bo-name", name);
  } catch {
    /* ignore */
  }
}

/** Profile as stored on Solana (board3), if this wallet has played before. */
export async function loadProfile(wallet: string): Promise<BoardEntry | null> {
  const b = await client.fetchBoard().catch(() => null);
  return b?.entries.find((e) => e.key.toBase58() === wallet) ?? null;
}

export async function connectWallet(id?: WalletOption["id"]): Promise<string> {
  const opt = id ? WALLETS.find((w) => w.id === id) : null;
  const sol = opt ? opt.get() : provider();
  if (!sol) throw new Error(`${opt?.name ?? "A Solana wallet"} isn't installed`);
  const res = await sol.connect();
  const pk = (res?.publicKey ?? sol.publicKey).toString();
  active = sol;
  try {
    localStorage.setItem("bo-wallet", pk);
    if (opt) localStorage.setItem("bo-wallet-provider", opt.id);
  } catch {
    /* ignore */
  }
  // restore the profile: on-chain name first, then this browser's copy
  const prof = await loadProfile(pk);
  const name = prof?.name || localNameFor(pk);
  try {
    localStorage.removeItem("bo-guest");
  } catch {
    /* ignore */
  }
  useStore.getState().set({ wallet: pk, guest: false, profile: prof ?? null, ...(name ? { name } : {}) });
  if (name) saveWalletName(pk, name);
  return pk;
}

/** Sign a plain-text message with the connected wallet (proves the player owns it; no transaction,
 *  no fee). Returns the 64-byte signature. */
export async function signText(text: string): Promise<Uint8Array> {
  const sol = provider();
  if (!sol?.signMessage) throw new Error("This wallet can't sign messages");
  if (!sol.publicKey) await sol.connect();
  const res = await sol.signMessage(new TextEncoder().encode(text), "utf8");
  const sig = res?.signature ?? res;
  return sig instanceof Uint8Array ? sig : Uint8Array.from(sig);
}

export async function disconnectWallet() {
  try {
    await provider()?.disconnect?.();
  } catch {
    /* ignore */
  }
  active = null;
  try {
    localStorage.removeItem("bo-wallet");
  } catch {
    /* ignore */
  }
  useStore.getState().set({ wallet: null, profile: null });
}

export const isGuest = () => {
  try {
    return !useStore.getState().wallet && localStorage.getItem("bo-guest") === "1";
  } catch {
    return false;
  }
};

export function setGuest(on: boolean) {
  try {
    if (on) localStorage.setItem("bo-guest", "1");
    else localStorage.removeItem("bo-guest");
  } catch {
    /* ignore */
  }
  useStore.getState().set({ guest: on });
}

/** Run `then` once the player has an identity (wallet + callsign, or guest); otherwise open the gate. */
export function requireWallet(then: () => void) {
  const st = useStore.getState();
  if ((st.wallet && localNameFor(st.wallet)) || isGuest()) then();
  else st.set({ walletGate: { then } });
}

/** Staked nights need a real wallet: guests get the gate with no guest option. */
export function requireRealWallet(then: () => void) {
  const st = useStore.getState();
  if (st.wallet && localNameFor(st.wallet)) then();
  else st.set({ walletGate: { then, walletOnly: true } });
}

