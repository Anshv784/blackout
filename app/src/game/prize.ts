// The daily prize, client side: today's pot and standings, what a wallet can claim, and the claim.
// The program has the final say on everything here (programs/blackout/src/state.rs `Prize`).
import { PublicKey, Transaction } from "@solana/web3.js";
import { client } from "./identity";
import { PRIZE_MIN_GAMES, prizeLeader, type Prize, type PrizeEntry } from "../chain/layout";

/** the UTC day number the program uses (unix seconds / 86400) */
export const utcDay = () => Math.floor(Date.now() / 86_400_000);

/** today's pot: zero until the first 0.05 night of the day settles (it resets every UTC day) */
export const todaysPot = (p: Prize | null) => (p && p.day === utcDay() ? p.pot : 0n);

/** today's standings, best first (qualified players ahead of those still short of 3 nights) */
export function todaysStandings(p: Prize | null): PrizeEntry[] {
  const list = p && p.day === utcDay() ? [...p.entries] : [];
  return list.sort((a, b) => {
    const qa = a.games >= PRIZE_MIN_GAMES ? 1 : 0;
    const qb = b.games >= PRIZE_MIN_GAMES ? 1 : 0;
    if (qa !== qb) return qb - qa;
    return a.profit === b.profit ? 0 : a.profit > b.profit ? -1 : 1;
  });
}

/** Lamports `wallet` can claim now: the last closed day's prize if they won it and haven't taken
 *  it, or (when the day ended but nobody has closed it yet) the day they're leading. */
export function claimable(p: Prize | null, wallet: string | null): { amount: bigint; day: number } {
  if (!p || !wallet) return { amount: 0n, day: 0 };
  if (p.day !== 0 && p.day < utcDay()) {
    const i = prizeLeader(p);
    return i >= 0 && p.pot > 0n && p.entries[i].key.toBase58() === wallet ? { amount: p.pot, day: p.day } : { amount: 0n, day: 0 };
  }
  return !p.lastClaimed && p.lastPrize > 0n && p.lastWinner.toBase58() === wallet ? { amount: p.lastPrize, day: p.lastDay } : { amount: 0n, day: 0 };
}

/** Claim the prize: the winning wallet signs and receives it. */
export async function claimPrize(provider: { publicKey: { toString(): string }; signTransaction: (tx: Transaction) => Promise<Transaction> }) {
  const wallet = new PublicKey(provider.publicKey.toString());
  const tx = new Transaction().add(client.claimPrizeIx(wallet));
  tx.feePayer = wallet;
  tx.recentBlockhash = (await client.base.getLatestBlockhash()).blockhash;
  const signed = await provider.signTransaction(tx);
  const sig = await client.base.sendRawTransaction(signed.serialize());
  const res = await client.base.confirmTransaction(sig, "confirmed");
  if (res.value.err) throw new Error("Claiming the prize failed on Solana. Nothing was moved. Try again.");
  return sig;
}

export const solText = (lamports: bigint) => {
  const n = Number(lamports) / 1e9;
  if (n === 0) return "0";
  return n >= 0.1 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(3) : n.toFixed(4);
};
export const signedSol = (lamports: bigint) => `${lamports > 0n ? "+" : lamports < 0n ? "−" : ""}${solText(lamports < 0n ? -lamports : lamports)}`;
