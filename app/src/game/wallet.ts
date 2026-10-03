// Optional wallet: connect once, remembered as your payout / leaderboard identity.
import { PublicKey, Transaction } from "@solana/web3.js";
import { client } from "./identity";
import { useStore } from "./store";

export const provider = () => (window as any).phantom?.solana ?? (window as any).solana ?? null;

export async function connectWallet(): Promise<string> {
  const sol = provider();
  if (!sol) throw new Error("No Solana wallet found — install Phantom (devnet) to save your stats");
  const res = await sol.connect();
  const pk = res.publicKey.toString();
  try {
    localStorage.setItem("bo-wallet", pk);
  } catch {
    /* ignore */
  }
  useStore.getState().set({ wallet: pk });
  return pk;
}

/** Move this browser key's leaderboard stats to the wallet (wallet pays the fee). */
export async function linkStats(): Promise<void> {
  const sol = provider();
  const pk = new PublicKey(await connectWallet());
  // settle lands a few seconds after the match commits; wait until our entry exists
  for (let i = 0; i < 12; i++) {
    const b = await client.fetchBoard().catch(() => null);
    if (b?.entries.some((e) => e.key.equals(client.publicKey))) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  const tx = new Transaction().add(client.linkWalletIx(pk));
  tx.feePayer = pk;
  tx.recentBlockhash = (await client.base.getLatestBlockhash()).blockhash;
  tx.partialSign(client.keypair);
  const signed = await sol.signTransaction(tx);
  const sig = await client.base.sendRawTransaction(signed.serialize());
  await client.base.confirmTransaction(sig, "confirmed");
}
